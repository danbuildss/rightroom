/**
 * The Grok test (a 3 USD budget): company X research, a few focused topic searches, Dan's
 * Useful / Not useful ratings, and a report on what it cost per useful result.
 *
 * Every search starts from a button in the back office (the hourly schedule skips Grok unless
 * GROK_AUTO is "on"), each shows its cost estimate first, and none starts if it could pass the cap.
 * Grok never verifies anything: posts land in the inbox, and an X handle is only a suggestion
 * until Dan accepts it.
 */
import { DEFAULT_GROK_PRICES, estimateSearchCost, type GrokConfig, grokConfigSchema } from "../../shared/grok.ts";
import {
  type CollectorEnv,
  createWatchedSource,
  GROK_DEFAULT_CAP_USD,
  GROK_DEFAULT_MODEL,
  grokPrices,
  grokSpendThisMonth,
  runSource,
} from "./collector.ts";
import { addAlias } from "./companies.ts";
import { suggestContact } from "./people.ts";
import { ConflictError, NotFoundError, newId, nowIso } from "./util.ts";

const TERMS =
  "Official xAI API (x_search tool), pay-per-use within Dan's test budget. Store post links and short excerpts only.";

/** The focused test searches: one per sector Rightroom covers, last 7 days, at most 8 posts each. */
export const TEST_SEARCHES: { name: string; url: string; hint: string; config: GrokConfig }[] = [
  {
    name: "Grok test: AI agents and dev tools looking for partners",
    url: "https://x.com/search?q=rightroom-test-ai-devtools",
    hint: "partner_program_launched",
    config: {
      query:
        "AI agent, LLM infrastructure or developer-tool companies announcing a partner, integrations or ecosystem program, or asking for integration partners",
      lookback_days: 7,
      max_posts: 8,
    },
  },
  {
    name: "Grok test: Payments and stablecoin integrations",
    url: "https://x.com/search?q=rightroom-test-payments",
    hint: "integration_announced",
    config: {
      query:
        "payments, stablecoin or on-ramp companies announcing new integrations, partner programs or APIs for developers",
      lookback_days: 7,
      max_posts: 8,
    },
  },
  {
    name: "Grok test: Base and onchain apps launches",
    url: "https://x.com/search?q=rightroom-test-base",
    hint: "ecosystem_expansion",
    config: {
      query:
        "companies or protocols announcing they are live on Base, launching an ecosystem or grants program, or opening integrations for onchain apps",
      lookback_days: 7,
      max_posts: 8,
    },
  },
];

const COMPANY_CONFIG = (name: string, domain: string): GrokConfig => ({
  query:
    "Find its official X account and its own posts about partnerships, integrations, partner programs, APIs or SDKs, ecosystem programs or partnerships roles",
  lookback_days: 30,
  max_posts: 8,
  company: { name, domain },
});

function budget(env: CollectorEnv, spent: number) {
  const cap = Number(env.GROK_MONTHLY_CAP_USD) > 0 ? Number(env.GROK_MONTHLY_CAP_USD) : GROK_DEFAULT_CAP_USD;
  return {
    cap,
    spent: Math.round(spent * 10_000) / 10_000,
    left: Math.max(0, Math.round((cap - spent) * 10_000) / 10_000),
  };
}

