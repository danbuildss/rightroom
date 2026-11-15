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
      domain: `exp${n}.example`,
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
  const ws = `ws-exp-${n}`;
  const token = `exp-session-token-${n}-abcdefghijkl`;
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
    ).bind(`f-${n}`, ws, `did:privy:exp${n}`, at, at),
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

type ExploreBody = {
  total: number;
  results: {
    slug: string;
    name: string;
    profile: { type: string; country: string | null; stage: string | null; audiences: string[] } | null;
    partnership_types: string[];
    latest_signal: { type_label: string } | null;
    angle: string | null;
    fit: { label: string; overall: number } | null;
    saved: unknown;
  }[];
  facets: {
    types: { type: string; label: string; count: number }[];
    sectors: { slug: string; count: number }[];
    countries: { code: string; count: number }[];
    goals: { goal: string; count: number }[];
  };
};
const explore = async (query: string, cookie: string) =>
  (await (await get(`/explore?${query}`, cookie)).json()) as ExploreBody;
const setProfile = (id: string, sql: string) =>
  env.DB.prepare(`UPDATE companies SET ${sql} WHERE id = ?`).bind(id).run();

describe("Explore API", () => {
  it("needs a founder session and refuses bad filters", async () => {
    expect((await get("/explore")).status).toBe(401);
    const cookie = await founderCookie();
    expect((await get("/explore?type=bank", cookie)).status).toBe(400);
    expect((await get("/explore?country=usa", cookie)).status).toBe(400);
  });

  it("shows every verified company, including ones that aren't a fit, and never samples or unverified ones", async () => {
    const cookie = await founderCookie();
    const fit = await verifiedCompany("Zebra Pay", ["payments"]);
    await verifiedSignal(fit.primary_domain);
    const unrelated = await verifiedCompany("Zebra Games", ["solana"]);
    await env.DB.prepare("UPDATE companies SET description = 'Mobile games studio.' WHERE id = ?")
      .bind(unrelated.id)
      .run();
    await verifiedCompany("Zebra Sample", ["payments"], { sample: true });
    await verifiedCompany("Zebra Unverified", ["payments"], { verify: false });

    const body = await explore("q=zebra", cookie);
    const names = body.results.map((r) => r.name);
    expect(names.some((x) => x.startsWith("Zebra Pay"))).toBe(true);
    expect(names.some((x) => x.startsWith("Zebra Games"))).toBe(true);
    expect(names.some((x) => x.startsWith("Zebra Sample") || x.startsWith("Zebra Unverified"))).toBe(false);

    const pay = body.results.find((r) => r.name.startsWith("Zebra Pay"))!;
    expect(pay.fit?.label).toMatch(/strong|potential/);
    expect(pay.latest_signal?.type_label).toBe("Partner program launched");
    expect(pay.partnership_types).toEqual(expect.arrayContaining(["integrations", "distribution"]));
    expect(pay.angle).toMatch(/partner program/i);
    const games = body.results.find((r) => r.name.startsWith("Zebra Games"))!;
    expect(games.fit).toBeNull();
    expect(games.angle).toBeNull();
    expect(games.partnership_types).toEqual([]);
  });

  it("shows a profile and its category only once Dan has confirmed it", async () => {
    const cookie = await founderCookie();
    const a = await verifiedCompany("Yak Platform", ["dev-platforms"]);
    const b = await verifiedCompany("Yak Network", ["dev-platforms"]);
    await setProfile(
      a.id,
      "org_type = 'platform_api', hq_country = 'NG', stage = 'growth', audiences_json = '[\"developers\"]', profile_status = 'confirmed'",
    );
    await setProfile(b.id, "org_type = 'ecosystem', profile_status = 'suggested'");

    const body = await explore("q=yak", cookie);
    expect(body.results.find((r) => r.name.startsWith("Yak Platform"))?.profile).toEqual({
      type: "platform_api",
      country: "NG",
      stage: "growth",
      audiences: ["developers"],
    });
    expect(body.results.find((r) => r.name.startsWith("Yak Network"))?.profile).toBeNull();
    expect(body.facets.types).toEqual([
      expect.objectContaining({ type: "platform_api", label: "Platforms & APIs", count: 1 }),
    ]);
    expect(body.facets.countries).toEqual([{ code: "NG", count: 1 }]);

    const typed = await explore("q=yak&type=platform_api", cookie);
    expect(typed.total).toBe(1);
    expect((await explore("q=yak&type=ecosystem", cookie)).total).toBe(0);
    expect((await explore("q=yak&country=NG&stage=growth&audience=developers", cookie)).total).toBe(1);
    expect((await explore("q=yak&audience=b2c", cookie)).total).toBe(0);
  });

  it("filters by sector and partner goal, sorts, and pages", async () => {
    const cookie = await founderCookie();
    const x = await verifiedCompany("Quokka One", ["payments"]);
    await verifiedSignal(x.primary_domain);
    await verifiedCompany("Quokka Two", ["wallets"]);
    await verifiedCompany("Quokka Three", ["wallets"]);

    expect((await explore("q=quokka&sector=wallets", cookie)).total).toBe(2);
    expect((await explore("q=quokka&goal=integrations", cookie)).results.map((r) => r.name)).toEqual([x.name]);
    const bySignal = await explore("q=quokka", cookie);
    expect(bySignal.results[0]?.name).toBe(x.name);
    const byName = await explore("q=quokka&sort=name", cookie);
    expect(byName.results.map((r) => r.name)).toEqual([...byName.results.map((r) => r.name)].sort());
    const page = await explore("q=quokka&sort=name&limit=2&offset=2", cookie);
    expect(page.total).toBe(3);
    expect(page.results).toHaveLength(1);
  });
});
