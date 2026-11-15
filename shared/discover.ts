/**
 * Discover: read a founder's search with simple rules (no AI), then score each verified company
 * with the fixed fit formula (PLAN.md §5, shared/scoring.ts weights). Same input, same output.
 *
 * Scores come only from data we hold: company categories, verified signals and their sources.
 * Where data is missing (named contacts, locations) the factor says so and stays modest.
 */
import type { Factor } from "./candidate.ts";
import type { GOALS } from "./founder.ts";
import { FACTOR_LABELS, WEIGHTS } from "./scoring.ts";
import { SIGNAL_TYPES, type SignalType } from "./signals.ts";

export type Goal = (typeof GOALS)[number];

/** Words and phrases that point to a category (slugs from the categories table). */
const CATEGORY_WORDS: Record<string, string[]> = {
  payments: [
    "payment",
    "payments",
    "fintech",
    "fintechs",
    "checkout",
    "remittance",
    "remittances",
    "stablecoin",
    "stablecoins",
    "banking",
    "card",
    "cards",
    "pay",
  ],
  "ai-agents": ["agent", "agents", "agentic", "ai agent", "ai agents"],
  "ai-dev-infra": ["ai infrastructure", "ai infra", "ai developer", "evals", "vector database", "ai tooling"],
  "llm-inference": ["inference", "llm", "llms", "model hosting", "gpu", "gpus"],
  wallets: ["wallet", "wallets", "custody"],
  "onchain-apps": ["onchain", "on-chain", "dapp", "dapps", "defi", "web3"],
  "dev-platforms": [
    "api",
    "apis",
    "developer platform",
    "developer platforms",
    "developer tools",
    "devtools",
    "dev tools",
  ],
  mcp: ["mcp", "model context protocol"],
  x402: ["x402"],
  sdk: ["sdk", "sdks", "library", "libraries"],
  base: ["base chain", "on base", "base ecosystem", "built on base"],
  ethereum: ["ethereum", "evm"],
  solana: ["solana"],
};

const GOAL_WORDS: Record<Goal, string[]> = {
  integrations: [
    "integrate",
    "integrates",
    "integration",
    "integrations",
    "plug in",
    "plugin",
    "embed",
    "connect with",
    "build into",
  ],
  distribution: [
    "reach",
    "distribution",
    "distribute",
    "customers",
    "resell",
    "resellers",
    "channel",
    "go-to-market",
    "go to market",
  ],
  co_marketing: [
    "co-marketing",
    "co marketing",
    "comarketing",
    "marketing",
    "content",
    "events",
    "webinar",
    "launch together",
  ],
  ecosystem: ["ecosystem", "grant", "grants", "accelerator", "marketplace", "marketplaces"],
};

/** Places are recognised so we can say honestly that location filtering isn't available yet. */
const PLACE_WORDS = [
  "africa",
  "nigeria",
  "kenya",
  "ghana",
  "south africa",
  "europe",
  "asia",
  "latam",
  "latin america",
  "united kingdom",
  "united states",
  "usa",
  "india",
  "middle east",
];
/** "US" and "UK" only count in capitals, so "help us reach" isn't read as a place. */
const PLACE_CAPS = ["US", "UK"];

const STOP = new Set(
  "a an and are as at be but by can could for from has have help in into is it its of on or our that the their them they this to was we were will with you your who what which more most some any company companies partner partners find looking want need us".split(
    " ",
  ),
);

function has(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
}

export interface ParsedQuery {
  categories: string[];
  goals: Goal[];
  places: string[];
  /** Meaningful words, used to match company descriptions. */
  terms: string[];
}

export function parseQuery(raw: string): ParsedQuery {
  const original = raw.slice(0, 500);
  const text = original.toLowerCase();
  const categories = Object.entries(CATEGORY_WORDS)
    .filter(([, words]) => words.some((w) => has(text, w)))
    .map(([slug]) => slug);
  const goals = (Object.entries(GOAL_WORDS) as [Goal, string[]][])
    .filter(([, words]) => words.some((w) => has(text, w)))
    .map(([goal]) => goal);
  const places = [
    ...PLACE_WORDS.filter((p) => has(text, p)),
    ...PLACE_CAPS.filter((p) => new RegExp(`(^|[^A-Za-z])${p}([^A-Za-z]|$)`).test(original)).map((p) =>
      p.toLowerCase(),
    ),
  ];
  const terms = [...new Set(text.match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])].filter((w) => !STOP.has(w)).slice(0, 20);
  // "south africa" also contains "africa": keep the longer one only.
  const uniquePlaces = places.filter((p) => !places.some((q) => q !== p && q.includes(p)));
  return { categories, goals, places: [...new Set(uniquePlaces)], terms };
}

