/**
 * Explore: every verified company, whatever its fit for this founder, with search, filters,
 * category counts and pages. Built on Discover's loader (worker/db/discover.ts), so fit, signals
 * and saved state are the same everywhere.
 *
 * - Profile fields (type, country, stage, audience) are shown only once Dan has confirmed them.
 * - Partnership types come from verified, fresh signals (GOAL_SIGNALS), never from guesses.
 * - The fit label is shown only when it is Strong or Potential fit; Explore never hides a company for its fit.
 * - The "possible angle" is Rightroom's suggestion (shared/intel.ts), labelled as such in the app.
 */
import { GOAL_SIGNALS, type Goal } from "../../shared/discover.ts";
import { GOALS } from "../../shared/founder.ts";
import { suggest } from "../../shared/intel.ts";
import { type Audience, ORG_TYPE_INFO, ORG_TYPES, type OrgType, parseAudiences } from "../../shared/profile.ts";
import { SIGNAL_TYPES } from "../../shared/signals.ts";
import { load } from "./discover.ts";

export const EXPLORE_SORTS = ["signal", "name", "fit", "newest"] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];

export interface ExploreInput {
  q?: string;
  type?: OrgType;
  sector?: string;
  country?: string;
  goal?: Goal;
  stage?: string;
  audience?: Audience;
  sort?: ExploreSort;
  limit?: number;
  offset?: number;
}

const FIT_RANK = { strong: 0, potential: 1, needs_verification: 2, below: 3 } as const;

export async function explore(db: D1Database, workspaceId: string, input: ExploreInput) {
  const data = await load(db, workspaceId, { q: "" });
  const founder = {
    company_name: data.profile?.company_name ?? null,
    one_liner: data.profile?.one_liner ?? null,
    buyers: data.profile?.buyers ?? null,
  };

  const all = data.scored.map((r) => {
    const confirmed = r.co.profile_status === "confirmed";
    const sectors = r.categories.filter((c) => c.kind === "sector");
    const fresh = r.signals.filter((s) => s.fresh);
    const goals = GOALS.filter((g) => fresh.some((s) => GOAL_SIGNALS[g].includes(s.signal_type)));
    const latest = r.signals[0];
    const angle = r.signals.length
      ? suggest({
          companyName: r.co.name,
          sectors: sectors.map((c) => c.label),
          goals: data.goals,
          founder,
          signals: r.signals.map((s) => ({ type: s.signal_type, event_date: s.event_date, fresh: s.fresh })),
          channels: [],
        }).for_you
      : null;
    return {
      row: r,
      search: [r.co.name, r.co.domain, r.co.description ?? "", ...r.categories.map((c) => c.label)]
        .join(" ")
        .toLowerCase(),
      card: {
        slug: r.co.slug,
        name: r.co.name,
        domain: r.co.domain,
        description: r.co.description,
        sectors: sectors.map((c) => ({ slug: c.slug, label: c.label })),
        profile: confirmed
          ? {
              type: r.co.org_type,
              country: r.co.hq_country,
              stage: r.co.stage,
              audiences: parseAudiences(r.co.audiences_json),
            }
          : null,
        partnership_types: goals,
        latest_signal: latest
          ? {
              type_label: SIGNAL_TYPES[latest.signal_type].label,
              event_date: latest.event_date,
              last_verified_at: latest.last_verified_at,
              fresh: latest.fresh,
            }
          : null,
        angle,
        fit:
          r.fit.label === "strong" || r.fit.label === "potential"
            ? { label: r.fit.label, overall: r.fit.overall }
            : null,
        evidence: r.fit.evidence,
        last_verified_at: r.co.last_verified_at,
        saved: data.saved.get(r.co.id) ?? null,
      },
      sortKeys: {
        signal: latest?.event_date ?? latest?.last_verified_at?.slice(0, 10) ?? "",
        added: r.co.first_seen_at,
        fit: FIT_RANK[r.fit.label] * 1000 - r.fit.overall,
      },
    };
  });

  const q = input.q?.trim().toLowerCase();
  const words = q ? q.split(/\s+/).filter(Boolean) : [];
  const searched = all.filter((x) => words.every((w) => x.search.includes(w)));
  const typed = input.type ? searched.filter((x) => x.card.profile?.type === input.type) : searched;
  const results = typed.filter(
    (x) =>
      (!input.sector || x.card.sectors.some((s) => s.slug === input.sector)) &&
      (!input.country || x.card.profile?.country === input.country) &&
      (!input.goal || x.card.partnership_types.includes(input.goal)) &&
      (!input.stage || x.card.profile?.stage === input.stage) &&
      (!input.audience || x.card.profile?.audiences.includes(input.audience)),
  );

  const sort = input.sort ?? "signal";
  results.sort((a, b) => {
    if (sort === "name") return a.card.name.localeCompare(b.card.name);
    if (sort === "fit") return a.sortKeys.fit - b.sortKeys.fit || a.card.name.localeCompare(b.card.name);
    if (sort === "newest") return b.sortKeys.added.localeCompare(a.sortKeys.added);
    return b.sortKeys.signal.localeCompare(a.sortKeys.signal) || a.card.name.localeCompare(b.card.name);
  });

  const count = <K extends string>(keys: (K | null | undefined)[]) => {
    const m = new Map<K, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  // Category tiles count the search result; the other filters count within the chosen category.
  const typeCounts = count(searched.map((x) => x.card.profile?.type));
  const sectorCounts = count(typed.flatMap((x) => x.card.sectors.map((s) => s.slug)));
  const sectorLabels = new Map(typed.flatMap((x) => x.card.sectors.map((s) => [s.slug, s.label] as const)));
  const byCount = <T extends { count: number }>(list: T[]) => list.filter((x) => x.count > 0);

  const limit = Math.min(Math.max(input.limit ?? 24, 1), 60);
  const offset = Math.max(input.offset ?? 0, 0);
  return {
    total: results.length,
    all_total: all.length,
    offset,
    limit,
    results: results.slice(offset, offset + limit).map((x) => x.card),
    facets: {
      types: byCount(ORG_TYPES.map((t) => ({ type: t, ...ORG_TYPE_INFO[t], count: typeCounts.get(t) ?? 0 }))),
      sectors: [...sectorCounts]
        .map(([slug, n]) => ({ slug, label: sectorLabels.get(slug) ?? slug, count: n }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      countries: [...count(typed.map((x) => x.card.profile?.country))]
        .map(([code, n]) => ({ code, count: n }))
        .sort((a, b) => b.count - a.count),
      goals: byCount(
        GOALS.map((g) => ({ goal: g, count: typed.filter((x) => x.card.partnership_types.includes(g)).length })),
      ),
      stages: [...count(typed.map((x) => x.card.profile?.stage))].map(([stage, n]) => ({ stage, count: n })),
      audiences: [...count(typed.flatMap((x) => x.card.profile?.audiences ?? []))].map(([audience, n]) => ({
        audience,
        count: n,
      })),
    },
  };
}
