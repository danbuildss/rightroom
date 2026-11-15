import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { signalInputSchema } from "../../shared/signals.ts";
import { createApp } from "../../worker/app.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { createSignal, reviewCompany, reviewSignal } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { call, founderSession } from "./helpers.ts";

const ADMIN = "admin@talo.example";
const app = createApp();
let n = 0;

async function companyWithSignal() {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({
      name: `Draft Co ${n}`,
      domain: `draftco${n}.example`,
      description: "Payments API.",
      categories: ["payments"],
    }),
    ADMIN,
  );
  await reviewCompany(env.DB, c.id, { action: "verify", checked_url: `https://${c.primary_domain}` }, ADMIN);
  const sid = await createSignal(
    env.DB,
    signalInputSchema.parse({
      company_domain: c.primary_domain,
      signal_type: "partner_program_launched",
      title: "Opened a partner program",
      factual_claim: "They opened a partner program.",
      source_excerpt: "Our partner program is open.",
      event_date: new Date().toISOString().slice(0, 10),
      primary_source: { url: `https://${c.primary_domain}/partners`, kind: "partner_page", title: "Partners" },
    }),
    ADMIN,
  );
  await reviewSignal(env.DB, sid, { action: "verify", checked_url: `https://${c.primary_domain}/partners` }, ADMIN);
  return c;
}

function req(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://rightroom.example/api/app${path}`, { ...init, headers }),
    env as unknown as Env,
  );
}

describe("draft introductions", () => {
  it("generates a draft with its sources, addressed to a verified person when there is one", async () => {
    const c = await companyWithSignal();
    const added = await call(`/api/admin/companies/${c.id}/contacts`, {
      method: "POST",
      body: JSON.stringify({
        kind: "person",
        name: "Jane Test",
        role: "Head of Partnerships",
        source_url: `https://${c.primary_domain}/team`,
        confidence: "high",
      }),
    });
    const { contact } = (await added.json()) as { contact: { id: string } };
    await call(`/api/admin/contacts/${contact.id}/review`, {
      method: "POST",
      body: JSON.stringify({ action: "verify" }),
    });
    const { cookie } = await founderSession({ name: "Ada Test", company_name: "Example Co" });

    const res = await req(`/companies/${c.slug}/draft`, cookie);
    expect(res.status).toBe(200);
    const d = (await res.json()) as {
      subject: string;
      message: string;
      recipient: string;
      sources: { kind: string; url: string | null }[];
    };
    expect(d.message).toContain("Hi Jane,");
    expect(d.message).toContain("opened its partner program");
    expect(d.recipient).toBe("Jane Test · Head of Partnerships");
    expect(d.sources.map((s) => s.kind)).toEqual(["verified", "verified", "yours"]);

    const team = (await (await req(`/companies/${c.slug}/draft?to=team&variant=shorter`, cookie)).json()) as {
      message: string;
    };
    expect(team.message).toContain(`Hi ${c.name} team,`);
    expect((await req(`/companies/${c.slug}/draft?variant=essay`, cookie)).status).toBe(400);
  });

  it("saves, lists, marks sent and deletes drafts, privately per founder", async () => {
    const c = await companyWithSignal();
    const a = await founderSession();
    const b = await founderSession();
    const saved = await req(`/companies/${c.slug}/drafts`, a.cookie, {
      method: "POST",
      body: JSON.stringify({
        variant: "first",
        recipient: "Team",
        subject: "Hello",
        message: "Hi team, a short note.",
      }),
    });
    expect(saved.status).toBe(201);
    const { draft } = (await saved.json()) as { draft: { id: string; status: string } };
    expect(draft.status).toBe("draft");

    const list = (await (await req(`/companies/${c.slug}/drafts`, a.cookie)).json()) as { drafts: unknown[] };
    expect(list.drafts).toHaveLength(1);
    const other = (await (await req(`/companies/${c.slug}/drafts`, b.cookie)).json()) as { drafts: unknown[] };
    expect(other.drafts).toHaveLength(0);
    expect(
      (await req(`/drafts/${draft.id}`, b.cookie, { method: "PATCH", body: JSON.stringify({ status: "sent" }) }))
        .status,
    ).toBe(404);
    expect((await req(`/drafts/${draft.id}`, b.cookie, { method: "DELETE" })).status).toBe(404);

    const sent = (await (
      await req(`/drafts/${draft.id}`, a.cookie, { method: "PATCH", body: JSON.stringify({ status: "sent" }) })
    ).json()) as {
      draft: { status: string; sent_at: string | null };
    };
    expect(sent.draft.status).toBe("sent");
    expect(sent.draft.sent_at).not.toBeNull();
    expect((await req(`/drafts/${draft.id}`, a.cookie, { method: "DELETE" })).status).toBe(200);
    expect((await req(`/companies/missing-co/drafts`, a.cookie)).status).toBe(404);
  });
});