/** Which kinds of signal suggest a company is open to each kind of partnership. */
const GOAL_SIGNALS: Record<Goal, SignalType[]> = {
  integrations: ["integration_announced", "api_or_sdk_released", "partner_program_launched"],
  distribution: ["partner_program_launched", "collaboration_request", "ecosystem_expansion"],
  co_marketing: ["product_launched", "collaboration_request", "partner_program_launched"],
  ecosystem: ["ecosystem_expansion", "partner_program_launched"],
};
export const GOAL_LABELS: Record<Goal, string> = {
  integrations: "Integrations",
  distribution: "Distribution",
  co_marketing: "Co-marketing",
  ecosystem: "Ecosystem",
};

export interface DiscoverCompany {
  name: string;
  description: string | null;
  categories: { slug: string; label: string; kind: string }[];
  signals: {
    signal_type: SignalType;
    event_date: string | null;
    last_verified_at: string;
    /** Within the signal type's freshness window. */
    fresh: boolean;
    source_kinds: string[];
    source_hosts: string[];
  }[];
  /** Website the company was verified against. */
  domain: string;
  /** Verified contacts Dan added (shared/contacts.ts). Optional: none means none verified. */
  contacts?: { people: { role: string; confidence: "high" | "medium" | "low" }[]; channels: number };
}

export interface DiscoverContext {
  /** Sectors/technologies the founder is looking for (from the search or chips). */
  target: string[];
  /** The founder's own sectors/technologies (read from their onboarding answers). */
  own: string[];
  goals: Goal[];
  terms: string[];
}

export type FitLabel = "strong" | "potential" | "needs_verification" | "below";
export type Evidence = "high" | "medium" | "low";

export interface FactorResult {
  factor: Factor;
  label: string;
  weight: number;
  score: number;
  reason: string;
}

export interface CompanyFit {
  overall: number;
  label: FitLabel;
  evidence: Evidence;
  factors: FactorResult[];
  why: string;
}

const clamp = (n: number) => Math.max(0, Math.min(5, n));
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const day = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";

export const STRONG_FIT = 75;
export const POTENTIAL_FIT = 55;

