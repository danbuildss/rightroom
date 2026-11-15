import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { addDays } from "../../shared/pipeline.ts";
import { companyInputSchema } from "../../shared/registry.ts";
import { createApp } from "../../worker/app.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { founderSession } from "./helpers.ts";

const ADMIN = "admin@talo.example";
const app = createApp();
let n = 0;

async function company(verify = true) {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({
      name: `Pipe Co ${n}`,
      domain: `pipeco${n}.example`,
      description: "Payments API.",
      categories: ["payments"],
    }),
    ADMIN,
  );
  if (verify)
    await reviewCompany(env.DB, c.id, { action: "verify", checked_url: `https://${c.primary_domain}` }, ADMIN);
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
const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

describe("pipeline", () => {
  it("saves a company once, to Shortlisted", async () => {
    const c = await company();
    const { cookie } = await founderSession();
    const first = await json<{ saved: { id: string; stage: string } }>(
      req(`/companies/${c.slug}/save`, cookie, { method: "POST", body: "{}" }),
    );
    const again = await json<{ saved: { id: string } }>(
      req(`/companies/${c.slug}/save`, cookie, { method: "POST", body: "{}" }),
    );
    expect(first.saved.stage).toBe("shortlisted");
    expect(again.saved.id).toBe(first.saved.id);
    const list = await json<{ items: { name: string; stage: string }[] }>(req("/pipeline", cookie));
    expect(list.items).toEqual([expect.objectContaining({ name: c.name, stage: "shortlisted" })]);
    const unverified = await company(false);
    expect((await req(`/companies/${unverified.slug}/save`, cookie, { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("moves stages, sets and clears follow-ups, keeps notes, and records a timeline", async () => {
    const c = await company();
    const { cookie } = await founderSession();
    const { saved } = await json<{ saved: { id: string } }>(
      req(`/companies/${c.slug}/save`, cookie, { method: "POST", body: "{}" }),
    );
    const patch = (body: unknown) =>
      req(`/pipeline/${saved.id}`, cookie, { method: "PATCH", body: JSON.stringify(body) });
    expect((await patch({ stage: "in_discussion", follow_up_at: "2026-11-20", notes: "Call booked." })).status).toBe(
      200,
    );
    const today = new Date().toISOString().slice(0, 10);
    await patch({ follow_up_at: today });
    const list = await json<{ items: { stage: string; follow_up_at: string; notes: string }[]; due: number }>(
      req("/pipeline", cookie),
    );
    expect(list.items[0]).toMatchObject({ stage: "in_discussion", follow_up_at: today, notes: "Call booked." });
    expect(list.due).toBe(1);
    await patch({ follow_up_at: null });
    expect((await patch({ stage: "done" })).status).toBe(400);
    expect((await patch({ follow_up_at: "next week" })).status).toBe(400);
    const { events } = await json<{ events: { text: string }[] }>(req(`/pipeline/${saved.id}/timeline`, cookie));
    expect(events.map((e) => e.text)).toEqual(
      expect.arrayContaining(["Saved to Shortlisted", "Moved to In discussion", "Follow-up cleared"]),
    );
  });

  it("'I sent it' saves the company, moves it to Contacted and suggests a follow-up a week later", async () => {
    const c = await company();
    const { cookie } = await founderSession();
    const { draft } = await json<{ draft: { id: string } }>(
      req(`/companies/${c.slug}/drafts`, cookie, {
        method: "POST",
        body: JSON.stringify({
          variant: "first",
          recipient: "Team",
          channel_label: "Partner form",
          message: "Hi team.",
        }),
      }),
    );
    await req(`/drafts/${draft.id}`, cookie, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
    const list = await json<{ items: { id: string; stage: string; follow_up_at: string; last_sent_via: string }[] }>(
      req("/pipeline", cookie),
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(list.items[0]).toMatchObject({
      stage: "contacted",
      follow_up_at: addDays(today, 7),
      last_sent_via: "Partner form",
    });
    const { events } = await json<{ events: { text: string }[] }>(
      req(`/pipeline/${list.items[0]?.id}/timeline`, cookie),
    );
    expect(events.map((e) => e.text)).toEqual(
      expect.arrayContaining([
        "You marked an introduction as sent (Partner form)",
        "Moved to Contacted (automatic, from “I sent it”)",
      ]),
    );
  });

  it("never moves a company backwards when another introduction is sent", async () => {
    const c = await company();
    const { cookie } = await founderSession();
    const { saved } = await json<{ saved: { id: string } }>(
      req(`/companies/${c.slug}/save`, cookie, { method: "POST", body: "{}" }),
    );
    await req(`/pipeline/${saved.id}`, cookie, { method: "PATCH", body: JSON.stringify({ stage: "partnered" }) });
    const { draft } = await json<{ draft: { id: string } }>(
      req(`/companies/${c.slug}/drafts`, cookie, {
        method: "POST",
        body: JSON.stringify({ variant: "follow_up", recipient: "Team", message: "Hi again." }),
      }),
    );
    await req(`/drafts/${draft.id}`, cookie, { method: "PATCH", body: JSON.stringify({ status: "sent" }) });
    const list = await json<{ items: { stage: string }[] }>(req("/pipeline", cookie));
    expect(list.items[0]?.stage).toBe("partnered");
  });

  it("is private to each founder", async () => {
    const c = await company();
    const a = await founderSession();
    const b = await founderSession();
    const { saved } = await json<{ saved: { id: string } }>(
      req(`/companies/${c.slug}/save`, a.cookie, { method: "POST", body: "{}" }),
    );
    expect((await json<{ items: unknown[] }>(req("/pipeline", b.cookie))).items).toHaveLength(0);
    expect(
      (await req(`/pipeline/${saved.id}`, b.cookie, { method: "PATCH", body: JSON.stringify({ stage: "partnered" }) }))
        .status,
    ).toBe(404);
    expect((await req(`/pipeline/${saved.id}/timeline`, b.cookie)).status).toBe(404);
    expect((await req(`/pipeline/${saved.id}`, b.cookie, { method: "DELETE" })).status).toBe(404);
    expect((await req(`/pipeline/${saved.id}`, a.cookie, { method: "DELETE" })).status).toBe(200);
  });
});