/** Everything the Grok page needs: key, budget, the test searches and each one's estimate and results. */
export async function grokStatus(db: D1Database, env: CollectorEnv) {
  const prices = grokPrices(env);
  const money = budget(env, await grokSpendThisMonth(db));
  const { results } = await db
    .prepare(
      `SELECT w.id, w.name, w.config_json, w.company_domain, w.last_success_at, w.last_error, w.state_json,
         (SELECT COUNT(*) FROM collected_items i WHERE i.watched_source_id = w.id) AS items,
         (SELECT COUNT(*) FROM collected_items i WHERE i.watched_source_id = w.id AND i.useful = 1) AS useful,
         (SELECT COUNT(*) FROM collected_items i WHERE i.watched_source_id = w.id AND i.useful = 0) AS not_useful,
         (SELECT COUNT(*) FROM collected_items i WHERE i.watched_source_id = w.id AND i.status = 'promoted') AS promoted,
         (SELECT COUNT(*) FROM spend_ledger l WHERE l.watched_source_id = w.id) AS runs,
         (SELECT COALESCE(SUM(estimated_usd), 0) FROM spend_ledger l WHERE l.watched_source_id = w.id) AS cost
       FROM watched_sources w WHERE w.adapter = 'grok_x_search' ORDER BY w.created_at DESC`,
    )
    .all<{
      id: string;
      name: string;
      config_json: string;
      company_domain: string | null;
      last_success_at: string | null;
      last_error: string | null;
      state_json: string;
      items: number;
      useful: number;
      not_useful: number;
      promoted: number;
      runs: number;
      cost: number;
    }>();
  const searches = results.map((r) => {
    const config = grokConfigSchema.safeParse(JSON.parse(r.config_json));
    const state = JSON.parse(r.state_json || "{}") as { last_cost_usd?: number; last_posts_read?: number };
    return {
      id: r.id,
      name: r.name,
      kind: config.success && config.data.company ? ("company" as const) : ("topic" as const),
      query: config.success ? config.data.query : "",
      lookback_days: config.success ? config.data.lookback_days : null,
      max_posts: config.success ? config.data.max_posts : null,
      estimate_usd: config.success ? estimateSearchCost(config.data, prices) : null,
      last_run_at: r.last_success_at,
      last_error: r.last_error,
      last_cost_usd: state.last_cost_usd ?? null,
      last_posts_read: state.last_posts_read ?? null,
      runs: r.runs,
      cost_usd: Math.round(r.cost * 10_000) / 10_000,
      items: r.items,
      useful: r.useful,
      not_useful: r.not_useful,
      promoted: r.promoted,
    };
  });
  const totals = searches.reduce(
    (t, s) => ({
      runs: t.runs + s.runs,
      cost_usd: t.cost_usd + s.cost_usd,
      items: t.items + s.items,
      useful: t.useful + s.useful,
      not_useful: t.not_useful + s.not_useful,
      promoted: t.promoted + s.promoted,
    }),
    { runs: 0, cost_usd: 0, items: 0, useful: 0, not_useful: 0, promoted: 0 },
  );
  return {
    key_set: Boolean(env.XAI_API_KEY),
    auto: env.GROK_AUTO === "on",
    model: env.GROK_MODEL || GROK_DEFAULT_MODEL,
    prices: { ...DEFAULT_GROK_PRICES, ...prices },
    budget: money,
    company_estimate_usd: estimateSearchCost({ max_posts: 8 }, prices),
    searches,
    totals: {
      ...totals,
      cost_usd: Math.round(totals.cost_usd * 10_000) / 10_000,
      cost_per_useful_usd: totals.useful ? Math.round((totals.cost_usd / totals.useful) * 1000) / 1000 : null,
      cost_per_signal_usd: totals.promoted ? Math.round((totals.cost_usd / totals.promoted) * 1000) / 1000 : null,
    },
  };
}

/** Add the three focused test searches (once). They never run on the schedule unless GROK_AUTO is on. */
export async function setupTestSearches(db: D1Database, editor: string) {
  let added = 0;
  for (const t of TEST_SEARCHES) {
    const exists = await db.prepare("SELECT 1 FROM watched_sources WHERE url = ?").bind(t.url).first();
    if (exists) continue;
    await createWatchedSource(
      db,
      {
        name: t.name,
        adapter: "grok_x_search",
        url: t.url,
        config: t.config,
        terms_note: TERMS,
        signal_type_hint: t.hint,
        interval_hours: 720,
        enabled: true,
      } as Parameters<typeof createWatchedSource>[1],
      editor,
    );
    added += 1;
  }
  return added;
}

