/**
 * What public Discover may show. Only verified companies, and only verified signals
 * of verified companies (stale ones are shown with their last-verified date).
 * Sample records and internal fields (who reviewed, internal notes) are never returned.
 */
import { effectiveSignalStatus, SIGNAL_TYPES, type SignalType } from "../../shared/signals.ts";

export interface PublicCompany {
  slug: string;
  name: string;
  domain: string;
  description: string | null;
  categories: { slug: string; label: string; kind: string }[];
  last_verified_at: string | null;
  signal_count: number;
}

export interface PublicSignal {
  id: string;
  company: { slug: string; name: string; domain: string };
  type: { slug: SignalType; label: string; intent: string };
  title: string;
  claim: string;
  excerpt: string;
  /** Talo's view of why it may matter. Always presented as an opinion, never as fact. */
  our_view: string | null;
  event_date: string | null;
  discovered_at: string;
  last_verified_at: string;
  status: "verified" | "stale";
  sources: { url: string; title: string; role: "primary" | "corroborating"; published_at: string | null }[];
}

const escapeLike = (s: string) => s.toLowerCase().replace(/[%_\\]/g, (m) => `\\${m}`);
const clampLimit = (n: number | undefined, max = 100) => Math.min(Math.max(n ?? 30, 1), max);

async function categoriesFor(db: D1Database, ids: string[]) {
  const map = new Map<string, PublicCompany["categories"]>();
  if (ids.length === 0) return map;
  const { results } = await db
    .prepare(
      `SELECT cc.company_id, c.slug, c.label, c.kind FROM company_categories cc JOIN categories c ON c.id = cc.category_id
       WHERE cc.company_id IN (${ids.map(() => "?").join(",")}) ORDER BY c.kind, c.label`,
    )
    .bind(...ids)
    .all<{ company_id: string; slug: string; label: string; kind: string }>();
  for (const r of results) {
    const list = map.get(r.company_id) ?? [];
    list.push({ slug: r.slug, label: r.label, kind: r.kind });
    map.set(r.company_id, list);
  }
  return map;
}

export async function listPublicCompanies(
  db: D1Database,
  filter: { q?: string; category?: string; limit?: number; offset?: number } = {},
): Promise<PublicCompany[]> {
  const where = ["c.status = 'verified'", "c.is_sample = 0"];
  const args: unknown[] = [];
  if (filter.q) {
    const like = `%${escapeLike(filter.q)}%`;
    where.push(
      "(LOWER(c.name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.description, '')) LIKE ? ESCAPE '\\' OR c.primary_domain LIKE ? ESCAPE '\\')",
    );
    args.push(like, like, like);
  }
  if (filter.category) {
    where.push(
      "c.id IN (SELECT cc.company_id FROM company_categories cc JOIN categories cat ON cat.id = cc.category_id WHERE cat.slug = ?)",
    );
    args.push(filter.category);
  }
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.primary_domain AS domain, c.description, c.last_verified_at,
         (SELECT COUNT(*) FROM signal_events se WHERE se.company_id = c.id AND se.status = 'verified' AND se.is_sample = 0) AS signal_count
       FROM companies c WHERE ${where.join(" AND ")} ORDER BY c.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    )
    .bind(...args, clampLimit(filter.limit), Math.max(filter.offset ?? 0, 0))
    .all<Omit<PublicCompany, "categories"> & { id: string }>();
  const cats = await categoriesFor(
    db,
    results.map((r) => r.id),
  );
  return results.map(({ id, ...r }) => ({ ...r, categories: cats.get(id) ?? [] }));
}

