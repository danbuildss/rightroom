/** One summary for the back office's Overview page: what needs Dan, and whether the collector is healthy. */
import type { Env } from "../env.ts";
import { GROK_DEFAULT_CAP_USD, grokSpendThisMonth } from "./collector.ts";

/** Counts include sample records, matching the review queue. */
type StatusCounts = { needs_review: number; verified: number; rejected: number };

async function byStatus(db: D1Database, table: "companies" | "signal_events"): Promise<StatusCounts> {
  const { results } = await db
    .prepare(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`)
    .all<{ status: keyof StatusCounts; n: number }>();
  const counts: StatusCounts = { needs_review: 0, verified: 0, rejected: 0 };
  for (const r of results) counts[r.status] = r.n;
  return counts;
}

const count = async (db: D1Database, sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;

export function grokSpend(env: Env, spent: number) {
  const cap = Number(env.GROK_MONTHLY_CAP_USD ?? GROK_DEFAULT_CAP_USD);
  return {
    provider: "xai" as const,
    month: new Date().toISOString().slice(0, 7),
    estimated_usd: Math.round(spent * 100) / 100,
    cap_usd: Number.isFinite(cap) ? cap : GROK_DEFAULT_CAP_USD,
    key_configured: Boolean(env.XAI_API_KEY),
  };
}

export async function adminOverview(db: D1Database, env: Env) {
  const [companies, signals, publicCompanies, inboxNew, accessNew, founders, sources, lastRun, spent] =
    await Promise.all([
      byStatus(db, "companies"),
      byStatus(db, "signal_events"),
      count(db, "SELECT COUNT(*) AS n FROM companies WHERE status = 'verified' AND is_sample = 0"),
      count(db, "SELECT COUNT(*) AS n FROM collected_items WHERE status = 'new'"),
      count(db, "SELECT COUNT(*) AS n FROM access_requests WHERE status = 'new'"),
      count(db, "SELECT COUNT(*) AS n FROM founders"),
      db
        .prepare(
          `SELECT COUNT(*) AS total, COALESCE(SUM(enabled), 0) AS enabled,
           COALESCE(SUM(CASE WHEN enabled = 1 AND consecutive_failures > 0 THEN 1 ELSE 0 END), 0) AS failing
         FROM watched_sources`,
        )
        .first<{ total: number; enabled: number; failing: number }>(),
      db
        .prepare("SELECT started_at, status FROM ingestion_runs ORDER BY started_at DESC LIMIT 1")
        .first<{ started_at: string; status: string }>(),
      grokSpendThisMonth(db),
    ]);
  const total = sources?.total ?? 0;
  const enabled = sources?.enabled ?? 0;
  return {
    companies,
    signals,
    /** Verified, non-sample companies: what public Discover can show. */
    public_companies: publicCompanies,
    /** Everything in the review queue (sample records included, as the queue shows them). */
    waiting: companies.needs_review + signals.needs_review,
    inbox_new: inboxNew,
    access_requests_new: accessNew,
    founders,
    sources: { total, enabled, paused: total - enabled, failing: sources?.failing ?? 0 },
    last_run: lastRun ?? null,
    spend: grokSpend(env, spent),
  };
}
