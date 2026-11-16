/**
 * Company logos: the company's own icon, read by the server from the company's own website and
 * served from our domain, so founders' browsers never contact other sites and no logo service is used.
 *
 * - Looks at the homepage's <link rel="apple-touch-icon"> and <link rel="icon">, then /apple-touch-icon.png
 *   and /favicon.ico. Only the company's own domain (and its subdomains) is read, unless Dan gives a URL.
 * - Raster images only (PNG, JPEG, WebP, GIF, ICO), checked by their first bytes, at most 100 KB.
 *   SVG is never stored: served from our domain it could carry script.
 * - Dan can hide a logo or point to a better image in the back office. A hidden logo stays hidden
 *   until Dan sets one again.
 */

import { iconCandidates, type LogoType, sniffImage } from "../../shared/logo.ts";
import { USER_AGENT } from "./collector.ts";
import { NotFoundError, nowIso } from "./util.ts";

export const MAX_LOGO_BYTES = 100_000;
const MAX_HTML_BYTES = 300_000;
const TIMEOUT_MS = 8_000;
const RECHECK_DAYS = 30;

const ownSite = (url: string, domain: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

async function get(fetcher: typeof fetch, url: string) {
  return fetcher(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,image/*;q=0.9,*/*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function tryImage(fetcher: typeof fetch, url: string) {
  try {
    const res = await get(fetcher, url);
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_LOGO_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) return null;
    const type = sniffImage(bytes);
    return type ? { url, bytes, type } : null;
  } catch {
    return null;
  }
}

/**
 * Find and store a company's logo. With `url`, only that image is tried (Dan's replacement);
 * otherwise the company's own site is read. Returns the stored status.
 */
export async function fetchLogo(
  db: D1Database,
  companyId: string,
  opts: { fetcher?: typeof fetch; url?: string; editor?: string; now?: Date } = {},
): Promise<{ status: "found" | "none"; source_url: string | null; note: string | null }> {
  const fetcher = opts.fetcher ?? fetch;
  const co = await db
    .prepare("SELECT id, primary_domain AS domain FROM companies WHERE id = ?")
    .bind(companyId)
    .first<{ id: string; domain: string }>();
  if (!co) throw new NotFoundError("company not found");

  let candidates: string[] = [];
  if (opts.url) candidates = [opts.url];
  else {
    const home = `https://${co.domain}/`;
    try {
      const res = await get(fetcher, home);
      if (res.ok && (res.headers.get("content-type") ?? "").includes("html")) {
        const html = (await res.text()).slice(0, MAX_HTML_BYTES);
        candidates = iconCandidates(html, res.url || home).filter((u) => ownSite(u, co.domain));
      }
    } catch {
      // Homepage unreachable: still try the usual icon paths below.
    }
    candidates.push(`https://${co.domain}/apple-touch-icon.png`, `https://${co.domain}/favicon.ico`);
  }

  let hit: Awaited<ReturnType<typeof tryImage>> = null;
  for (const url of [...new Set(candidates)].slice(0, 6)) {
    hit = await tryImage(fetcher, url);
    if (hit) break;
  }
  const at = nowIso(opts.now ?? new Date());
  const note = hit ? null : "No PNG, JPEG, WebP, GIF or ICO icon under 100 KB was found.";
  if (!hit) {
    // A failed replacement link or a failed recheck never removes a logo that is showing.
    const current = await db
      .prepare("SELECT status FROM company_logos WHERE company_id = ?")
      .bind(co.id)
      .first<{ status: string }>();
    if (opts.url || current?.status === "found" || current?.status === "hidden") {
      if (current)
        await db.prepare("UPDATE company_logos SET checked_at = ? WHERE company_id = ?").bind(at, co.id).run();
      return { status: "none", source_url: null, note };
    }
  }
  await db
    .prepare(
      `INSERT INTO company_logos (company_id, status, content_type, bytes, source_url, note, checked_at, set_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET status = excluded.status, content_type = excluded.content_type,
         bytes = excluded.bytes, source_url = excluded.source_url, note = excluded.note,
         checked_at = excluded.checked_at, set_by = excluded.set_by`,
    )
    .bind(
      co.id,
      hit ? "found" : "none",
      hit?.type ?? null,
      hit ? hit.bytes : null,
      hit?.url ?? null,
      note,
      at,
      opts.editor ?? "collector",
    )
    .run();
  return { status: hit ? "found" : "none", source_url: hit?.url ?? null, note };
}

/** Dan hides a logo: initials are shown instead, and the hourly check leaves it alone. */
export async function hideLogo(db: D1Database, companyId: string, editor: string, now = new Date()) {
  const co = await db.prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first();
  if (!co) throw new NotFoundError("company not found");
  await db
    .prepare(
      `INSERT INTO company_logos (company_id, status, checked_at, set_by) VALUES (?, 'hidden', ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET status = 'hidden', content_type = NULL, bytes = NULL,
         source_url = NULL, note = 'Hidden by Dan', checked_at = excluded.checked_at, set_by = excluded.set_by`,
    )
    .bind(companyId, nowIso(now), editor)
    .run();
}

/** A few verified companies whose logo was never checked, or not for a month (hidden ones are skipped). */
export async function fetchMissingLogos(db: D1Database, opts: { fetcher?: typeof fetch; limit?: number } = {}) {
  const since = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT c.id FROM companies c LEFT JOIN company_logos l ON l.company_id = c.id
       WHERE c.status = 'verified' AND c.is_sample = 0
         AND (l.company_id IS NULL OR (l.status != 'hidden' AND l.checked_at < ?))
       ORDER BY l.checked_at IS NOT NULL, l.checked_at LIMIT ?`,
    )
    .bind(since, opts.limit ?? 5)
    .all<{ id: string }>();
  const out = [];
  for (const r of results) out.push({ id: r.id, ...(await fetchLogo(db, r.id, { fetcher: opts.fetcher })) });
  return out;
}

/** The logo to serve for a verified company, if it has one showing. */
export async function getLogo(db: D1Database, slug: string) {
  const row = await db
    .prepare(
      `SELECT l.content_type, l.bytes, l.checked_at FROM company_logos l JOIN companies c ON c.id = l.company_id
       WHERE c.slug = ? AND c.status = 'verified' AND c.is_sample = 0 AND l.status = 'found'`,
    )
    .bind(slug)
    .first<{ content_type: LogoType; bytes: ArrayBuffer | number[]; checked_at: string }>();
  if (!row) return null;
  const bytes = row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : new Uint8Array(row.bytes);
  return { type: row.content_type, bytes, version: row.checked_at };
}

/** Which companies have a logo showing, with a version for cache-busting. */
export async function logoVersions(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db
    .prepare("SELECT company_id, checked_at FROM company_logos WHERE status = 'found'")
    .all<{ company_id: string; checked_at: string }>();
  return new Map(results.map((r) => [r.company_id, r.checked_at]));
}

/** Logo state for the back office. */
export async function logoInfo(db: D1Database, companyId: string) {
  return db
    .prepare(
      "SELECT status, content_type, source_url, note, checked_at, set_by, length(bytes) AS size FROM company_logos WHERE company_id = ?",
    )
    .bind(companyId)
    .first<{
      status: string;
      content_type: string | null;
      source_url: string | null;
      note: string | null;
      checked_at: string;
      set_by: string;
      size: number | null;
    }>();
}