export async function listPublicSignals(
  db: D1Database,
  filter: { type?: SignalType; category?: string; companySlug?: string; limit?: number; offset?: number } = {},
  now = new Date(),
): Promise<PublicSignal[]> {
  const where = ["se.status = 'verified'", "c.status = 'verified'", "se.is_sample = 0", "c.is_sample = 0"];
  const args: unknown[] = [];
  if (filter.type) {
    where.push("se.signal_type = ?");
    args.push(filter.type);
  }
  if (filter.companySlug) {
    where.push("c.slug = ?");
    args.push(filter.companySlug);
  }
  if (filter.category) {
    where.push(
      "c.id IN (SELECT cc.company_id FROM company_categories cc JOIN categories cat ON cat.id = cc.category_id WHERE cat.slug = ?)",
    );
    args.push(filter.category);
  }
  const { results } = await db
    .prepare(
      `SELECT se.id, se.signal_type, se.title, se.factual_claim, se.source_excerpt, se.opportunity_note, se.event_date,
         se.discovered_at, se.last_verified_at, se.status, c.slug AS company_slug, c.name AS company_name,
         c.primary_domain AS company_domain
       FROM signal_events se JOIN companies c ON c.id = se.company_id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(se.event_date, substr(se.discovered_at, 1, 10)) DESC, se.discovered_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...args, clampLimit(filter.limit), Math.max(filter.offset ?? 0, 0))
    .all<{
      id: string;
      signal_type: SignalType;
      title: string;
      factual_claim: string;
      source_excerpt: string;
      opportunity_note: string | null;
      event_date: string | null;
      discovered_at: string;
      last_verified_at: string;
      status: "verified";
      company_slug: string;
      company_name: string;
      company_domain: string;
    }>();
  if (results.length === 0) return [];
  const { results: srcs } = await db
    .prepare(
      `SELECT ss.signal_id, ss.role, s.url, s.title, s.published_at FROM signal_sources ss JOIN sources s ON s.id = ss.source_id
       WHERE ss.signal_id IN (${results.map(() => "?").join(",")}) ORDER BY ss.role DESC`,
    )
    .bind(...results.map((r) => r.id))
    .all<{
      signal_id: string;
      role: "primary" | "corroborating";
      url: string;
      title: string;
      published_at: string | null;
    }>();
  return results.map((r) => ({
    id: r.id,
    company: { slug: r.company_slug, name: r.company_name, domain: r.company_domain },
    type: { slug: r.signal_type, label: SIGNAL_TYPES[r.signal_type].label, intent: SIGNAL_TYPES[r.signal_type].intent },
    title: r.title,
    claim: r.factual_claim,
    excerpt: r.source_excerpt,
    our_view: r.opportunity_note,
    event_date: r.event_date,
    discovered_at: r.discovered_at,
    last_verified_at: r.last_verified_at,
    status: effectiveSignalStatus(r, now) === "stale" ? "stale" : "verified",
    sources: srcs
      .filter((s) => s.signal_id === r.id)
      .map(({ url, title, role, published_at }) => ({ url, title, role, published_at })),
  }));
}

export async function getPublicCompany(
  db: D1Database,
  slug: string,
  now = new Date(),
): Promise<(PublicCompany & { signals: PublicSignal[] }) | null> {
  const row = await db
    .prepare(
      `SELECT id, slug, name, primary_domain AS domain, description, last_verified_at FROM companies
       WHERE slug = ? AND status = 'verified' AND is_sample = 0`,
    )
    .bind(slug)
    .first<Omit<PublicCompany, "categories" | "signal_count"> & { id: string }>();
  if (!row) return null;
  const { id, ...company } = row;
  const signals = await listPublicSignals(db, { companySlug: slug, limit: 100 }, now);
  const cats = await categoriesFor(db, [id]);
  return { ...company, categories: cats.get(id) ?? [], signal_count: signals.length, signals };
}

export async function publicCategories(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT cat.slug, cat.label, cat.kind,
         (SELECT COUNT(*) FROM company_categories cc JOIN companies c ON c.id = cc.company_id
          WHERE cc.category_id = cat.id AND c.status = 'verified' AND c.is_sample = 0) AS company_count
       FROM categories cat ORDER BY cat.kind, cat.label`,
    )
    .all<{ slug: string; label: string; kind: string; company_count: number }>();
  return results;
}
