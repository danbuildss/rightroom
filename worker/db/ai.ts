/**
 * AI helpers through Dan's Bankr LLM gateway (OpenAI-compatible: https://llm.bankr.bot/v1/chat/completions).
 * Back-office only, and only public website text is sent: never founders' data, drafts or notes.
 *
 * - Off until BANKR_LLM_KEY (a Cloudflare secret) is set and Dan picks a model in the back office.
 * - Every call is recorded with Rightroom's cost estimate; none starts once the monthly cap
 *   (AI_MONTHLY_CAP_USD, default 20) is reached.
 * - The AI suggests (is this a real company, its one-liner and type; who works there); Dan approves.
 */
import {
  type CandidateAnswer,
  candidateAnswer,
  candidatePrompt,
  jsonFrom,
  onPage,
  pageText,
  peopleAnswer,
  peoplePrompt,
} from "../../shared/ai.ts";
import { USER_AGENT } from "./collector.ts";
import { newId, nowIso } from "./util.ts";

export interface AiEnv {
  BANKR_LLM_KEY?: string;
  AI_MONTHLY_CAP_USD?: string;
  AI_PRICE_INPUT_PER_M_USD?: string;
  AI_PRICE_OUTPUT_PER_M_USD?: string;
}

const GATEWAY = "https://llm.bankr.bot/v1";
const DEFAULT_CAP = 20;
const num = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
const prices = (env: AiEnv) => ({
  input: num(env.AI_PRICE_INPUT_PER_M_USD, 3),
  output: num(env.AI_PRICE_OUTPUT_PER_M_USD, 15),
});

