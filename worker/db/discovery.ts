/**
 * Finding early-stage teams every day (data engine, part B), and turning approved ones into companies.
 *
 * Sources (free, public APIs):
 *  - Hacker News "Show HN" posts (hn.algolia.com search API), last 7 days, about relevant products;
 *  - new GitHub repositories (last 30 days) on our topics that list their own homepage;
 *  - website links already found by the collector and Grok (the Inbox).
 * Each candidate's own homepage is read for its name, description and links. Nothing becomes a
 * company until Dan approves it; approving verifies the company against its own website, adds an
 * "Early stage" profile, and fills in its links and logo.
 */

import {
  type FoundTeam,
  parseGithubSearch,
  parseHnShow,
  productDomain,
  readSiteMeta,
  suggestProfile,
} from "../../shared/discovery.ts";
import { readHomepage } from "../../shared/enrich.ts";
import { companyInputSchema } from "../../shared/registry.ts";
import type { AiEnv } from "./ai.ts";
import { type CollectorEnv, USER_AGENT } from "./collector.ts";
import { confirmProfiles, createCompany, DuplicateCompanyError } from "./companies.ts";
import { enrichCompany } from "./enrich.ts";
import { fetchLogo } from "./logos.ts";
import { findContacts } from "./people.ts";
import { reviewCompany } from "./signals.ts";
import { ConflictError, newId, nowIso } from "./util.ts";

const DAY = 86_400_000;
const MAX_NEW_PER_RUN = 15;
const GITHUB_TOPICS = ["mcp-server", "ai-agents", "x402", "stablecoin", "llm-tools"];

