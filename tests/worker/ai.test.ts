import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { appWithFetcher, token } from "./helpers.ts";

let n = 0;
type Sent = { url: string; body: string; auth: string | null };

/** A fake web: Bankr's gateway answers with `answer`, and team homepages answer with `page`. */
function fake(answer: (prompt: string) => unknown, page: string, sent: Sent[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    sent.push({ url, body: String(init?.body ?? ""), auth: headers.get("authorization") });
    if (url === "https://llm.bankr.bot/v1/models")
      return Response.json({ data: [{ id: "fast-model" }, { id: "big-model" }] });
    if (url === "https://llm.bankr.bot/v1/chat/completions") {
      const prompt = JSON.parse(String(init?.body))
        .messages.map((m: { content: string }) => m.content)
        .join("\n");
      return Response.json({
        choices: [{ message: { content: JSON.stringify(answer(prompt)) } }],
        usage: { prompt_tokens: 1200, completion_tokens: 80 },
      });
    }
    return new Response(page, { headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}
async function admin(fetcher: typeof fetch, method: string, path: string, body?: unknown, vars: Partial<Env> = {}) {
  return appWithFetcher(fetcher).fetch(
    new Request(`https://talo.example/api/admin${path}`, {
      method,
      headers: { "Cf-Access-Jwt-Assertion": await token(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { ...env, BANKR_LLM_KEY: "test-bankr-key", ...vars } as unknown as Env,
  );
}

describe("AI helpers (Bankr)", () => {
  it("is off without a key or a model, lists models, and records a test call", async () => {
    const none = (async () => new Response("x")) as unknown as typeof fetch;
    const off = (await (await admin(none, "GET", "/ai", undefined, { BANKR_LLM_KEY: undefined })).json()) as {
      key_set: boolean;
      on: boolean;
    };
    expect(off).toMatchObject({ key_set: false, on: false });

    const sent: Sent[] = [];
    const f = fake(() => ({ ok: true }), "", sent);
    expect(await (await admin(f, "GET", "/ai/models")).json()).toEqual({ models: ["big-model", "fast-model"] });
    expect((await admin(f, "POST", "/ai/test")).status).toBe(503); // no model chosen yet
    await admin(f, "POST", "/ai/model", { model: "fast-model" });
    const t = (await (await admin(f, "POST", "/ai/test")).json()) as { ok: boolean };
    expect(t.ok).toBe(true);
    const call = sent.find((s) => s.url.endsWith("/chat/completions"));
    expect(call?.auth).toBe("Bearer test-bankr-key");
    expect(JSON.parse(call?.body ?? "{}").model).toBe("fast-model");
    const st = (await (await admin(f, "GET", "/ai")).json()) as {
      on: boolean;
      budget: { spent: number };
      month: { calls: number };
    };
    expect(st.on).toBe(true);
    expect(st.budget.spent).toBeGreaterThan(0);
    expect(st.month.calls).toBeGreaterThanOrEqual(1);
  });

  it("checks a new company with the AI, and approving uses its name, one-liner, type and stage", async () => {
    n += 1;
    const domain = `aico${n}.example`;
    await env.DB.prepare(
      `INSERT INTO company_candidates (id, domain, found_via, found_url, found_title, site_checked_at, created_at)
       VALUES (?, ?, 'hn', 'https://news.ycombinator.com/item?id=1', 'Show HN: thing', '2026-11-15T00:00:00Z', '2026-11-15T00:00:00Z')`,
    )
      .bind(`cand-ai-${n}`, domain)
      .run();
    const f = fake(
      () => ({
        is_company: true,
        reason: "A payments API product with a team.",
        name: `AI Co ${n}`,
        one_liner: "Payments API for AI agents (fictional).",
        org_type: "platform_api",
        sectors: ["payments", "not-a-sector"],
        stage: "early",
        audiences: ["developers"],
      }),
      "<h1>AI Co</h1><p>Payments API for agents.</p>",
    );
    await admin(f, "POST", "/ai/model", { model: "fast-model" });
    const r = (await (await admin(f, "POST", `/candidates/cand-ai-${n}/ai-check`)).json()) as {
      ai: { sectors: string[] };
    };
    expect(r.ai.sectors).toEqual(["payments"]);
    const list = (await (await admin(f, "GET", "/candidates")).json()) as {
      candidates: { id: string; ai: { is_company: boolean } | null }[];
    };
    expect(list.candidates.find((c) => c.id === `cand-ai-${n}`)?.ai?.is_company).toBe(true);

    const ok = (await (await admin(f, "POST", "/candidates/approve", { ids: [`cand-ai-${n}`] })).json()) as {
      results: { company_id: string }[];
    };
    const co = await env.DB.prepare(
      "SELECT name, description, org_type, stage, audiences_json FROM companies WHERE id = ?",
    )
      .bind(ok.results[0]?.company_id)
      .first();
    expect(co).toMatchObject({
      name: `AI Co ${n}`,
      description: "Payments API for AI agents (fictional).",
      org_type: "platform_api",
      stage: "early",
      audiences_json: '["developers"]',
    });
  });

  it("finds contacts with the AI, keeping only names on the page and leaving out investors", async () => {
    n += 1;
    const c = await createCompany(
      env.DB,
      companyInputSchema.parse({ name: `Team Co ${n}`, domain: `teamco${n}.example` }),
      "admin@talo.example",
    );
    await reviewCompany(
      env.DB,
      c.id,
      { action: "verify", checked_url: `https://${c.primary_domain}` },
      "admin@talo.example",
    );
    const f = fake(
      () => ({
        people: [
          { name: "Ada Okafor", role: "Co-founder, CEO" },
          { name: "Invented Person", role: "Head of Partnerships" },
          { name: "Ben Fund", role: "Angel investor" },
        ],
      }),
      "<p>Ada Okafor leads the company as Co-founder, CEO.</p><p>Ben Fund, Angel investor</p>",
    );
    await admin(f, "POST", "/ai/model", { model: "fast-model" });
    await admin(f, "POST", `/companies/${c.id}/contacts/find`);
    const { results } = await env.DB.prepare(
      "SELECT name, created_by, status FROM company_contacts WHERE company_id = ?",
    )
      .bind(c.id)
      .all<{ name: string; created_by: string; status: string }>();
    expect(results).toEqual([{ name: "Ada Okafor", created_by: "ai-website-reader", status: "needs_review" }]);
  });

  it("stops at the monthly cap", async () => {
    const f = fake(() => ({ ok: true }), "");
    await admin(f, "POST", "/ai/model", { model: "fast-model" });
    const res = await admin(f, "POST", "/ai/test", undefined, { AI_MONTHLY_CAP_USD: "0.000001" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/budget reached/);
  });
});