export async function getSetting(db: D1Database, key: string) {
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
export async function setSetting(db: D1Database, key: string, value: string, by: string) {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(key, value, by, nowIso())
    .run();
}

async function spentThisMonth(db: D1Database, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const r = await db
    .prepare("SELECT COALESCE(SUM(estimated_usd), 0) AS total FROM ai_calls WHERE created_at >= ?")
    .bind(start)
    .first<{ total: number }>();
  return r?.total ?? 0;
}

export async function aiStatus(db: D1Database, env: AiEnv) {
  const cap = num(env.AI_MONTHLY_CAP_USD, DEFAULT_CAP);
  const spent = await spentThisMonth(db);
  const model = await getSetting(db, "ai_model");
  const { results } = await db
    .prepare(
      "SELECT purpose, model, status, input_tokens, output_tokens, estimated_usd, error, created_at FROM ai_calls ORDER BY created_at DESC LIMIT 15",
    )
    .all();
  const counts = await db
    .prepare(
      `SELECT COUNT(*) AS calls, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM ai_calls
       WHERE created_at >= ?`,
    )
    .bind(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString())
    .first<{ calls: number; failed: number }>();
  return {
    key_set: Boolean(env.BANKR_LLM_KEY),
    model,
    on: Boolean(env.BANKR_LLM_KEY && model),
    budget: {
      cap,
      spent: Math.round(spent * 10_000) / 10_000,
      left: Math.max(0, Math.round((cap - spent) * 10_000) / 10_000),
    },
    prices: prices(env),
    month: { calls: counts?.calls ?? 0, failed: counts?.failed ?? 0 },
    recent: results,
  };
}

/** The models Bankr offers, from its OpenAI-compatible /models list. */
export async function listModels(env: AiEnv, fetcher: typeof fetch = fetch): Promise<string[]> {
  if (!env.BANKR_LLM_KEY) return [];
  const res = await fetcher(`${GATEWAY}/models`, {
    headers: { authorization: `Bearer ${env.BANKR_LLM_KEY}`, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`llm.bankr.bot answered ${res.status}`);
  const body = (await res.json()) as { data?: { id?: string }[] };
  return (body.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string")
    .sort();
}

export class AiOffError extends Error {}

/** One chat call, inside the cap; the answer text, or a thrown error (recorded either way). */
export async function askAi(
  db: D1Database,
  env: AiEnv,
  call: {
    purpose: "candidate" | "contacts" | "test";
    subject_id?: string;
    system: string;
    user: string;
    max_tokens?: number;
  },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const model = await getSetting(db, "ai_model");
  if (!env.BANKR_LLM_KEY || !model) throw new AiOffError("AI helpers are off (no key or no model chosen)");
  const cap = num(env.AI_MONTHLY_CAP_USD, DEFAULT_CAP);
  const p = prices(env);
  const maxTokens = call.max_tokens ?? 600;
  // A cautious estimate of this call, checked against what's left this month.
  const estimate = ((call.system.length + call.user.length) / 3 / 1e6) * p.input + (maxTokens / 1e6) * p.output;
  const spent = await spentThisMonth(db);
  if (spent + estimate > cap) throw new AiOffError(`AI budget reached (${spent.toFixed(2)} of ${cap} USD this month)`);

  const record = (status: "ok" | "failed", inTok: number, outTok: number, error: string | null) =>
    db
      .prepare(
        `INSERT INTO ai_calls (id, purpose, subject_id, model, status, input_tokens, output_tokens, estimated_usd, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        call.purpose,
        call.subject_id ?? null,
        model,
        status,
        inTok,
        outTok,
        Math.round(((inTok / 1e6) * p.input + (outTok / 1e6) * p.output) * 1e6) / 1e6,
        error,
        nowIso(),
      )
      .run();

  let res: Response;
  try {
    res = await fetcher(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.BANKR_LLM_KEY}`,
        "content-type": "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.user },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    const error = `couldn't reach llm.bankr.bot (${err instanceof Error ? err.name : "error"})`;
    await record("failed", 0, 0, error);
    throw new Error(error);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    const error = `llm.bankr.bot answered ${res.status}${detail ? `: ${detail}` : ""}`;
    await record("failed", 0, 0, error);
    throw new Error(error);
  }
  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
  } | null;
  const content = body?.choices?.[0]?.message?.content;
  const text =
    typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : "";
  const inTok =
    body?.usage?.prompt_tokens ?? body?.usage?.input_tokens ?? Math.ceil((call.system.length + call.user.length) / 3);
  const outTok = body?.usage?.completion_tokens ?? body?.usage?.output_tokens ?? Math.ceil(text.length / 3);
  await record(text ? "ok" : "failed", inTok, outTok, text ? null : "empty answer");
  if (!text) throw new Error("empty answer from the AI");
  return text;
}

async function homepage(fetcher: typeof fetch, url: string) {
  const res = await fetcher(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`homepage answered ${res.status}`);
  return (await res.text()).slice(0, 300_000);
}

/** The AI's read of a new company candidate, stored on it for Dan to see before approving. */
export async function aiCheckCandidate(
  db: D1Database,
  env: AiEnv,
  candidateId: string,
  fetcher: typeof fetch = fetch,
): Promise<CandidateAnswer> {
  const c = await db
    .prepare("SELECT id, domain, found_title FROM company_candidates WHERE id = ?")
    .bind(candidateId)
    .first<{ id: string; domain: string; found_title: string }>();
  if (!c) throw new Error("candidate not found");
  const { results: cats } = await db.prepare("SELECT slug FROM categories ORDER BY slug").all<{ slug: string }>();
  const text = pageText(await homepage(fetcher, `https://${c.domain}/`));
  const prompt = candidatePrompt({
    domain: c.domain,
    found_title: c.found_title,
    text,
    categories: cats.map((x) => x.slug),
  });
  const answer = candidateAnswer.parse(
    jsonFrom(await askAi(db, env, { purpose: "candidate", subject_id: c.id, ...prompt, max_tokens: 400 }, fetcher)),
  );
  const known = new Set(cats.map((x) => x.slug));
  answer.sectors = answer.sectors.filter((s) => known.has(s));
  await db
    .prepare("UPDATE company_candidates SET ai_json = ?, ai_checked_at = ? WHERE id = ?")
    .bind(JSON.stringify(answer), nowIso(), c.id)
    .run();
  return answer;
}

/** Check a few new candidates that haven't been checked yet (quietly does nothing when AI is off). */
export async function aiCheckNewCandidates(
  db: D1Database,
  env: AiEnv,
  opts: { fetcher?: typeof fetch; limit?: number } = {},
) {
  const { results } = await db
    .prepare(
      "SELECT id FROM company_candidates WHERE status = 'new' AND ai_checked_at IS NULL ORDER BY created_at LIMIT ?",
    )
    .bind(opts.limit ?? 5)
    .all<{ id: string }>();
  let checked = 0;
  const errors: string[] = [];
  for (const r of results) {
    try {
      await aiCheckCandidate(db, env, r.id, opts.fetcher);
      checked += 1;
    } catch (err) {
      if (err instanceof AiOffError) return { checked, errors: [err.message] };
      errors.push(err instanceof Error ? err.message : "failed");
      // Mark it so a broken site isn't retried every hour.
      await db.prepare("UPDATE company_candidates SET ai_checked_at = ? WHERE id = ?").bind(nowIso(), r.id).run();
    }
  }
  return { checked, errors };
}

/** People who work at the company, from a page's text; only names that appear on the page are kept. */
export async function aiPeople(
  db: D1Database,
  env: AiEnv,
  company: { id: string; name: string; domain: string },
  html: string,
  fetcher: typeof fetch = fetch,
) {
  const text = pageText(html, 8000);
  const prompt = peoplePrompt({ company: company.name, domain: company.domain, text });
  const answer = peopleAnswer.parse(
    jsonFrom(
      await askAi(db, env, { purpose: "contacts", subject_id: company.id, ...prompt, max_tokens: 500 }, fetcher),
    ),
  );
  return onPage(answer.people, text);
}