async function getJson(fetcher: typeof fetch, url: string, headers: Record<string, string> = {}) {
  const res = await fetcher(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json", ...headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

async function lastRun(db: D1Database, key: string) {
  const r = await db.prepare("SELECT value FROM discovery_state WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
async function setRun(db: D1Database, key: string, at: string) {
  await db
    .prepare(
      "INSERT INTO discovery_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, at, at)
    .run();
}

async function fromHn(fetcher: typeof fetch, now: Date) {
  const since = Math.floor((now.getTime() - 7 * DAY) / 1000);
  return parseHnShow(
    await getJson(
      fetcher,
      `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=created_at_i>${since}&hitsPerPage=100`,
    ),
  );
}

async function fromGithub(fetcher: typeof fetch, env: CollectorEnv, now: Date) {
  const since = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const out: FoundTeam[] = [];
  for (const topic of GITHUB_TOPICS) {
    const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>10`);
    out.push(
      ...parseGithubSearch(
        await getJson(
          fetcher,
          `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`,
          headers,
        ),
      ),
    );
  }
  return out;
}

async function fromInbox(db: D1Database): Promise<FoundTeam[]> {
  const { results } = await db
    .prepare(
      `SELECT i.suggested_domain AS domain, i.url, i.title, i.published_at, i.excerpt FROM collected_items i
       WHERE i.suggested_domain IS NOT NULL ORDER BY i.found_at DESC LIMIT 200`,
    )
    .all<{ domain: string; url: string; title: string; published_at: string | null; excerpt: string | null }>();
  return results
    .map((r) => ({ ...r, domain: productDomain(`https://${r.domain}`) }))
    .filter((r): r is typeof r & { domain: string } => Boolean(r.domain))
    .map((r) => ({
      domain: r.domain,
      name: null,
      found_via: "inbox" as const,
      found_url: r.url,
      found_title: r.title.slice(0, 300),
      found_at: r.published_at,
      hint: r.excerpt ?? r.title,
    }));
}

/** Store new candidates: skip domains that are already a company or were proposed before. */
async function store(db: D1Database, teams: FoundTeam[], at: string, limit: number) {
  let added = 0;
  for (const t of teams) {
    if (added >= limit) break;
    const known = await db
      .prepare(
        `SELECT 1 FROM company_aliases WHERE kind = 'domain' AND value = ?
         UNION SELECT 1 FROM company_candidates WHERE domain = ?`,
      )
      .bind(t.domain, t.domain)
      .first();
    if (known) continue;
    const s = suggestProfile(`${t.found_title} ${t.hint ?? ""}`);
    const r = await db
      .prepare(
        `INSERT INTO company_candidates (id, domain, name, found_via, found_url, found_title, found_at, hint,
           suggested_categories_json, suggested_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (domain) DO NOTHING`,
      )
      .bind(
        newId(),
        t.domain,
        t.name,
        t.found_via,
        t.found_url,
        t.found_title,
        t.found_at,
        t.hint,
        JSON.stringify(s.categories),
        s.type,
        at,
      )
      .run();
    added += r.meta.changes ?? 0;
  }
  return added;
}

/**
 * Run the discovery sources that are due (each about once a day, or all when forced),
 * then read a few new candidates' websites.
 */
export async function discover(
  db: D1Database,
  opts: {
    env?: CollectorEnv;
    fetcher?: typeof fetch;
    now?: Date;
    force?: boolean;
    /** Only this source (the engine runs one per turn). */
    only?: "hn" | "github" | "inbox";
    /** How many new candidates' websites to read afterwards (default 5; 0 to skip). */
    readSites?: number;
  } = {},
) {
  const now = opts.now ?? new Date();
  const fetcher = opts.fetcher ?? fetch;
  const at = nowIso(now);
  const report: { source: string; found: number; added: number; error?: string }[] = [];
  const sources: [string, () => Promise<FoundTeam[]>][] = [
    ["hn", () => fromHn(fetcher, now)],
    ["github", () => fromGithub(fetcher, opts.env ?? {}, now)],
    ["inbox", () => fromInbox(db)],
  ];
  let budget = MAX_NEW_PER_RUN;
  for (const [key, run] of sources) {
    if (opts.only && key !== opts.only) continue;
    const last = await lastRun(db, key);
    if (!opts.force && last && now.getTime() - Date.parse(last) < 20 * 3_600_000) continue;
    try {
      const teams = await run();
      const added = await store(db, teams, at, budget);
      budget -= added;
      report.push({ source: key, found: teams.length, added });
    } catch (err) {
      report.push({ source: key, found: 0, added: 0, error: err instanceof Error ? err.message : "failed" });
    }
    await setRun(db, key, at);
  }
  const read = opts.readSites === 0 ? 0 : await readCandidateSites(db, { fetcher, limit: opts.readSites ?? 5 });
  return { sources: report, sites_read: read };
}

/** Read new candidates' own homepages: name, description and links. */
export async function readCandidateSites(db: D1Database, opts: { fetcher?: typeof fetch; limit?: number } = {}) {
  const fetcher = opts.fetcher ?? fetch;
  const { results } = await db
    .prepare(
      "SELECT id, domain, found_title, hint FROM company_candidates WHERE status = 'new' AND site_checked_at IS NULL ORDER BY created_at LIMIT ?",
    )
    .bind(opts.limit ?? 5)
    .all<{ id: string; domain: string; found_title: string; hint: string | null }>();
  for (const c of results) {
    let meta: ReturnType<typeof readSiteMeta> = { name: null, description: null };
    let links = {};
    let note: string | null = null;
    try {
      const res = await fetcher(`https://${c.domain}/`, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) note = `Homepage answered ${res.status}.`;
      else {
        const html = (await res.text()).slice(0, 300_000);
        meta = readSiteMeta(html);
        links = Object.fromEntries(
          Object.entries(readHomepage(html, res.url || `https://${c.domain}/`, c.domain)).filter(([, v]) => v),
        );
      }
    } catch {
      note = "Couldn't reach the homepage.";
    }
    const s = suggestProfile(`${c.found_title} ${c.hint ?? ""} ${meta.description ?? ""}`);
    await db
      .prepare(
        `UPDATE company_candidates SET site_name = ?, site_description = ?, site_links_json = ?, site_checked_at = ?,
           site_note = ?, suggested_categories_json = ?, suggested_type = ? WHERE id = ?`,
      )
      .bind(
        meta.name,
        meta.description,
        JSON.stringify(links),
        nowIso(),
        note,
        JSON.stringify(s.categories),
        s.type,
        c.id,
      )
      .run();
  }
  return results.length;
}

export async function listCandidates(db: D1Database, status: "new" | "approved" | "rejected" = "new") {
  const { results } = await db
    .prepare(
      `SELECT id, domain, name, found_via, found_url, found_title, found_at, site_name, site_description,
         site_links_json, site_checked_at, site_note, suggested_categories_json, suggested_type, status, company_id,
         ai_json, ai_checked_at
       FROM company_candidates WHERE status = ? ORDER BY site_checked_at IS NULL, created_at DESC LIMIT 200`,
    )
    .bind(status)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    ...r,
    site_links: JSON.parse(String(r.site_links_json ?? "{}")),
    suggested_categories: JSON.parse(String(r.suggested_categories_json ?? "[]")),
    ai: r.ai_json ? JSON.parse(String(r.ai_json)) : null,
  }));
}

/**
 * Approve candidates: each becomes a company verified against its own homepage, with an
 * "Early stage" profile (Dan's approval confirms it). Links and logo are filled in straight after.
 */
export async function approveCandidates(
  db: D1Database,
  ids: string[],
  editor: string,
  opts: { fetcher?: typeof fetch; names?: Record<string, string>; env?: AiEnv } = {},
) {
  const results: { id: string; ok: boolean; company_id?: string; error?: string }[] = [];
  for (const id of ids) {
    const c = await db
      .prepare("SELECT * FROM company_candidates WHERE id = ? AND status = 'new'")
      .bind(id)
      .first<Record<string, string | null>>();
    if (!c) {
      results.push({ id, ok: false, error: "not a new candidate" });
      continue;
    }
    // The AI's read (if any) fills in name, description, type, sectors, stage and audience; Dan's edits win.
    const ai = c.ai_json
      ? (JSON.parse(c.ai_json) as {
          name?: string | null;
          one_liner?: string | null;
          org_type?: string | null;
          sectors?: string[];
          stage?: string;
          audiences?: string[];
        })
      : null;
    const name = (opts.names?.[id] ?? ai?.name ?? c.site_name ?? c.name ?? c.domain ?? "").trim().slice(0, 200);
    const known = new Set(
      ((await db.prepare("SELECT slug FROM categories").all<{ slug: string }>()).results ?? []).map((r) => r.slug),
    );
    const categories = (
      ai?.sectors?.length ? ai.sectors : (JSON.parse(c.suggested_categories_json ?? "[]") as string[])
    ).filter((s) => known.has(s));
    try {
      const input = companyInputSchema.parse({
        name,
        domain: c.domain,
        description: ai?.one_liner ?? c.site_description ?? undefined,
        categories,
        org_type: ai?.org_type ?? c.suggested_type ?? undefined,
        stage: ai?.stage && ai.stage !== "unknown" ? ai.stage : "early",
        audiences: ai?.audiences?.length ? ai.audiences : undefined,
        sources: [
          {
            url: c.found_url,
            kind: c.found_via === "hn" ? "announcement" : "directory",
            title: (c.found_title ?? "").slice(0, 300),
          },
        ],
      });
      const company = await createCompany(db, input, editor);
      await reviewCompany(db, company.id, { action: "verify", checked_url: `https://${c.domain}` }, editor);
      await confirmProfiles(db, [company.id], editor);
      await db
        .prepare(
          "UPDATE company_candidates SET status = 'approved', company_id = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
        )
        .bind(company.id, editor, nowIso(), id)
        .run();
      results.push({ id, ok: true, company_id: company.id });
    } catch (err) {
      const duplicate = err instanceof DuplicateCompanyError;
      if (duplicate) {
        await db
          .prepare("UPDATE company_candidates SET status = 'duplicate', reviewed_by = ?, reviewed_at = ? WHERE id = ?")
          .bind(editor, nowIso(), id)
          .run();
      }
      if (!(duplicate || err instanceof ConflictError || (err instanceof Error && err.name === "ZodError"))) throw err;
      results.push({
        id,
        ok: false,
        error: duplicate ? "already a company" : err instanceof Error ? err.message : "invalid",
      });
    }
  }
  // Fill in links and logos for the new companies now, not in an hour.
  for (const r of results)
    if (r.company_id) {
      await enrichCompany(db, r.company_id, { fetcher: opts.fetcher }).catch(() => undefined);
      await fetchLogo(db, r.company_id, { fetcher: opts.fetcher }).catch(() => undefined);
      await findContacts(db, r.company_id, { fetcher: opts.fetcher, env: opts.env }).catch(() => undefined);
    }
  return results;
}

export async function rejectCandidates(db: D1Database, ids: string[], editor: string) {
  const at = nowIso();
  const r = await db.batch(
    ids.map((id) =>
      db
        .prepare(
          "UPDATE company_candidates SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'new'",
        )
        .bind(editor, at, id),
    ),
  );
  return r.reduce((n, x) => n + (x.meta.changes ?? 0), 0);
}
