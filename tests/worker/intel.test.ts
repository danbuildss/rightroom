import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { createApp } from "../../worker/app.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { call } from "./helpers.ts";

const ADMIN = "admin@talo.example";
const app = createApp();
let n = 0;

async function company(verify = true) {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({
      name: `Intel Co ${n}`,
      domain: `intel${n}.example`,
      description: "Payments API.",
      categories: ["payments"],
    }),
    ADMIN,
  );
  if (verify)
    await reviewCompany(env.DB, c.id, { action: "verify", checked_url: `https://${c.primary_domain}` }, ADMIN);
  return c;
}

async function founderCookie() {
  n += 1;
  const ws = `ws-intel-${n}`;
  const token = `intel-session-token-${n}-abcdefghijkl`;
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
    ).bind(`fi-${n}`, ws, `did:privy:intel${n}`, at, at),
    env.DB.prepare(
      "INSERT INTO founder_profiles (workspace_id, one_liner, goals_json, updated_at) VALUES (?, 'Payments API for SMEs', '[\"integrations\"]', ?)",
    ).bind(ws, at),
    env.DB.prepare(
      "INSERT INTO founder_sessions (id, workspace_id, founder_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(hash, ws, `fi-${n}`, at, far),
  ]);
  return `__Host-rr_session=${token}`;
}

const page = (slug: string, cookie?: string) =>
  app.fetch(
    new Request(`https://rightroom.example/api/app/companies/${slug}`, { headers: cookie ? { cookie } : {} }),
    env as unknown as Env,
  );
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

describe("contacts and channels (admin)", () => {
  it("requires a name, role and public source for a person, and refuses email addresses as channels", async () => {
    const c = await company();
    expect(
      (
        await post(`/api/admin/companies/${c.id}/contacts`, {
          kind: "person",
          name: "Jane",
          source_url: "https://x.example",
          confidence: "high",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/api/admin/companies/${c.id}/contacts`, {
          kind: "person",
          name: "Jane",
          role: "Head of Partnerships",
          confidence: "high",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(`/api/admin/companies/${c.id}/contacts`, {
          kind: "channel",
          channel_label: "Email",
          url: "mailto:bd@x.example",
          confidence: "high",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/api/admin/companies/missing/contacts", {
          kind: "channel",
          channel_label: "Form",
          url: "https://x.example/form",
          confidence: "high",
        })
      ).status,
    ).toBe(404);
    expect((await call(`/api/admin/companies/${c.id}/contacts`, { as: null })).status).toBe(401);
  });

  it("needs a reason to reject", async () => {
    const c = await company();
    const res = await post(`/api/admin/companies/${c.id}/contacts`, {
      kind: "channel",
      channel_label: "Partner form",
      url: "https://x.example/apply",
      confidence: "high",
    });
    const { contact } = (await res.json()) as { contact: { id: string; status: string } };
    expect(contact.status).toBe("needs_review");
    expect((await post(`/api/admin/contacts/${contact.id}/review`, { action: "reject" })).status).toBe(400);
    expect(
      (await post(`/api/admin/contacts/${contact.id}/review`, { action: "reject", reason: "wrong page" })).status,
    ).toBe(200);
  });
});

describe("company page (founder)", () => {
  it("shows a verified company with suggestions and only verified contacts", async () => {
    const c = await company();
    const person = await post(`/api/admin/companies/${c.id}/contacts`, {
      kind: "person",
      name: "Jane Test",
      role: "Head of Partnerships",
      source_url: `https://${c.primary_domain}/team`,
      confidence: "high",
    });
    const pending = await post(`/api/admin/companies/${c.id}/contacts`, {
      kind: "channel",
      channel_label: "Partner form",
      url: `https://${c.primary_domain}/apply`,
      confidence: "medium",
    });
    const { contact } = (await person.json()) as { contact: { id: string } };
    await post(`/api/admin/contacts/${contact.id}/review`, { action: "verify" });
    expect(pending.status).toBe(201);

    const cookie = await founderCookie();
    const res = await page(c.slug, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      company: { name: string; fit: { factors: unknown[] } };
      people: { name: string; source_url: string; last_checked_at: string | null }[];
      channels: unknown[];
      suggestions: { for_them: string; suggested_role: string; approach: string };
    };
    expect(body.company.name).toBe(c.name);
    expect(body.company.fit.factors).toHaveLength(5);
    expect(body.people).toHaveLength(1);
    expect(body.people[0]).toMatchObject({ name: "Jane Test", source_url: `https://${c.primary_domain}/team` });
    expect(body.people[0]?.last_checked_at).not.toBeNull();
    expect(body.channels).toEqual([]);
    expect(body.suggestions.for_them).toContain("Payments API for SMEs");
  });

  it("hides unverified companies and needs a session", async () => {
    const c = await company(false);
    const cookie = await founderCookie();
    expect((await page(c.slug, cookie)).status).toBe(404);
    expect((await page(c.slug)).status).toBe(401);
  });
});

describe("approved contacts raise contact access", () => {
  it("scores a verified high-confidence named contact at 5", async () => {
    const c = await company();
    const res = await post(`/api/admin/companies/${c.id}/contacts`, {
      kind: "person",
      name: "Sam Test",
      role: "Head of Partnerships",
      source_url: `https://${c.primary_domain}/team`,
      confidence: "high",
    });
    const { contact } = (await res.json()) as { contact: { id: string } };
    const cookie = await founderCookie();
    const before = (await (await page(c.slug, cookie)).json()) as {
      company: { fit: { factors: { factor: string; score: number }[] } };
    };
    expect(before.company.fit.factors.find((f) => f.factor === "contact_access")?.score).toBe(2);
    await post(`/api/admin/contacts/${contact.id}/review`, { action: "verify" });
    const after = (await (await page(c.slug, cookie)).json()) as {
      company: { fit: { factors: { factor: string; score: number }[] } };
    };
    expect(after.company.fit.factors.find((f) => f.factor === "contact_access")?.score).toBe(5);
  });
});