/** Research one verified company on X: its official account (a suggestion) and its recent partnership posts. */
export async function researchCompany(
  db: D1Database,
  companyId: string,
  env: CollectorEnv,
  editor: string,
  fetcher?: typeof fetch,
) {
  const co = await db
    .prepare("SELECT id, name, primary_domain AS domain, status FROM companies WHERE id = ?")
    .bind(companyId)
    .first<{ id: string; name: string; domain: string; status: string }>();
  if (!co) throw new NotFoundError("company not found");
  if (co.status !== "verified") throw new ConflictError("research verified companies only");
  const url = `https://x.com/search?q=${encodeURIComponent(co.domain)}&rightroom=company`;
  let source = await db.prepare("SELECT id FROM watched_sources WHERE url = ?").bind(url).first<{ id: string }>();
  if (!source) {
    source = await createWatchedSource(
      db,
      {
        name: `Grok research: ${co.name}`,
        adapter: "grok_x_search",
        url,
        config: COMPANY_CONFIG(co.name, co.domain),
        terms_note: TERMS,
        company_domain: co.domain,
        interval_hours: 720,
        enabled: true,
      } as Parameters<typeof createWatchedSource>[1],
      editor,
    );
  }
  const outcome = await runSource(db, source.id, { env, fetcher });
  const row = await db
    .prepare("SELECT state_json FROM watched_sources WHERE id = ?")
    .bind(source.id)
    .first<{ state_json: string }>();
  const state = JSON.parse(row?.state_json || "{}") as {
    handle?: { handle: string; evidence_url: string } | null;
    people?: { name: string | null; handle: string; role: string; evidence_url: string }[];
    last_cost_usd?: number;
  };
  let people_added = 0;
  if (outcome.status === "ok") {
    for (const p of state.people ?? []) {
      const name = p.name ? `${p.name} (@${p.handle})` : `@${p.handle}`;
      if (
        await suggestContact(
          db,
          co.id,
          { kind: "person", name, role: p.role, source_url: p.evidence_url, confidence: "medium" },
          "grok",
        )
      )
        people_added += 1;
    }
  }
  let handle: { handle: string; evidence_url: string; already_set: boolean } | null = null;
  if (outcome.status === "ok" && state.handle) {
    const existing = await db
      .prepare("SELECT value FROM company_aliases WHERE company_id = ? AND kind = 'x_handle'")
      .bind(co.id)
      .first<{ value: string }>();
    handle = { ...state.handle, already_set: existing?.value === state.handle.handle };
    if (!handle.already_set) {
      await db
        .prepare(
          `INSERT INTO x_handle_suggestions (id, company_id, handle, evidence_url, watched_source_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (company_id, handle) DO NOTHING`,
        )
        .bind(newId(), co.id, state.handle.handle, state.handle.evidence_url, source.id, nowIso())
        .run();
    }
  }
  return {
    outcome,
    source_id: source.id,
    cost_usd: outcome.status === "ok" ? (state.last_cost_usd ?? null) : null,
    handle,
    people_added,
  };
}

export async function rateItem(db: D1Database, id: string, useful: boolean | null) {
  const r = await db
    .prepare("UPDATE collected_items SET useful = ?, rated_at = ? WHERE id = ?")
    .bind(useful === null ? null : useful ? 1 : 0, useful === null ? null : nowIso(), id)
    .run();
  if (!r.meta.changes) throw new NotFoundError("inbox item not found");
}

export async function listHandleSuggestions(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.handle, s.evidence_url, s.created_at, c.id AS company_id, c.name, c.primary_domain AS domain,
         (SELECT value FROM company_aliases a WHERE a.company_id = c.id AND a.kind = 'x_handle') AS current
       FROM x_handle_suggestions s JOIN companies c ON c.id = s.company_id
       WHERE s.status = 'new' ORDER BY s.created_at DESC`,
    )
    .all();
  return results;
}

/** Accept: the handle becomes the company's X link (replacing any old one). Dismiss: nothing changes. */
export async function decideHandle(db: D1Database, id: string, accept: boolean, editor: string) {
  const s = await db
    .prepare("SELECT company_id, handle FROM x_handle_suggestions WHERE id = ? AND status = 'new'")
    .bind(id)
    .first<{ company_id: string; handle: string }>();
  if (!s) throw new NotFoundError("suggestion not found");
  if (accept) {
    await db.prepare("DELETE FROM company_aliases WHERE company_id = ? AND kind = 'x_handle'").bind(s.company_id).run();
    await addAlias(db, s.company_id, "x_handle", s.handle);
  }
  await db
    .prepare("UPDATE x_handle_suggestions SET status = ?, reviewed_by = ? WHERE id = ?")
    .bind(accept ? "accepted" : "dismissed", editor, id)
    .run();
}

/** The last runs of one Grok search (or all), newest first, for "Show details". */
export async function listGrokRuns(db: D1Database, sourceId?: string, limit = 10) {
  const { results } = await db
    .prepare(
      `SELECT id, watched_source_id, ran_at, status, model, query, from_date, max_posts, posts_read, listed, kept,
         dropped_json, kept_json, answer_excerpt, error, cost_usd FROM grok_runs
       ${sourceId ? "WHERE watched_source_id = ?" : ""} ORDER BY ran_at DESC LIMIT ?`,
    )
    .bind(...(sourceId ? [sourceId, limit] : [limit]))
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    ...r,
    dropped: JSON.parse(String(r.dropped_json ?? "[]")),
    kept_posts: JSON.parse(String(r.kept_json ?? "[]")),
  }));
}

/** Everything Grok found, newest first, in one list: the post, which search found it, and its state. */
export async function listGrokResults(db: D1Database, limit = 40) {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.title, i.url, i.excerpt, i.published_at, i.found_at, i.status, i.useful, i.suggested_domain,
         w.name AS search FROM collected_items i JOIN watched_sources w ON w.id = i.watched_source_id
       WHERE w.adapter = 'grok_x_search' ORDER BY i.found_at DESC LIMIT ?`,
    )
    .bind(limit)
    .all();
  return results;
}
