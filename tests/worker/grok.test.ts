import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { appWithFetcher, token } from "./helpers.ts";

let n = 0;
async function verified() {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({ name: `Grok Co ${n}`, domain: `grokco${n}.example`, categories: ["payments"] }),
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

/** A fake xAI reply: Grok's JSON answer plus the citations xAI returned. */
function xai(answer: unknown, cited: string[]) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(answer),
              annotations: cited.map((url) => ({ type: "url_citation", url })),
            },
          ],
        },
      ],
      usage: { input_tokens: 12_000, output_tokens: 900 },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

async function admin(fetcher: typeof fetch, method: string, path: string, body?: unknown, vars: Partial<Env> = {}) {
  return appWithFetcher(fetcher).fetch(
    new Request(`https://talo.example/api/admin${path}`, {
      method,
      headers: { "Cf-Access-Jwt-Assertion": await token(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, XAI_API_KEY: "test-key", GROK_MONTHLY_CAP_USD: "2.5", ...vars } as unknown as Env,
  );
}
const noWeb = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;

describe("Grok test", () => {
  it("researches a company: suggests the handle only when a cited post from that account backs it", async () => {
    const c = await verified();
    const id = `${Date.now()}`.padEnd(18, "7");
    const sent: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(String(init?.body ?? ""));
      return xai(
        {
          official_handle: { handle: "@GrokCoHQ", evidence_post_url: `https://x.com/grokcohq/status/${id}1` },
          items: [
            {
              post_url: `https://x.com/grokcohq/status/${id}1`,
              posted_at: "2026-11-10",
              post_text: "Our partner program is open",
            },
            { post_url: `https://x.com/grokcohq/status/${id}2`, posted_at: "2026-11-11", post_text: "Made-up post" },
          ],
        },
        [`https://x.com/grokcohq/status/${id}1`],
      );
    }) as unknown as typeof fetch;

    const res = await admin(fetcher, "POST", `/grok/research/${c.id}`);
    const body = (await res.json()) as {
      outcome: { status: string; items_new: number };
      handle: { handle: string } | null;
      cost_usd: number;
    };
    expect(res.status).toBe(200);
    expect(body.outcome).toMatchObject({ status: "ok", items_new: 1 });
    expect(body.handle?.handle).toBe("grokcohq");
    expect(body.cost_usd).toBeGreaterThan(0);
    expect(sent[0]).toContain(c.primary_domain);
    expect(JSON.parse(sent[0] ?? "{}").store).toBe(false);

    const sug = (await (await admin(noWeb, "GET", "/grok/handles")).json()) as {
      suggestions: { id: string; company_id: string; handle: string }[];
    };
    const mine = sug.suggestions.find((x) => x.company_id === c.id);
    expect(mine?.handle).toBe("grokcohq");
    expect((await admin(noWeb, "POST", `/grok/handles/${mine?.id}`, { accept: true })).status).toBe(200);
    const alias = await env.DB.prepare("SELECT value FROM company_aliases WHERE company_id = ? AND kind = 'x_handle'")
      .bind(c.id)
      .first<{ value: string }>();
    expect(alias?.value).toBe("grokcohq");
  });

  it("ignores a handle whose evidence wasn't cited, or comes from another account", async () => {
    const c = await verified();
    const id = `${Date.now()}`.padEnd(18, "8");
    const fetcher = (async () =>
      xai(
        {
          official_handle: { handle: "realco", evidence_post_url: `https://x.com/fanaccount/status/${id}1` },
          items: [],
        },
        [`https://x.com/fanaccount/status/${id}1`],
      )) as unknown as typeof fetch;
    const body = (await (await admin(fetcher, "POST", `/grok/research/${c.id}`)).json()) as { handle: unknown };
    expect(body.handle).toBeNull();
  });

  it("won't research an unverified company, and refuses a search over the budget", async () => {
    const c = await verified();
    await env.DB.prepare("UPDATE companies SET status = 'needs_review' WHERE id = ?").bind(c.id).run();
    expect((await admin(noWeb, "POST", `/grok/research/${c.id}`)).status).toBe(409);
    const d = await verified();
    const out = (await (
      await admin(noWeb, "POST", `/grok/research/${d.id}`, undefined, { GROK_MONTHLY_CAP_USD: "0.05" })
    ).json()) as {
      outcome: { status: string; error: string };
    };
    expect(out.outcome).toMatchObject({ status: "not_modified", error: expect.stringMatching(/could cost up to/) });
  });

  it("adds the 3 test searches once, rates results, and reports cost per useful result", async () => {
    expect(await (await admin(noWeb, "POST", "/grok/test-searches")).json()).toEqual({ added: 3 });
    expect(await (await admin(noWeb, "POST", "/grok/test-searches")).json()).toEqual({ added: 0 });

    const status = (await (await admin(noWeb, "GET", "/grok")).json()) as {
      key_set: boolean;
      auto: boolean;
      budget: { cap: number };
      company_estimate_usd: number;
      searches: { id: string; name: string; kind: string; estimate_usd: number; lookback_days: number }[];
    };
    expect(status).toMatchObject({ key_set: true, auto: false, budget: { cap: 2.5 } });
    expect(status.company_estimate_usd).toBeGreaterThan(0.05);
    expect(status.company_estimate_usd).toBeLessThan(0.3);
    const test = status.searches.filter((s) => s.name.startsWith("Grok test:"));
    expect(test).toHaveLength(3);
    expect(test.every((s) => s.kind === "topic" && s.lookback_days === 7)).toBe(true);

    // Run one, rate its result, and read the report.
    const id = `${Date.now()}`.padEnd(18, "9");
    const fetcher = (async () =>
      xai(
        {
          items: [
            {
              post_url: `https://x.com/someco/status/${id}1`,
              posted_at: "2026-11-14",
              post_text: "Integrations are open",
            },
          ],
        },
        [`https://x.com/someco/status/${id}1`],
      )) as unknown as typeof fetch;
    const run = (await (await admin(fetcher, "POST", `/watched-sources/${test[0]?.id}/run`)).json()) as {
      outcome: { items_new: number };
    };
    expect(run.outcome.items_new).toBe(1);
    const inbox = (await (await admin(noWeb, "GET", "/inbox")).json()) as {
      items: { id: string; watched_source_id: string; from_grok: number }[];
    };
    const item = inbox.items.find((i) => i.watched_source_id === test[0]?.id);
    expect(item?.from_grok).toBe(1);
    expect((await admin(noWeb, "POST", `/inbox/${item?.id}/rate`, { useful: true })).status).toBe(200);

    const after = (await (await admin(noWeb, "GET", "/grok")).json()) as {
      searches: { id: string; runs: number; useful: number; cost_usd: number }[];
      totals: { useful: number; cost_per_useful_usd: number | null };
    };
    expect(after.searches.find((s) => s.id === test[0]?.id)).toMatchObject({ runs: 1, useful: 1 });
    expect(after.totals.cost_per_useful_usd).toBeGreaterThan(0);
  });
});
