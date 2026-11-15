import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { signalInputSchema } from "../../shared/signals.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { createSignal, reviewCompany, reviewSignal } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { appWithFetcher, call, token } from "./helpers.ts";

const ADMIN = "admin@talo.example";
let n = 0;

async function company(opts: { verified?: boolean; sample?: boolean; category?: string } = {}) {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({
      name: `Public Co ${n}`,
      domain: `publicco${n}.example`,
      description: `Public test company ${n}.`,
      categories: [opts.category ?? "payments"],
      is_sample: opts.sample ?? false,
    }),
    ADMIN,
  );
  if (opts.verified !== false) {
    await reviewCompany(env.DB, c.id, { action: "verify", checked_url: `https://${c.primary_domain}` }, ADMIN);
  }
  return c;
}

async function signal(domain: string, opts: { verified?: boolean; at?: Date } = {}) {
  const id = await createSignal(
    env.DB,
    signalInputSchema.parse({
      company_domain: domain,
      signal_type: "partner_program_launched",
      title: "Opened a partner program",
      factual_claim: "The company opened a partner program.",
      source_excerpt: "Our partner program is open.",
      opportunity_note: "Tools could apply.",
      event_date: "2026-11-10",
      primary_source: { url: `https://${domain}/partners`, kind: "partner_page", title: "Partners" },
    }),
    ADMIN,
    opts.at,
  );
  if (opts.verified !== false) {
    await reviewSignal(env.DB, id, { action: "verify", checked_url: `https://${domain}/partners` }, ADMIN, opts.at);
  }
  return id;
}

const pub = async <T>(path: string) => {
  const res = await call(`/api/public${path}`, { as: null });
  return { res, json: (await res.json()) as T };
};

describe("public Discover API", () => {
  it("needs no login and can be cached briefly", async () => {
    const { res } = await pub("/signals");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("shows verified companies only, never samples or unverified ones", async () => {
    const shown = await company();
    const pending = await company({ verified: false });
    const sample = await company({ sample: true });
    const { json } = await pub<{ companies: { slug: string }[] }>("/companies?limit=100");
    const slugs = json.companies.map((c) => c.slug);
    expect(slugs).toContain(shown.slug);
    expect(slugs).not.toContain(pending.slug);
    expect(slugs).not.toContain(sample.slug);
    expect((await call(`/api/public/companies/${pending.slug}`, { as: null })).status).toBe(404);
  });

  it("shows verified signals of verified companies only, with sources and dates", async () => {
    const c = await company();
    const shown = await signal(c.primary_domain);
    const pendingCo = await company({ verified: false });
    const hidden = await signal(pendingCo.primary_domain); // verified signal, unverified company
    const unreviewed = await signal(c.primary_domain.replace("publicco", "publicco-x"), { verified: false }).catch(
      () => null,
    );
    const { json } = await pub<{
      signals: { id: string; status: string; sources: { url: string }[]; our_view: string }[];
    }>("/signals?limit=100");
    const ids = json.signals.map((s) => s.id);
    expect(ids).toContain(shown);
    expect(ids).not.toContain(hidden);
    if (unreviewed) expect(ids).not.toContain(unreviewed);
    const s = json.signals.find((x) => x.id === shown);
    expect(s?.status).toBe("verified");
    expect(s?.sources[0]?.url).toBe(`https://${c.primary_domain}/partners`);
    expect(s?.our_view).toBe("Tools could apply.");
  });

  it("marks old verifications as stale instead of hiding them", async () => {
    const c = await company();
    const old = await signal(c.primary_domain, { at: new Date("2026-01-01T00:00:00Z") });
    const { json } = await pub<{ signals: { id: string; status: string }[] }>("/signals?limit=100");
    expect(json.signals.find((s) => s.id === old)?.status).toBe("stale");
  });

  it("never exposes internal fields", async () => {
    const c = await company();
    await signal(c.primary_domain);
    const { json } = await pub(`/companies/${c.slug}`);
    const text = JSON.stringify(json);
    expect(text).toContain(c.slug); // the company really is in the response
    for (const field of [
      "created_by",
      "reviewer",
      "rejected_reason",
      "is_sample",
      "admin@talo.example",
      "company_id",
    ]) {
      expect(text, field).not.toContain(field);
    }
  });

  it("filters by category and type, and lists categories with counts", async () => {
    const wallet = await company({ category: "wallets" });
    const { json } = await pub<{ companies: { slug: string }[] }>("/companies?category=wallets&limit=100");
    expect(json.companies.map((c) => c.slug)).toContain(wallet.slug);
    const cats = await pub<{ categories: { slug: string; company_count: number }[] }>("/categories");
    expect(cats.json.categories.find((c) => c.slug === "wallets")?.company_count).toBeGreaterThan(0);
    expect((await call("/api/public/signals?type=funding", { as: null })).status).toBe(400);
  });

  it("keeps everything else behind the admin login", async () => {
    expect((await call("/api/public/nope", { as: null })).status).toBe(401);
    expect((await call("/api/admin/queue", { as: null })).status).toBe(401);
  });
});

describe("evidence for reviewers", () => {
  const fakeWeb = (html: string, status = 200) =>
    (async () => new Response(html, { status })) as unknown as typeof fetch;
  async function post(fetcher: typeof fetch, path: string) {
    return appWithFetcher(fetcher).fetch(
      new Request(`https://talo.example${path}`, {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": await token() },
      }),
      env as unknown as Env,
    );
  }

  it("suggests the sentence on the source page that supports a signal", async () => {
    const c = await company();
    const id = await signal(c.primary_domain, { verified: false });
    const html =
      "<html><title>Partners</title><body><p>Welcome to our site.</p>" +
      "<p>The company opened a partner program for tool builders today.</p><script>track()</script></body></html>";
    const res = await post(fakeWeb(html), `/api/admin/signals/${id}/evidence`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: { reachable: boolean; title: string }; matches: { sentence: string }[] };
    expect(body.page).toMatchObject({ reachable: true, title: "Partners" });
    expect(body.matches[0]?.sentence).toBe("The company opened a partner program for tool builders today.");
  });

  it("says plainly when the page can't be loaded, without failing", async () => {
    const c = await company();
    const id = await signal(c.primary_domain, { verified: false });
    const res = await post(fakeWeb("gone", 404), `/api/admin/signals/${id}/evidence`);
    expect(await res.json()).toMatchObject({ page: { reachable: false, error: "the site answered 404" }, matches: [] });
  });

  it("checks a company's homepage loads and names the company", async () => {
    const c = await company();
    const ok = await post(
      fakeWeb(`<title>${c.name} | Home</title><p>Payments for agents.</p>`),
      `/api/admin/companies/${c.id}/evidence`,
    );
    expect(await ok.json()).toMatchObject({ page: { reachable: true }, name_found: true });
    const parked = await post(fakeWeb("<title>Domain for sale</title>"), `/api/admin/companies/${c.id}/evidence`);
    expect(await parked.json()).toMatchObject({ name_found: false });
  });

  it("is admin-only", async () => {
    expect((await call("/api/admin/signals/x/evidence", { method: "POST", as: null })).status).toBe(401);
    expect((await post(fakeWeb(""), "/api/admin/signals/nope/evidence")).status).toBe(404);
  });
});
