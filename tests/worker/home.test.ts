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
      domain: `home${n}.example`,
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
  const ws = `ws-home-${n}`;
  const token = `home-session-token-${n}-abcdefghijkl`;
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
    ).bind(`f-${n}`, ws, `did:privy:home${n}`, at, at),
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
const send = (method: string, path: string, cookie: string, body: unknown = {}) =>
  app.fetch(
    new Request(`https://rightroom.example/api/app${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as unknown as Env,
  );

type HomeBody = {
  counts: { due: number; saved: number; signals_this_week: number };
  due: { name: string; days_late: number }[];
  matches: { name: string; fit: { label: string } }[];
  signals: { company: string; saved: boolean; type_label: string; source: string | null }[];
  added: { name: string }[];
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

describe("Home and the bell", () => {
  it("need a founder session", async () => {
    expect((await get("/home")).status).toBe(401);
    expect((await get("/updates")).status).toBe(401);
  });

  it("show follow-ups due, this week's verified signals, top matches and recently added companies", async () => {
    const cookie = await founderCookie();
    const pay = await verifiedCompany("Heron Pay", ["payments"]);
    await verifiedSignal(pay.primary_domain);
    const other = await verifiedCompany("Heron Games", ["solana"]);

    // Save both; one follow-up is 2 days late, one is in the future.
    const s1 = (await (await send("POST", `/companies/${pay.slug}/save`, cookie)).json()) as { saved: { id: string } };
    const s2 = (await (await send("POST", `/companies/${other.slug}/save`, cookie)).json()) as {
      saved: { id: string };
    };
    expect((await send("PATCH", `/pipeline/${s1.saved.id}`, cookie, { follow_up_at: daysAgo(2) })).status).toBe(200);
    await send("PATCH", `/pipeline/${s2.saved.id}`, cookie, { follow_up_at: daysAgo(-5) });

    const h = (await (await get("/home", cookie)).json()) as HomeBody;
    expect(h.counts.due).toBe(1);
    expect(h.counts.saved).toBe(2);
    expect(h.due).toEqual([expect.objectContaining({ name: pay.name, days_late: 2 })]);
    const sig = h.signals.find((s) => s.company === pay.name);
    expect(sig).toMatchObject({ saved: true, type_label: "Partner program launched" });
    expect(sig?.source).toMatch(/^https:\/\//);
    expect(h.matches.map((m) => m.name)).toContain(pay.name);
    expect(h.matches.map((m) => m.name)).not.toContain(other.name);
    expect(h.added.length).toBeGreaterThan(0);

    const u = (await (await get("/updates", cookie)).json()) as {
      count: number;
      items: { kind: string; name: string }[];
    };
    expect(u.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "follow_up", name: pay.name }),
        expect.objectContaining({ kind: "signal", name: pay.name }),
      ]),
    );
    expect(u.items.some((i) => i.name === other.name)).toBe(false);
  });

  it("is empty for a new founder, with nothing invented", async () => {
    const cookie = await founderCookie();
    const h = (await (await get("/home", cookie)).json()) as HomeBody;
    expect(h.counts.due).toBe(0);
    expect(h.counts.saved).toBe(0);
    expect(h.due).toEqual([]);
    const u = (await (await get("/updates", cookie)).json()) as { count: number };
    expect(u.count).toBe(0);
  });
});
