/**
 * Discover and Company intelligence for a signed-in founder: verified, non-sample companies with
 * their verified signals, scored against the founder's search and onboarding answers
 * (shared/discover.ts). Suggestions come from shared/intel.ts.
 */
import { type DiscoverCompany, type Goal, LABEL_RANK, parseQuery, scoreCompany } from "../../shared/discover.ts";
import { suggest } from "../../shared/intel.ts";
import type { OrgType, Stage as ProfileStage, ProfileStatus } from "../../shared/profile.ts";
import { effectiveSignalStatus, SIGNAL_TYPES, type SignalType } from "../../shared/signals.ts";
import { listContacts } from "./contacts.ts";
import { linksFor } from "./links.ts";
import { logoVersions } from "./logos.ts";

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

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  domain: string;
  description: string | null;
  last_verified_at: string | null;
  first_seen_at: string;
  org_type: OrgType | null;
  hq_country: string | null;
  stage: ProfileStage | null;
  audiences_json: string;
  profile_status: ProfileStatus;
}

interface SignalRow {
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
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Our own URL for a company's stored logo, versioned so a new logo isn't hidden by caches. */
export const logoUrl = (slug: string, version: string | undefined) =>
  version ? `/api/public/logos/${encodeURIComponent(slug)}?v=${encodeURIComponent(version.replace(/\D/g, ""))}` : null;

export async function load(db: D1Database, workspaceId: string, input: DiscoverInput, only?: { slug: string }) {
  const profile = await db
    .prepare("SELECT company_name, one_liner, buyers, goals_json FROM founder_profiles WHERE workspace_id = ?")
    .bind(workspaceId)
    .first<Profile>();
  const parsed = parseQuery(input.q);
  const own = parseQuery([profile?.one_liner, profile?.buyers].filter(Boolean).join(". ")).categories;
  const profileGoals = profile ? (JSON.parse(profile.goals_json) as Goal[]) : [];

  const { results: categoryRows } = await db
    .prepare(
      "SELECT slug, COALESCE(short_label, label) AS label, label AS full_label, kind FROM categories ORDER BY kind, label",
    )
    .all<{ slug: string; label: string; full_label: string; kind: string }>();
  const known = new Set(categoryRows.map((c) => c.slug));
  const target = (input.categories ?? parsed.categories).filter((s) => known.has(s));
  const goals = input.goals ?? (parsed.goals.length ? parsed.goals : profileGoals);

  const filter = only ? "AND co.slug = ?" : "";
  const bind = only ? [only.slug] : [];
  const { results: companies } = await db
    .prepare(
      `SELECT co.id, co.slug, co.name, co.primary_domain AS domain, co.description, co.last_verified_at, co.first_seen_at,
         co.org_type, co.hq_country, co.stage, co.audiences_json, co.profile_status FROM companies co
       WHERE co.status = 'verified' AND co.is_sample = 0 ${filter} ORDER BY co.name COLLATE NOCASE LIMIT 1000`,
    )
    .bind(...bind)
    .all<CompanyRow>();

  const scored = [];
  if (companies.length) {
    const { results: cats } = await db
      .prepare(
        `SELECT cc.company_id, c.slug, COALESCE(c.short_label, c.label) AS label, c.kind FROM company_categories cc JOIN categories c ON c.id = cc.category_id
         JOIN companies co ON co.id = cc.company_id WHERE co.status = 'verified' AND co.is_sample = 0 ${filter}`,
      )
      .bind(...bind)
      .all<{ company_id: string; slug: string; label: string; kind: string }>();
    const { results: sigs } = await db
      .prepare(
        `SELECT se.id, se.company_id, se.signal_type, se.title, se.factual_claim, se.source_excerpt, se.event_date,
           se.discovered_at, se.last_verified_at, se.status
         FROM signal_events se JOIN companies co ON co.id = se.company_id
         WHERE se.status = 'verified' AND se.is_sample = 0 AND co.status = 'verified' AND co.is_sample = 0 ${filter}`,
      )
      .bind(...bind)
      .all<SignalRow>();
    const { results: srcs } = sigs.length
      ? await db
          .prepare(
            `SELECT ss.signal_id, ss.role, s.url, s.title, s.kind FROM signal_sources ss JOIN sources s ON s.id = ss.source_id
             JOIN signal_events se ON se.id = ss.signal_id JOIN companies co ON co.id = se.company_id
             WHERE se.status = 'verified' AND se.is_sample = 0 ${filter}`,
          )
          .bind(...bind)
          .all<{ signal_id: string; role: string; url: string; title: string; kind: string }>()
      : { results: [] };

    const { results: contactRows } = await db
      .prepare(
        `SELECT k.company_id, k.kind, k.role, k.confidence FROM company_contacts k JOIN companies co ON co.id = k.company_id
         WHERE k.status = 'verified' AND co.status = 'verified' AND co.is_sample = 0 ${filter}`,
      )
      .bind(...bind)
      .all<{
        company_id: string;
        kind: "person" | "channel";
        role: string | null;
        confidence: "high" | "medium" | "low";
      }>();

    const [links, logos] = await Promise.all([linksFor(db, companies), logoVersions(db)]);
    for (const co of companies) {
      const mine = contactRows.filter((k) => k.company_id === co.id);
      const contacts = {
        people: mine
          .filter((k) => k.kind === "person")
          .map((k) => ({ role: k.role ?? "contact", confidence: k.confidence })),
        channels: mine.filter((k) => k.kind === "channel").length,
      };
      const categories = cats.filter((c) => c.company_id === co.id).map(({ company_id: _c, ...rest }) => rest);
      const signals = sigs
        .filter((s) => s.company_id === co.id)
        .map((s) => {
          const sources = srcs.filter((x) => x.signal_id === s.id);
          return {
            ...s,
            fresh: effectiveSignalStatus(s, new Date()) === "verified",
            sources: sources.map(({ url, title, role }) => ({ url, title, role })),
            source_kinds: sources.map((x) => x.kind),
            source_hosts: sources.map((x) => host(x.url)),
          };
        })
        .sort((a, b) => (b.event_date ?? b.discovered_at).localeCompare(a.event_date ?? a.discovered_at));
      const dc: DiscoverCompany = {
        name: co.name,
        description: co.description,
        domain: co.domain,
        categories,
        signals,
        contacts,
      };
      scored.push({
        co,
        categories,
        signals,
        fit: scoreCompany(dc, { target, own, goals, terms: parsed.terms }),
        links: links.get(co.id) ?? {
          website: `https://${co.domain}`,
          x: null,
          github: null,
          partners: null,
          docs: null,
        },
        logo: logoUrl(co.slug, logos.get(co.id)),
      });
    }
  }
  const { results: savedRows } = await db
    .prepare("SELECT id, company_id, stage FROM founder_saved WHERE workspace_id = ?")
    .bind(workspaceId)
    .all<{ id: string; company_id: string; stage: string }>();
  const saved = new Map(savedRows.map((r) => [r.company_id, { id: r.id, stage: r.stage }]));
  return { profile, target, goals, places: parsed.places, categoryRows, scored, saved };
}

type Scored = Awaited<ReturnType<typeof load>>["scored"][number];

function view({ co, categories, signals, fit, links, logo }: Scored, saved?: { id: string; stage: string }) {
  return {
    saved: saved ?? null,
    links,
    logo,
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
    signals: signals.map((s) => ({
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
}

export async function discover(db: D1Database, workspaceId: string, input: DiscoverInput) {
  const data = await load(db, workspaceId, input);
  const results = data.scored
    .filter((r) => !input.category || r.categories.some((c) => c.slug === input.category))
    .filter((r) => r.fit.label !== "below")
    .sort((a, b) => LABEL_RANK[a.fit.label] - LABEL_RANK[b.fit.label] || b.fit.overall - a.fit.overall)
    .slice(0, 50)
    .map((r) => view(r, data.saved.get(r.co.id)));
  return {
    understood: {
      categories: data.target.map((slug) => ({
        slug,
        label: data.categoryRows.find((c) => c.slug === slug)?.label ?? slug,
      })),
      goals: data.goals,
      places: data.places,
    },
    verified_total: data.scored.length,
    results,
    categories: data.categoryRows,
  };
}

/** One verified company, scored for this founder, with verified contacts and Rightroom's suggestions. */
export async function companyIntel(db: D1Database, workspaceId: string, slug: string) {
  const data = await load(db, workspaceId, { q: "" }, { slug });
  const row = data.scored[0];
  if (!row) return null;
  const contacts = await listContacts(db, row.co.id, { verifiedOnly: true });
  const people = contacts
    .filter((c) => c.kind === "person")
    .map((c) => ({
      name: c.name,
      role: c.role,
      source_url: c.source_url,
      confidence: c.confidence,
      last_checked_at: c.last_checked_at,
    }));
  const channels = contacts
    .filter((c) => c.kind === "channel")
    .map((c) => ({ label: c.channel_label, url: c.url, source_url: c.source_url, last_checked_at: c.last_checked_at }));
  const suggestions = suggest({
    companyName: row.co.name,
    sectors: row.categories.filter((c) => c.kind === "sector").map((c) => c.label),
    goals: data.goals,
    founder: {
      company_name: data.profile?.company_name ?? null,
      one_liner: data.profile?.one_liner ?? null,
      buyers: data.profile?.buyers ?? null,
    },
    signals: row.signals.map((s) => ({ type: s.signal_type, event_date: s.event_date, fresh: s.fresh })),
    channels: channels.map((c) => ({ label: c.label ?? "" })),
  });
  return { company: view(row, data.saved.get(row.co.id)), people, channels, suggestions, goals: data.goals };
}
