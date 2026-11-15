import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { signalInputSchema } from "../../shared/signals.ts";
import { createApp } from "../../worker/app.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { createSignal, reviewCompany, reviewSignal } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";

const ADMIN = "admin@talo.example";
const app = createApp();
let n = 0;

async function verifiedCompany(name: string, categories: string[], opts: { sample?: boolean; verify?: boolean } = {}) {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({
      name: `${name} ${n}`,
      domain: `disc${n}.example`,
      description: `${name}: payments API for developers.`,
      categories,
      is_sample: opts.sample ?? false,
    }),
    ADMIN,
  );
  if (opts.verify !== false)
    await reviewCompany(env.DB, c.id, { action: "verify", checked_url: `https://${c.primary_domain}` }, ADMIN);
  return c;
}

async function verifiedSignal(domain: string) {
  const id = await createSignal(
    env.DB,
    signalInputSchema.parse({
      company_domain: domain,
      signal_type: "partner_program_launched",
      title: "Opened a partner program",
      factual_claim: "The company opened a partner program.",
      source_excerpt: "Our partner program is open.",
      event_date: new Date().toISOString().slice(0, 10),
      primary_source: { url: `https://${domain}/partners`, kind: "partner_page", title: "Partners" },
    }),
    ADMIN,
  );
  await reviewSignal(env.DB, id, { action: "verify", checked_url: `https://${domain}/partners` }, ADMIN);
}

async function founderCookie() {
  n += 1;
  const ws = `ws-disc-${n}`;
  const token = `disc-session-token-${n}-abcdefghijkl`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const at = new Date().toISOString();
  const far = new Date(Date.now() + 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces (id, name, owner_email, created_at) VALUES (?, 'F', 'f@test.example', ?)",
    ).bind(ws, at),
    env.DB.prepare(
      "INSERT INTO founders (id, workspace_id, privy_did, name, created_at, last_sign_in_at) VALUES (?, ?, ?, 'F', ?, ?)",
    ).bind(`f-${n}`, ws, `did:privy:disc${n}`, at, at),
    env.DB.prepare(
      "INSERT INTO founder_profiles (workspace_id, one_liner, goals_json, updated_at) VALUES (?, 'Payments API for small businesses', '[\"integrations\"]', ?)",
    ).bind(ws, at),
    env.DB.prepare(
      "INSERT INTO founder_sessions (id, workspace_id, founder_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(hash, ws, `f-${n}`, at, far),
  ]);
  return `__Host-rr_session=${token}`;
}

const get = (path: string, cookie?: string) =>
  app.fetch(
    new Request(`https://rightroom.example/api/app${path}`, { headers: cookie ? { cookie } : {} }),
    env as unknown as Env,
  );

describe("Discover API", () => {
  it("needs a signed-in founder", async () => {
    expect((await get("/discover?q=payments")).status).toBe(401);
  });

  it("ranks verified companies only, with factor reasons and verified signals", async () => {
    const strong = await verifiedCompany("Ranked Pay", ["payments", "dev-platforms"]);
    await verifiedSignal(strong.primary_domain);
    await verifiedCompany("Quiet Pay", ["payments"]);
    const hidden = await verifiedCompany("Unverified Pay", ["payments"], { verify: false });
    const sample = await verifiedCompany("Sample Pay", ["payments"], { sample: true });
    const cookie = await founderCookie();

    const res = await get(
      `/discover?q=${encodeURIComponent("fintech that could integrate our payments API in Africa")}`,
      cookie,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      understood: { categories: { slug: string }[]; goals: string[]; places: string[] };
      verified_total: number;
      results: {
        name: string;
        fit: { label: string; overall: number | null; factors: { reason: string }[] };
        signals: { sources: { url: string }[] }[];
      }[];
    };
    expect(body.understood.categories.map((c) => c.slug)).toEqual(
      expect.arrayContaining(["payments", "dev-platforms"]),
    );
    expect(body.understood.goals).toContain("integrations");
    expect(body.understood.places).toEqual(["africa"]);
    const names = body.results.map((r) => r.name);
    expect(names).toContain(strong.name);
    expect(names).not.toContain(hidden.name);
    expect(names).not.toContain(sample.name);
    const top = body.results.find((r) => r.name === strong.name)!;
    expect(["strong", "potential"]).toContain(top.fit.label);
    expect(top.fit.factors).toHaveLength(5);
    expect(top.signals[0]?.sources[0]?.url).toMatch(/\/partners$/);
    const quiet = body.results.find((r) => r.name.startsWith("Quiet Pay"));
    if (quiet) expect(quiet.fit).toMatchObject({ label: "needs_verification", overall: null });
    expect(body.results.indexOf(top)).toBeLessThan(quiet ? body.results.indexOf(quiet) : Number.POSITIVE_INFINITY);
  });

  it("lets the founder override what was read, and filter by a sector chip", async () => {
    const cookie = await founderCookie();
    const res = await get("/discover?q=payments&cats=&goals=distribution&category=wallets", cookie);
    const body = (await res.json()) as {
      understood: { categories: unknown[]; goals: string[] };
      results: { categories: { slug: string }[] }[];
    };
    expect(body.understood.categories).toEqual([]);
    expect(body.understood.goals).toEqual(["distribution"]);
    for (const r of body.results) expect(r.categories.map((c) => c.slug)).toContain("wallets");
    expect((await get("/discover?goals=parties", cookie)).status).toBe(400);
  });

  it("shows companies openly looking for partners outside the founder's focus, instead of hiding them", async () => {
    const cookie = await founderCookie();
    const other = await verifiedCompany("Walrus Games", ["solana"]);
    await env.DB.prepare("UPDATE companies SET description = 'Mobile games studio.' WHERE id = ?").bind(other.id).run();
    await verifiedSignal(other.primary_domain);
    const body = (await (await get("/discover?q=", cookie)).json()) as {
      results: { slug: string }[];
      others: { slug: string; name: string }[];
    };
    expect(body.results.some((r) => r.slug === other.slug)).toBe(false);
    expect(body.others.some((r) => r.slug === other.slug)).toBe(true);

    const intel = (await (await get(`/companies/${other.slug}`, cookie)).json()) as {
      suggestions: { structures: { name: string; why: string }[] };
    };
    expect(intel.suggestions.structures.map((x) => x.name)).toContain("Referral or reseller partnership");
  });
});
