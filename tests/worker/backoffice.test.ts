import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { signalInputSchema } from "../../shared/signals.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { createSignal } from "../../worker/db/signals.ts";
import { call } from "./helpers.ts";

const ADMIN = "admin@talo.example";
let n = 0;

async function company() {
  n += 1;
  return createCompany(
    env.DB,
    companyInputSchema.parse({
      name: `Back Office Co ${n}`,
      domain: `backoffice${n}.example`,
      description: "Test company.",
      categories: ["payments"],
    }),
    ADMIN,
  );
}

async function signal(domain: string, excerpt = "Our partner program is open to developer tools.") {
  return createSignal(
    env.DB,
    signalInputSchema.parse({
      company_domain: domain,
      signal_type: "partner_program_launched",
      title: "Opened a partner program",
      factual_claim: "The company opened a partner program.",
      source_excerpt: excerpt,
      primary_source: { url: `https://${domain}/partners`, kind: "partner_page", title: "Partners" },
    }),
    ADMIN,
  );
}

const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });

describe("batch review", () => {
  it("approves several items, each under the normal rules, and reports each result", async () => {
    const a = await company();
    const b = await company();
    const res = await post("/api/admin/review/batch", {
      items: [
        { subject_type: "company", id: a.id, action: "verify", checked_url: `https://${a.primary_domain}` },
        { subject_type: "company", id: b.id, action: "verify" },
        { subject_type: "company", id: "missing", action: "verify", checked_url: "https://x.example" },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: number; failed: number; results: { id: string; ok: boolean }[] };
    expect(body.ok).toBe(1);
    expect(body.failed).toBe(2);
    expect(body.results.map((r) => r.ok)).toEqual([true, false, false]);
    const row = await env.DB.prepare("SELECT status FROM companies WHERE id = ?").bind(a.id).first();
    expect(row).toEqual({ status: "verified" });
  });

  it("can undo with reopen", async () => {
    const a = await company();
    await post("/api/admin/review/batch", {
      items: [{ subject_type: "company", id: a.id, action: "verify", checked_url: `https://${a.primary_domain}` }],
    });
    const undo = await post("/api/admin/review/batch", {
      items: [{ subject_type: "company", id: a.id, action: "reopen" }],
    });
    expect(((await undo.json()) as { ok: number }).ok).toBe(1);
    const row = await env.DB.prepare("SELECT status FROM companies WHERE id = ?").bind(a.id).first();
    expect(row).toEqual({ status: "needs_review" });
  });

  it("limits a batch to 50 items and needs admin login", async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ subject_type: "company", id: `x${i}`, action: "reopen" }));
    expect((await post("/api/admin/review/batch", { items })).status).toBe(400);
    expect((await call("/api/admin/review/batch", { method: "POST", as: null, body: "{}" })).status).toBe(401);
  });
});

describe("search summaries can't be verified", () => {
  it("refuses until the excerpt is the source's own words", async () => {
    const c = await company();
    const id = await signal(c.primary_domain, "Search summary, replace with the source's exact words: they opened…");
    const verify = { action: "verify", checked_url: `https://${c.primary_domain}/partners` };
    const refused = await post(`/api/admin/signals/${id}/review`, verify);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/exact words/);

    const fixed = await call(`/api/admin/signals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ source_excerpt: "Our partner program is now open." }),
    });
    expect(fixed.status).toBe(200);
    expect((await post(`/api/admin/signals/${id}/review`, verify)).status).toBe(200);
  });
});

describe("overview", () => {
  it("summarises what needs review, requests, sources and spend", async () => {
    const c = await company();
    await signal(c.primary_domain);
    await call("/api/public/access-requests", {
      method: "POST",
      as: null,
      body: JSON.stringify({ name: "A", email: `ov${n}@test.example`, goal: "Integration partners please." }),
    });
    const res = await call("/api/admin/overview");
    expect(res.status).toBe(200);
    const o = (await res.json()) as {
      waiting: number;
      companies: { needs_review: number };
      signals: { needs_review: number };
      access_requests_new: number;
      sources: { total: number };
      spend: { cap_usd: number; key_configured: boolean };
    };
    expect(o.companies.needs_review).toBeGreaterThan(0);
    expect(o.signals.needs_review).toBeGreaterThan(0);
    expect(o.waiting).toBe(o.companies.needs_review + o.signals.needs_review);
    expect(o.access_requests_new).toBeGreaterThan(0);
    expect(o.spend).toMatchObject({ cap_usd: 50, key_configured: false });
    expect((await call("/api/admin/overview", { as: null })).status).toBe(401);
  });
});
