/**
 * Discover for a signed-in founder: verified, non-sample companies with their verified signals,
 * scored against the founder's search and onboarding answers (shared/discover.ts).
 */
import { type DiscoverCompany, type Goal, LABEL_RANK, parseQuery, scoreCompany } from "../../shared/discover.ts";
import { effectiveSignalStatus, SIGNAL_TYPES, type SignalType } from "../../shared/signals.ts";

export interface DiscoverInput {
  q: string;
  /** When given, these replace what was read from the search (the founder removed or added tokens). */
  categories?: string[];
  goals?: Goal[];
  /** A sector chip: only companies in this category. */
  category?: string;
}

interface Profile {
  company_name: string | null;
  one_liner: string | null;
  buyers: string | null;
  goals_json: string;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export async function discover(db: D1Database, workspaceId: string, input: DiscoverInput, now = new Date()) {
  const profile = await db
    .prepare("SELECT company_name, one_liner, buyers, goals_json FROM founder_profiles WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<Profile>();
  const parsed = parseQuery(input.q);
  const ownText = [profile?.one_liner, profile?.buyers].filter(Boolean).join(". ");
  const own = parseQuery(ownText).categories;
  const profileGoals = profile ? (JSON.parse(profile.goals_json) as Goal[]) : [];

  const { results: categoryRows } = await db
    .prepare("SELECT slug, label, kind FROM categories ORDER BY kind, label")
    .all<{ slug: string; label: string; kind: string }>();
  const known = new Set(categoryRows.map((c) => c.slug));
  const target = (input.categories ?? parsed.categories).filter((s) => known.has(s));
  const goals = input.goals ?? (parsed.goals.length ? parsed.goals : profileGoals);

  const { results: companies } = await db
    .prepare(
      `SELECT id, slug, name, primary_domain AS domain, description, last_verified_at FROM companies
       WHERE status = 'verified' AND is_sample = 0 ORDER BY name COLLATE NOCASE LIMIT 1000`,
    )
    .all<{
      id: string;
      slug: string;
      name: string;
      domain: string;
      description: string | null;
      last_verified_at: string | null;
    }>();
  if (companies.length === 0) {
    return {
      understood: understood(target, goals, parsed.places, categoryRows),
      verified_total: 0,
      results: [],
      categories: categoryRows,
    };
  }

  const { results: cats } = await db
    .prepare(
      `SELECT cc.company_id, c.slug, c.label, c.kind FROM company_categories cc JOIN categories c ON c.id = cc.category_id
       JOIN companies co ON co.id = cc.company_id WHERE co.status = 'verified' AND co.is_sample = 0`,
    )
    .all<{ company_id: string; slug: string; label: string; kind: string }>();
  const { results: sigs } = await db
    .prepare(
      `SELECT se.id, se.company_id, se.signal_type, se.title, se.factual_claim, se.source_excerpt, se.event_date,
         se.discovered_at, se.last_verified_at, se.status
       FROM signal_events se JOIN companies co ON co.id = se.company_id
       WHERE se.status = 'verified' AND se.is_sample = 0 AND co.status = 'verified' AND co.is_sample = 0`,
    )
    .all<{
      id: string;
      company_id: string;
      signal_type: SignalType;
      title: string;
      factual_claim: string;
      source_excerpt: string;
      event_date: string | null;
      discovered_at: string;
      last_verified_at: string;
      status: "verified";
    }>();
  const { results: srcs } = sigs.length
    ? await db
        .prepare(
          `SELECT ss.signal_id, ss.role, s.url, s.title, s.kind FROM signal_sources ss JOIN sources s ON s.id = ss.source_id
           JOIN signal_events se ON se.id = ss.signal_id WHERE se.status = 'verified' AND se.is_sample = 0`,
        )
        .all<{ signal_id: string; role: string; url: string; title: string; kind: string }>()
    : { results: [] };

  const results = companies
    .map((co) => {
      const categories = cats.filter((c) => c.company_id === co.id).map(({ company_id: _c, ...rest }) => rest);
      const signals = sigs
        .filter((s) => s.company_id === co.id)
        .map((s) => {
          const sources = srcs.filter((x) => x.signal_id === s.id);
          return {
            ...s,
            fresh: effectiveSignalStatus(s, now) === "verified",
            sources: sources.map(({ url, title, role }) => ({ url, title, role })),
            source_kinds: sources.map((x) => x.kind),
            source_hosts: sources.map((x) => host(x.url)),
          };
        });
      const input: DiscoverCompany = {
        name: co.name,
        description: co.description,
        domain: co.domain,
        categories,
        signals,
      };
      const fit = scoreCompany(input, { target, own, goals, terms: parsed.terms }, now);
      return { co, categories, signals, fit };
    })
    .filter((r) => !input.category || r.categories.some((c) => c.slug === input.category))
    .filter((r) => r.fit.label !== "below")
    .sort((a, b) => LABEL_RANK[a.fit.label] - LABEL_RANK[b.fit.label] || b.fit.overall - a.fit.overall)
    .slice(0, 50)
    .map(({ co, categories, signals, fit }) => {
      const ordered = [...signals].sort((a, b) =>
        (b.event_date ?? b.discovered_at).localeCompare(a.event_date ?? a.discovered_at),
      );
      return {
        slug: co.slug,
        name: co.name,
        domain: co.domain,
        description: co.description,
        last_verified_at: co.last_verified_at,
        categories,
        fit: {
          overall: fit.label === "needs_verification" ? null : fit.overall,
          label: fit.label,
          evidence: fit.evidence,
          why: fit.why,
          factors: fit.factors,
        },
        signals: ordered.map((s) => ({
          type: s.signal_type,
          type_label: SIGNAL_TYPES[s.signal_type].label,
          title: s.title,
          claim: s.factual_claim,
          excerpt: s.source_excerpt,
          event_date: s.event_date,
          last_verified_at: s.last_verified_at,
          status: s.fresh ? "verified" : "stale",
          sources: s.sources,
        })),
      };
    });

  return {
    understood: understood(target, goals, parsed.places, categoryRows),
    verified_total: companies.length,
    results,
    categories: categoryRows,
  };
}

function understood(target: string[], goals: Goal[], places: string[], categories: { slug: string; label: string }[]) {
  return {
    categories: target.map((slug) => ({ slug, label: categories.find((c) => c.slug === slug)?.label ?? slug })),
    goals,
    places,
  };
}
