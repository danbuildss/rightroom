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
    companyInputSchema.parse({ name: `Site Co ${n}`, domain: `siteco${n}.example`, categories: ["payments"] }),
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
const homepage = (domain: string, handle: string) =>
  (async () =>
    new Response(
      `<a href="https://x.com/${handle}">X</a><a href="https://github.com/${handle}-labs">GitHub</a>
       <a href="https://www.linkedin.com/company/${handle}">LinkedIn</a><a href="https://docs.${domain}/">Docs</a>
       <a href="/partners">Partners</a><a href="mailto:partnerships@${domain}">Partner with us</a>`,
      { headers: { "content-type": "text/html" } },
    )) as unknown as typeof fetch;

async function admin(fetcher: typeof fetch, method: string, path: string, body?: unknown) {
  return appWithFetcher(fetcher).fetch(
    new Request(`https://talo.example/api/admin${path}`, {
      method,
      headers: { "Cf-Access-Jwt-Assertion": await token(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env as unknown as Env,
  );
}
async function cardLinks(name: string) {
  const { cookie } = await founderSession();
  const res = await call(`/api/app/explore?q=${encodeURIComponent(name)}`, { as: null, headers: { cookie } });
  return ((await res.json()) as { results: { links: Record<string, string | null> }[] }).results[0]?.links;
}

describe("details from the company's own website", () => {
  it("fills in X, GitHub, LinkedIn, docs, partner page and a published partnerships email, shown without review", async () => {
    const c = await verified();
    const r = (await (
      await admin(homepage(c.primary_domain, `siteco${n}`), "POST", `/companies/${c.id}/website`)
    ).json()) as {
      added: string[];
    };
    expect(r.added.sort()).toEqual(["docs", "email", "github", "linkedin", "partners", "x"]);
    expect(await cardLinks(c.name)).toEqual({
      website: `https://${c.primary_domain}`,
      x: `https://x.com/siteco${n}`,
      github: `https://github.com/siteco${n}-labs`,
      partners: `https://${c.primary_domain}/partners`,
      docs: `https://docs.${c.primary_domain}`,
      linkedin: `https://www.linkedin.com/company/siteco${n}`,
      email: `partnerships@${c.primary_domain}`,
      contact_form: null,
    });
  });

  it("never overwrites what Dan set, and never re-adds what Dan removed", async () => {
    const c = await verified();
    const web = homepage(c.primary_domain, `siteco${n}`);
    await admin(web, "POST", `/companies/${c.id}/links`, { kind: "x", value: "dans_choice" });
    await admin(web, "POST", `/companies/${c.id}/website`);
    expect((await cardLinks(c.name))?.x).toBe("https://x.com/dans_choice");

    expect((await admin(web, "DELETE", `/companies/${c.id}/details/email`)).status).toBe(200);
    expect((await admin(web, "DELETE", `/companies/${c.id}/details/docs`)).status).toBe(200);
    await admin(web, "POST", `/companies/${c.id}/website`);
    const after = await cardLinks(c.name);
    expect(after?.email).toBeNull();
    expect(after?.docs).toBeNull();
    const info = (await (await admin(web, "GET", `/companies/${c.id}/website`)).json()) as { blocked: string[] };
    expect(info.blocked.sort()).toEqual(["docs", "email"]);
  });

  it("records an unreachable site without failing, and fill-missing reads the next companies", async () => {
    const c = await verified();
    const down = (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch;
    const r = (await (await admin(down, "POST", `/companies/${c.id}/website`)).json()) as {
      added: string[];
      note: string;
    };
    expect(r).toMatchObject({ added: [], note: "Their homepage answered 503." });
    const fill = (await (await admin(down, "POST", "/website/fill-missing")).json()) as { results: { id: string }[] };
    expect(fill.results.map((x) => x.id)).not.toContain(c.id);
  });
});
