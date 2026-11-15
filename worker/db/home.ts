/**
 * Home and the bell: built only from the founder's own pipeline and from verified records.
 * Nothing here is invented to fill space; an empty section stays empty and says so in the app.
 */
import { LABEL_RANK } from "../../shared/discover.ts";
import { SIGNAL_TYPES } from "../../shared/signals.ts";
import { load } from "./discover.ts";
import { listPipeline } from "./pipeline.ts";

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

type Loaded = Awaited<ReturnType<typeof load>>;

/** When a signal happened: its event date, or the day it was found when it has none. */
const happened = (s: { event_date: string | null; discovered_at: string }) =>
  s.event_date ?? s.discovered_at.slice(0, 10);

function recentSignals(data: Loaded, since: string) {
  return data.scored
    .flatMap((r) =>
      r.signals
        .filter((s) => happened(s) >= since)
        .map((s) => ({
          slug: r.co.slug,
          company: r.co.name,
          saved: data.saved.has(r.co.id),
          type_label: SIGNAL_TYPES[s.signal_type].label,
          claim: s.factual_claim,
          date: happened(s),
          last_verified_at: s.last_verified_at,
          source: s.sources.find((x) => x.role === "primary")?.url ?? null,
        })),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.company.localeCompare(b.company));
}

function dueItems(items: Awaited<ReturnType<typeof listPipeline>>, today: string) {
  return items
    .filter((i) => i.follow_up_at && i.follow_up_at <= today && i.stage !== "partnered")
    .sort((a, b) => (a.follow_up_at ?? "").localeCompare(b.follow_up_at ?? ""))
    .map((i) => ({
      id: i.id,
      slug: i.slug,
      name: i.name,
      stage: i.stage,
      follow_up_at: i.follow_up_at as string,
      days_late: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${i.follow_up_at}T00:00:00Z`)) / DAY),
      last_sent_at: i.last_sent_at,
      last_sent_via: i.last_sent_via,
    }));
}

export async function home(db: D1Database, workspaceId: string, now = new Date()) {
  const today = isoDay(now);
  const weekAgo = isoDay(new Date(now.getTime() - 7 * DAY));
  const [data, items] = await Promise.all([load(db, workspaceId, { q: "" }), listPipeline(db, workspaceId)]);
  const due = dueItems(items, today);
  const signals = recentSignals(data, weekAgo);
  const matches = data.scored
    .filter((r) => r.fit.label === "strong" || r.fit.label === "potential")
    .sort((a, b) => LABEL_RANK[a.fit.label] - LABEL_RANK[b.fit.label] || b.fit.overall - a.fit.overall)
    .slice(0, 3)
    .map((r) => ({
      slug: r.co.slug,
      name: r.co.name,
      fit: { label: r.fit.label, overall: r.fit.overall },
      why: r.fit.factors[0]?.reason ?? "",
      latest: r.signals[0]
        ? { type_label: SIGNAL_TYPES[r.signals[0].signal_type].label, date: happened(r.signals[0]) }
        : null,
      saved: data.saved.has(r.co.id),
    }));
  const added = [...data.scored]
    .sort((a, b) => b.co.first_seen_at.localeCompare(a.co.first_seen_at))
    .slice(0, 4)
    .map((r) => ({
      slug: r.co.slug,
      name: r.co.name,
      type: r.co.profile_status === "confirmed" ? r.co.org_type : null,
      sectors: r.categories.filter((c) => c.kind === "sector").map((c) => c.label),
      added_at: r.co.first_seen_at,
      saved: data.saved.get(r.co.id) ?? null,
    }));
  return {
    today,
    counts: { due: due.length, saved: items.length, signals_this_week: signals.length },
    due,
    matches,
    signals: signals.slice(0, 6),
    added,
  };
}

/** The bell: follow-ups due, and verified signals from the last 14 days on companies the founder saved. */
export async function updates(db: D1Database, workspaceId: string, now = new Date()) {
  const today = isoDay(now);
  const since = isoDay(new Date(now.getTime() - 14 * DAY));
  const [data, items] = await Promise.all([load(db, workspaceId, { q: "" }), listPipeline(db, workspaceId)]);
  const due = dueItems(items, today).map((d) => ({
    kind: "follow_up" as const,
    slug: d.slug,
    name: d.name,
    date: d.follow_up_at,
    days_late: d.days_late,
    last_sent_at: d.last_sent_at,
  }));
  const signals = recentSignals(data, since)
    .filter((s) => s.saved)
    .map((s) => ({ kind: "signal" as const, slug: s.slug, name: s.company, date: s.date, type_label: s.type_label }));
  return { items: [...due, ...signals].slice(0, 12), count: due.length + signals.length };
}
