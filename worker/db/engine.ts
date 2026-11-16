/**
 * The engine: the cron trigger fires every 10 minutes (free plan), and each run does ONE small task,
 * taking turns, so every run stays well inside the free plan's per-run limits. Every run is recorded
 * in job_runs (what ran, what it did, errors); a run that stays "running" was cut short by Cloudflare.
 *
 * If a task has nothing to do, the run moves on to the next one (at most 3 per run).
 */

import type { Env } from "../env.ts";
import { purgeOldAccessRequests } from "./access.ts";
import { aiCheckNewCandidates } from "./ai.ts";
import { runDueSources } from "./collector.ts";
import { discover, readCandidateSites } from "./discovery.ts";
import { enrichMissing } from "./enrich.ts";
import { fetchMissingLogos } from "./logos.ts";
import { findMissingContacts } from "./people.ts";
import { newId, nowIso } from "./util.ts";

export interface TaskResult {
  /** Did anything: true; had nothing to do: false. */
  worked: boolean;
  summary: string;
  details?: unknown;
}

type Task = {
  key: string;
  label: string;
  run: (db: D1Database, env: Env, fetcher?: typeof fetch) => Promise<TaskResult>;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function teams(only: "hn" | "github" | "inbox", label: string): Task {
  return {
    key: `find_${only}`,
    label: `Find new teams: ${label}`,
    run: async (db, env, fetcher) => {
      const r = await discover(db, { env, fetcher, only, readSites: 0 });
      const s = r.sources[0];
      if (!s) return { worked: false, summary: "Already looked today" };
      if (s.error) throw new Error(s.error);
      return { worked: true, summary: `Looked at ${s.found}, added ${plural(s.added, "new team")}`, details: s };
    },
  };
}

export const TASKS: Task[] = [
  teams("hn", "Hacker News"),
  {
    key: "read_sites",
    label: "Read new teams' websites",
    run: async (db, _env, fetcher) => {
      const n = await readCandidateSites(db, { fetcher, limit: 2 });
      return { worked: n > 0, summary: n ? `Read ${plural(n, "website")}` : "Nothing waiting" };
    },
  },
  {
    key: "signals",
    label: "Collect signals from sources",
    run: async (db, env, fetcher) => {
      const out = await runDueSources(db, { env, fetcher, limit: 1 });
      const o = out[0];
      if (!o) return { worked: false, summary: "No source due" };
      if (o.status === "failed") throw new Error(o.error ?? "source failed");
      return { worked: true, summary: `Checked 1 source, ${plural(o.items_new, "new item")} in the Inbox`, details: o };
    },
  },
  {
    key: "ai_check",
    label: "AI check of new teams",
    run: async (db, env, fetcher) => {
      if (!env.BANKR_LLM_KEY) return { worked: false, summary: "AI helpers off" };
      const r = await aiCheckNewCandidates(db, env, { fetcher, limit: 2 });
      if (r.errors.length && !r.checked) throw new Error(r.errors[0]);
      return { worked: r.checked > 0, summary: r.checked ? `Checked ${plural(r.checked, "team")}` : "Nothing waiting" };
    },
  },
  teams("github", "GitHub"),
  {
    key: "links",
    label: "Fill links from websites",
    run: async (db, _env, fetcher) => {
      const r = await enrichMissing(db, { fetcher, limit: 2 });
      const added = r.reduce((n, x) => n + x.added.length, 0);
      return {
        worked: r.length > 0,
        summary: r.length ? `Read ${plural(r.length, "website")}, added ${plural(added, "link")}` : "All up to date",
      };
    },
  },
  {
    key: "contacts",
    label: "Find contacts",
    run: async (db, env, fetcher) => {
      const r = await findMissingContacts(db, { fetcher, limit: 1, env });
      const added = r.reduce((n, x) => n + x.added, 0);
      return {
        worked: r.length > 0,
        summary: r.length ? `Read 1 company, ${plural(added, "contact")} to review` : "All up to date",
      };
    },
  },
  {
    key: "logos",
    label: "Find logos",
    run: async (db, _env, fetcher) => {
      const r = await fetchMissingLogos(db, { fetcher, limit: 2 });
      const found = r.filter((x) => x.status === "found").length;
      return {
        worked: r.length > 0,
        summary: r.length ? `Checked ${plural(r.length, "company", "companies")}, ${found} found` : "All up to date",
      };
    },
  },
  teams("inbox", "your Inbox"),
  {
    key: "housekeeping",
    label: "Housekeeping",
    run: async (db) => {
      const n = await purgeOldAccessRequests(db);
      return { worked: n > 0, summary: n ? `Deleted ${plural(n, "old access request")}` : "Nothing to tidy" };
    },
  },
];

const NEXT_KEY = "engine_next";

/** One engine run: the next task in turn (moving on when a task has nothing to do, at most 3). */
export async function runTick(db: D1Database, env: Env, opts: { fetcher?: typeof fetch; now?: Date } = {}) {
  const row = await db
    .prepare("SELECT value FROM discovery_state WHERE key = ?")
    .bind(NEXT_KEY)
    .first<{ value: string }>();
  let i = Number(row?.value ?? 0) % TASKS.length;
  const done: { task: string; status: string; summary: string }[] = [];
  for (let tries = 0; tries < 3; tries++) {
    const task = TASKS[i] as Task;
    i = (i + 1) % TASKS.length;
    const id = newId();
    await db
      .prepare("INSERT INTO job_runs (id, task, started_at, status) VALUES (?, ?, ?, 'running')")
      .bind(id, task.key, nowIso(opts.now ?? new Date()))
      .run();
    let status: "ok" | "idle" | "failed" = "ok";
    let summary = "";
    let details: unknown = {};
    let error: string | null = null;
    try {
      const r = await task.run(db, env, opts.fetcher);
      status = r.worked ? "ok" : "idle";
      summary = r.summary;
      details = r.details ?? {};
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message.slice(0, 300) : "failed";
      summary = "Failed";
    }
    await db
      .prepare("UPDATE job_runs SET finished_at = ?, status = ?, summary = ?, details_json = ?, error = ? WHERE id = ?")
      .bind(nowIso(), status, summary, JSON.stringify(details), error, id)
      .run();
    done.push({ task: task.key, status, summary });
    if (status !== "idle") break;
  }
  await db
    .prepare(
      `INSERT INTO discovery_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(NEXT_KEY, String(i), nowIso())
    .run();
  return done;
}

/** For the Engine status page: today's totals, what's waiting for Dan, and the last runs. */
export async function engineStatus(db: D1Database, now = new Date()) {
  const today = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const staleBefore = new Date(now.getTime() - 15 * 60_000).toISOString();
  const one = async (sql: string, ...args: unknown[]) =>
    (
      (await db
        .prepare(sql)
        .bind(...args)
        .first<{ n: number }>()) ?? { n: 0 }
    ).n;
  const [
    teamsToday,
    inboxToday,
    contactsToday,
    logosToday,
    waitingTeams,
    waitingContacts,
    waitingInbox,
    waitingReview,
    lastRun,
  ] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM company_candidates WHERE created_at >= ?", today),
    one("SELECT COUNT(*) AS n FROM collected_items WHERE found_at >= ?", today),
    one("SELECT COUNT(*) AS n FROM company_contacts WHERE created_at >= ? AND created_by != ?", today, "admin"),
    one("SELECT COUNT(*) AS n FROM company_logos WHERE checked_at >= ? AND status = 'found'", today),
    one("SELECT COUNT(*) AS n FROM company_candidates WHERE status = 'new'"),
    one(
      "SELECT COUNT(*) AS n FROM company_contacts k JOIN companies c ON c.id = k.company_id WHERE k.status = 'needs_review' AND c.status = 'verified'",
    ),
    one("SELECT COUNT(*) AS n FROM collected_items WHERE status = 'new'"),
    one(
      "SELECT (SELECT COUNT(*) FROM companies WHERE status = 'needs_review') + (SELECT COUNT(*) FROM signal_events WHERE status = 'needs_review') AS n",
    ),
    db.prepare("SELECT MAX(started_at) AS at FROM job_runs").first<{ at: string | null }>(),
  ]);
  const { results } = await db
    .prepare(
      "SELECT id, task, started_at, finished_at, status, summary, error FROM job_runs ORDER BY started_at DESC LIMIT 60",
    )
    .all<{
      id: string;
      task: string;
      started_at: string;
      finished_at: string | null;
      status: string;
      summary: string | null;
      error: string | null;
    }>();
  const label = new Map(TASKS.map((t) => [t.key, t.label]));
  return {
    last_run_at: lastRun?.at ?? null,
    today: { teams: teamsToday, inbox_items: inboxToday, contacts: contactsToday, logos: logosToday },
    waiting: { teams: waitingTeams, contacts: waitingContacts, inbox: waitingInbox, review: waitingReview },
    runs: results.map((r) => ({
      ...r,
      label: label.get(r.task) ?? r.task,
      // Still "running" after 15 minutes: Cloudflare cut it short.
      status: r.status === "running" && r.started_at < staleBefore ? "cut_short" : r.status,
    })),
  };
}