export function scoreCompany(c: DiscoverCompany, ctx: DiscoverContext, now = new Date()): CompanyFit {
  const slugs = new Set(c.categories.map((x) => x.slug));
  const labelOf = (slug: string) => c.categories.find((x) => x.slug === slug)?.label ?? slug;
  const desc = (c.description ?? "").toLowerCase();

  // 1. Product and audience alignment
  const targetHits = ctx.target.filter((s) => slugs.has(s));
  const ownHits = ctx.own.filter((s) => slugs.has(s) && !targetHits.includes(s));
  const termHits = ctx.terms.filter((t) => t.length > 3 && desc.includes(t));
  let alignment =
    1 +
    (targetHits.length >= 1 ? 2 : 0) +
    (targetHits.length >= 2 ? 1 : 0) +
    (termHits.length || ownHits.length ? 1 : 0);
  if (ctx.target.length === 0 && ownHits.length) alignment = 2 + Math.min(2, ownHits.length);
  alignment = clamp(alignment);
  const alignmentReason = targetHits.length
    ? `Matches ${list(targetHits.map(labelOf))}${termHits.length ? `; their description mentions ${list(termHits.slice(0, 2))}` : ""}.`
    : ownHits.length
      ? `Works in ${list(ownHits.map(labelOf))}, like you.`
      : termHits.length
        ? `Their description mentions ${list(termHits.slice(0, 2))}.`
        : "No shared sector found in our data.";

  // 3. Partnership readiness (computed before mutual value, which uses the same signals)
  const signals = [...c.signals].sort((a, b) =>
    (b.event_date ?? b.last_verified_at).localeCompare(a.event_date ?? a.last_verified_at),
  );
  const explicitFresh = signals.find((s) => SIGNAL_TYPES[s.signal_type].intent === "explicit" && s.fresh);
  const explicitAny = signals.find((s) => SIGNAL_TYPES[s.signal_type].intent === "explicit");
  const impliedFresh = signals.find((s) => SIGNAL_TYPES[s.signal_type].intent === "implied" && s.fresh);
  const weakAny = signals.find((s) => SIGNAL_TYPES[s.signal_type].intent === "weak");
  const top = explicitFresh ?? impliedFresh ?? explicitAny ?? weakAny ?? signals[0];
  const readiness = explicitFresh ? 5 : impliedFresh ? 3 : explicitAny ? 3 : weakAny ? 2 : signals.length ? 2 : 1;
  const readinessReason = top
    ? `${SIGNAL_TYPES[top.signal_type].label}${top.event_date ? ` ${day(top.event_date)}` : ""} (verified${top.fresh ? "" : ", older"}).`
    : "No verified signal yet.";

  // 2. Mutual commercial value: does what they're doing match what you want?
  const goalHits = ctx.goals.filter((g) => signals.some((s) => s.fresh && GOAL_SIGNALS[g].includes(s.signal_type)));
  const mutual = clamp(
    (targetHits.length || ownHits.length ? 2 : 1) + (goalHits.length ? 2 : 0) + (goalHits.length >= 2 ? 1 : 0),
  );
  const goalSignal = goalHits.length
    ? signals.find((s) => s.fresh && GOAL_SIGNALS[goalHits[0] as Goal].includes(s.signal_type))
    : undefined;
  const mutualReason =
    goalHits.length && goalSignal
      ? `You want ${list(goalHits.map((g) => GOAL_LABELS[g].toLowerCase()))}; they recently had: ${SIGNAL_TYPES[goalSignal.signal_type].label.toLowerCase()}.`
      : ctx.goals.length
        ? `No recent verified signal matches ${list(ctx.goals.map((g) => GOAL_LABELS[g].toLowerCase()))} yet.`
        : "Add partnership goals to judge this.";

  // 4. Contact accessibility: verified named people and official channels Dan approved.
  const people = c.contacts?.people ?? [];
  const channels = c.contacts?.channels ?? 0;
  const partnerPage = signals.some((s) => s.source_kinds.includes("partner_page"));
  const strongPerson = people.find((p) => p.confidence === "high");
  const contact = strongPerson ? 5 : people.length ? 4 : channels || partnerPage ? 3 : 2;
  const contactReason = strongPerson
    ? `Verified named contact (${strongPerson.role}) with a public source.`
    : people[0]
      ? `Named contact (${people[0].role}) from a public source; confidence ${people[0].confidence}.`
      : channels
        ? "Official channel verified; no named contact yet."
        : partnerPage
          ? "Public partner page; no named contact yet."
          : "Official website only; no named contact yet.";

  // 5. Execution feasibility: shared technology or ecosystem.
  const techSlugs = c.categories.filter((x) => x.kind !== "sector").map((x) => x.slug);
  const shared = techSlugs.filter((s) => ctx.target.includes(s) || ctx.own.includes(s));
  const feasibility = shared.length ? 4 : 2;
  const feasibilityReason = shared.length
    ? `Both work with ${list(shared.map(labelOf))}.`
    : "No shared technology or ecosystem found yet.";

  const factors: FactorResult[] = (
    [
      ["alignment", alignment, alignmentReason],
      ["mutual_value", mutual, mutualReason],
      ["readiness", readiness, readinessReason],
      ["contact_access", contact, contactReason],
      ["feasibility", feasibility, feasibilityReason],
    ] as [Factor, number, string][]
  ).map(([factor, score, reason]) => ({
    factor,
    label: FACTOR_LABELS[factor],
    weight: WEIGHTS[factor],
    score,
    reason,
  }));
  const overall = Math.round(factors.reduce((sum, f) => sum + f.score * f.weight, 0) / 5);

  // Evidence confidence, adapted from PLAN.md §5 to the data we hold.
  const ageDays = (iso: string) => (now.getTime() - Date.parse(iso)) / 86_400_000;
  const recent = signals.filter((s) => ageDays(s.last_verified_at) <= 90);
  const hosts = new Set([c.domain, ...signals.flatMap((s) => s.source_hosts)]);
  const evidence: Evidence =
    signals.length === 0
      ? "low"
      : recent.length >= 1 && hosts.size >= 2 && recent.some((s) => s.fresh)
        ? "high"
        : "medium";

  const label: FitLabel =
    evidence === "low"
      ? alignment >= 3
        ? "needs_verification"
        : "below"
      : overall >= STRONG_FIT
        ? "strong"
        : overall >= POTENTIAL_FIT
          ? "potential"
          : "below";

  const why = [alignmentReason, top ? readinessReason : null]
    .filter(Boolean)
    .map((s) => (s as string).replace(/\.$/, ""))
    .join(" · ");
  return { overall, label, evidence, factors, why };
}

export const LABEL_RANK: Record<FitLabel, number> = { strong: 0, potential: 1, needs_verification: 2, below: 3 };
