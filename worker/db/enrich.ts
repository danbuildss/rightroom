/**
 * Fill in a company's public details from its own homepage: X, GitHub, LinkedIn page, docs,
 * partner page, and a published partnerships email or contact form (shared/enrich.ts reads the page).
 *
 * Dan approved (2026-11-15) that these appear without review, because they come from the company's
 * own site. What's already there is never overwritten, and anything Dan removes is never filled in
 * again automatically.
 */
import { readHomepage, type SiteFindings } from "../../shared/enrich.ts";
import { USER_AGENT } from "./collector.ts";
import { addAlias, addSource, DuplicateCompanyError } from "./companies.ts";
import { NotFoundError, nowIso } from "./util.ts";

export type DetailKind = keyof SiteFindings;
const MAX_HTML = 1_000_000;
const RECHECK_DAYS = 30;

async function blocked(db: D1Database, companyId: string): Promise<Set<string>> {
  const row = await db
    .prepare("SELECT blocked_json FROM company_enrichment WHERE company_id = ?")
    .bind(companyId)
    .first<{ blocked_json: string }>();
  return new Set(JSON.parse(row?.blocked_json ?? "[]") as string[]);
}

/** Dan removed a detail: don't fill it in again from the website. */
export async function blockDetail(db: D1Database, companyId: string, kind: DetailKind, now = new Date()) {
  const b = await blocked(db, companyId);
  b.add(kind);
  await db
    .prepare(
      `INSERT INTO company_enrichment (company_id, checked_at, blocked_json) VALUES (?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET blocked_json = excluded.blocked_json`,
    )
    .bind(companyId, nowIso(now), JSON.stringify([...b]))
    .run();
}

/** Dan set a detail by hand: it's allowed again (and his value wins). */
export async function unblockDetail(db: D1Database, companyId: string, kind: DetailKind) {
  const b = await blocked(db, companyId);
  if (!b.delete(kind)) return;
  await db
    .prepare("UPDATE company_enrichment SET blocked_json = ? WHERE company_id = ?")
    .bind(JSON.stringify([...b]), companyId)
    .run();
}

export async function enrichCompany(
  db: D1Database,
  companyId: string,
  opts: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<{ added: DetailKind[]; found: Partial<SiteFindings>; note: string | null }> {
  const fetcher = opts.fetcher ?? fetch;
  const at = nowIso(opts.now ?? new Date());
  const co = await db
    .prepare("SELECT id, primary_domain AS domain FROM companies WHERE id = ?")
    .bind(companyId)
    .first<{ id: string; domain: string }>();
  if (!co) throw new NotFoundError("company not found");

  let found: SiteFindings | null = null;
  let note: string | null = null;
  try {
    const res = await fetcher(`https://${co.domain}/`, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) note = `Their homepage answered ${res.status}.`;
    else if (!(res.headers.get("content-type") ?? "").includes("html")) note = "Their homepage isn't an HTML page.";
    else found = readHomepage((await res.text()).slice(0, MAX_HTML), res.url || `https://${co.domain}/`, co.domain);
  } catch {
    note = "Couldn't reach their homepage.";
  }

  const added: DetailKind[] = [];
  if (found) {
    const skip = await blocked(db, co.id);
    const [aliases, sources, web] = await db.batch([
      db
        .prepare("SELECT kind FROM company_aliases WHERE company_id = ? AND kind IN ('x_handle', 'github_org')")
        .bind(co.id),
      db.prepare("SELECT kind FROM sources WHERE company_id = ? AND kind IN ('docs', 'partner_page')").bind(co.id),
      db.prepare("SELECT kind FROM company_web_links WHERE company_id = ?").bind(co.id),
    ]);
    const has = new Set([
      ...((aliases?.results ?? []) as { kind: string }[]).map((r) => (r.kind === "x_handle" ? "x" : "github")),
      ...((sources?.results ?? []) as { kind: string }[]).map((r) => (r.kind === "docs" ? "docs" : "partners")),
      ...((web?.results ?? []) as { kind: string }[]).map((r) => r.kind),
    ]);
    const want = (k: DetailKind) => found?.[k] && !has.has(k) && !skip.has(k);
    for (const [k, aliasKind] of [
      ["x", "x_handle"],
      ["github", "github_org"],
    ] as const) {
      if (!want(k)) continue;
      try {
        await addAlias(db, co.id, aliasKind, found[k] as string);
        added.push(k);
      } catch (err) {
        // Another company already uses that handle: leave it for Dan.
        if (!(err instanceof DuplicateCompanyError)) throw err;
      }
    }
    for (const [k, kind, title] of [
      ["docs", "docs", "Docs (linked from their homepage)"],
      ["partners", "partner_page", "Partner page (linked from their homepage)"],
    ] as const) {
      if (!want(k)) continue;
      await addSource(db, co.id, { url: found[k] as string, kind, title, published_at: null });
      added.push(k);
    }
    for (const k of ["linkedin", "email", "contact_form"] as const) {
      if (!want(k)) continue;
      await db
        .prepare(
          "INSERT INTO company_web_links (company_id, kind, value, origin, found_at) VALUES (?, ?, ?, 'website', ?) ON CONFLICT DO NOTHING",
        )
        .bind(co.id, k, found[k], at)
        .run();
      added.push(k);
    }
  }
  const clean = Object.fromEntries(Object.entries(found ?? {}).filter(([, v]) => v)) as Partial<SiteFindings>;
  await db
    .prepare(
      `INSERT INTO company_enrichment (company_id, checked_at, found_json, note) VALUES (?, ?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET checked_at = excluded.checked_at, found_json = excluded.found_json, note = excluded.note`,
    )
    .bind(co.id, at, JSON.stringify(clean), note)
    .run();
  return { added, found: clean, note };
}

/** A few verified companies whose website was never read, or not for a month. */
export async function enrichMissing(db: D1Database, opts: { fetcher?: typeof fetch; limit?: number } = {}) {
  const since = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT c.id FROM companies c LEFT JOIN company_enrichment e ON e.company_id = c.id
       WHERE c.status = 'verified' AND c.is_sample = 0 AND (e.company_id IS NULL OR e.checked_at < ?)
       ORDER BY e.checked_at IS NOT NULL, e.checked_at LIMIT ?`,
    )
    .bind(since, opts.limit ?? 5)
    .all<{ id: string }>();
  const out = [];
  for (const r of results) out.push({ id: r.id, ...(await enrichCompany(db, r.id, { fetcher: opts.fetcher })) });
  return out;
}

export async function enrichmentInfo(db: D1Database, companyId: string) {
  const row = await db
    .prepare("SELECT checked_at, found_json, note, blocked_json FROM company_enrichment WHERE company_id = ?")
    .bind(companyId)
    .first<{ checked_at: string; found_json: string; note: string | null; blocked_json: string }>();
  const { results: web } = await db
    .prepare("SELECT kind, value, origin FROM company_web_links WHERE company_id = ?")
    .bind(companyId)
    .all<{ kind: string; value: string; origin: string }>();
  return {
    checked_at: row?.checked_at ?? null,
    note: row?.note ?? null,
    found: JSON.parse(row?.found_json ?? "{}") as Partial<SiteFindings>,
    blocked: JSON.parse(row?.blocked_json ?? "[]") as string[],
    web,
  };
}
