import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { appWithFetcher, call, founderSession, token } from "./helpers.ts";

let n = 0;
async function verified() {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({ name: `People Co ${n}`, domain: `peopleco${n}.example`, categories: ["payments"] }),
    "admin@talo.example",
  );
  await reviewCompany(
    env.DB,
    c.id,
    { action: "verify", checked_url: `https://${c.primary_domain}` },
    "admin@talo.example",
  );
  return c;
}
async function admin(fetcher: typeof fetch, method: string, path: string, body?: unknown, vars: Partial<Env> = {}) {
  return appWithFetcher(fetcher).fetch(
    new Request(`https://talo.example/api/admin${path}`, {
      method,
      headers: { "Cf-Access-Jwt-Assertion": await token(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, ...vars } as unknown as Env,
  );
}
type Pending = {
  id: string;
  company_id: string;
  kind: string;
  name: string | null;
  role: string | null;
  channel_label: string | null;
  source_url: string;
  created_by: string;
};

describe("points of contact", () => {
  it("finds people on the company's team page and its partner page, waiting for approval; founders see them only after", async () => {
    const c = await verified();
    const d = c.primary_domain;
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `https://${d}/`)
        return new Response(`<a href="/team">Team</a><a href="/partners">Partners</a>`, {
          headers: { "content-type": "text/html" },
        });
      if (url === `https://${d}/team`)
        return new Response(
          `<h3>Jane Doe</h3><p>Co-founder &amp; CEO</p><h3>Kwame Mensah</h3><p>Head of Partnerships</p><h3>Sam Hill</h3><p>Designer</p>`,
          {
            headers: { "content-type": "text/html" },
          },
        );
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    // The website reader first records the partner page, as it does every hour.
    await admin(fetcher, "POST", `/companies/${c.id}/website`);
    const found = (await (await admin(fetcher, "POST", `/companies/${c.id}/contacts/find`)).json()) as {
      added: number;
      pages_read: number;
    };
    expect(found).toEqual({ added: 3, pages_read: 2 });
    expect(
      (await (await admin(fetcher, "POST", `/companies/${c.id}/contacts/find`)).json()) as { added: number },
    ).toMatchObject({ added: 0 });

    const pending = (
      (await (await admin(fetcher, "GET", "/contacts/pending")).json()) as { contacts: Pending[] }
    ).contacts.filter((k) => k.company_id === c.id);
    expect(pending.map((k) => k.name ?? k.channel_label).sort()).toEqual(["Jane Doe", "Kwame Mensah", "Partner page"]);
    expect(pending.find((k) => k.name === "Kwame Mensah")).toMatchObject({
      role: "Head of Partnerships",
      source_url: `https://${d}/team`,
      created_by: "website-reader",
    });

    const { cookie } = await founderSession();
    const before = await call(`/api/app/explore?q=${encodeURIComponent(c.name)}`, { as: null, headers: { cookie } });
    expect(((await before.json()) as { results: { poc: unknown }[] }).results[0]?.poc).toBeNull();

    const kwame = pending.find((k) => k.name === "Kwame Mensah");
    const jane = pending.find((k) => k.name === "Jane Doe");
    expect(
      await (
        await admin(fetcher, "POST", "/contacts/review-batch", { ids: [kwame?.id, jane?.id], action: "verify" })
      ).json(),
    ).toEqual({ done: 2 });
    const after = await call(`/api/app/explore?q=${encodeURIComponent(c.name)}`, { as: null, headers: { cookie } });
    expect(((await after.json()) as { results: { poc: { name: string } }[] }).results[0]?.poc?.name).toMatch(
      /Kwame Mensah|Jane Doe/,
    );
  });

  it("Grok people need their own cited post; approving makes them a contact", async () => {
    const c = await verified();
    const id = `${Date.now()}`.padEnd(18, "5");
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    official_handle: null,
                    items: [],
                    people: [
                      {
                        name: "Lee Park",
                        handle: "leepark",
                        role: "Head of BD",
                        evidence_post_url: `https://x.com/leepark/status/${id}1`,
                      },
                      {
                        name: "Not Cited",
                        handle: "ghost",
                        role: "CEO",
                        evidence_post_url: `https://x.com/ghost/status/${id}2`,
                      },
                      {
                        name: "Wrong Author",
                        handle: "bob",
                        role: "CEO",
                        evidence_post_url: `https://x.com/leepark/status/${id}1`,
                      },
                    ],
                  }),
                  annotations: [{ type: "url_citation", url: `https://x.com/leepark/status/${id}1` }],
                },
              ],
            },
          ],
          usage: { input_tokens: 9000, output_tokens: 700 },
        }),
        { headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const r = (await (
      await admin(fetcher, "POST", `/grok/research/${c.id}`, undefined, {
        XAI_API_KEY: "k",
        GROK_MONTHLY_CAP_USD: "2.5",
      })
    ).json()) as { people_added: number };
    expect(r.people_added).toBe(1);
    const pending = (
      (await (await admin(fetcher, "GET", "/contacts/pending")).json()) as { contacts: Pending[] }
    ).contacts.filter((k) => k.company_id === c.id);
    expect(pending).toEqual([
      expect.objectContaining({
        name: "Lee Park (@leepark)",
        role: "Head of BD",
        created_by: "grok",
        source_url: `https://x.com/leepark/status/${id}1`,
      }),
    ]);
    expect(
      await (
        await admin(fetcher, "POST", "/contacts/review-batch", { ids: [pending[0]?.id], action: "reject" })
      ).json(),
    ).toEqual({ done: 1 });
  });
});
