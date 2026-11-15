// Calls to Rightroom's founder API. The session lives in an HttpOnly cookie the browser sends itself.
export interface Founder {
  id: string;
  name: string | null;
  email: string | null;
  x_handle: string | null;
  role: string | null;
  onboarding_step: number;
  onboarded_at: string | null;
}
export interface Profile {
  company_name: string | null;
  website: string | null;
  one_liner: string | null;
  buyers: string | null;
  goals: string[];
  markets: string[];
}
export interface View {
  founder: Founder;
  profile: Profile;
}
export interface Identity {
  name: string | null;
  email: string | null;
  x_handle: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/app${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? "Something went wrong. Please try again.");
  return data as T;
}

export const api = {
  me: () => call<View>("GET", "/me"),
  session: (identity_token: string) =>
    call<({ status: "active" } & View) | { status: "not_invited"; identity: Identity }>("POST", "/session", {
      identity_token,
    }),
  requestAccess: (identity_token: string, goal: string, website: string) =>
    call<{ ok: true }>("POST", "/request-access", { identity_token, goal, website }),
  saveProfile: (update: Record<string, unknown>) => call<View>("PUT", "/profile", update),
  signOut: () => call<{ ok: true }>("POST", "/signout", {}),
  deleteAccount: () => call<{ ok: true }>("DELETE", "/account"),
};

export interface FactorView {
  factor: string;
  label: string;
  weight: number;
  score: number;
  reason: string;
}
export interface SignalView {
  type: string;
  type_label: string;
  title: string;
  claim: string;
  excerpt: string;
  event_date: string | null;
  last_verified_at: string;
  status: "verified" | "stale";
  sources: { url: string; title: string; role: string }[];
}
export interface DiscoverResult {
  saved: { id: string; stage: string } | null;
  slug: string;
  name: string;
  domain: string;
  description: string | null;
  categories: { slug: string; label: string; kind: string }[];
  fit: {
    overall: number | null;
    label: "strong" | "potential" | "needs_verification";
    evidence: "high" | "medium" | "low";
    why: string;
    factors: FactorView[];
  };
  signals: SignalView[];
}
export interface DiscoverResponse {
  understood: { categories: { slug: string; label: string }[]; goals: string[]; places: string[] };
  verified_total: number;
  results: DiscoverResult[];
  categories: { slug: string; label: string; kind: string }[];
}

export function discover(params: { q: string; cats?: string[]; goals?: string[]; category?: string }) {
  const search = new URLSearchParams({ q: params.q });
  if (params.cats) search.set("cats", params.cats.join(","));
  if (params.goals) search.set("goals", params.goals.join(","));
  if (params.category) search.set("category", params.category);
  return call<DiscoverResponse>("GET", `/discover?${search}`);
}

export interface CompanyIntel {
  company: DiscoverResult & { last_verified_at: string | null };
  people: {
    name: string;
    role: string;
    source_url: string;
    confidence: "high" | "medium" | "low";
    last_checked_at: string | null;
  }[];
  channels: { label: string; url: string; source_url: string; last_checked_at: string | null }[];
  suggestions: {
    for_you: string;
    for_them: string;
    suggested_role: string;
    approach: string;
    approach_why: string;
    based_on: string;
  };
  goals: string[];
}

export function companyIntel(slug: string) {
  return call<CompanyIntel>("GET", `/companies/${encodeURIComponent(slug)}`);
}

export type Variant = "first" | "shorter" | "follow_up";
export interface GeneratedDraft {
  subject: string;
  message: string;
  variant: Variant;
  recipient: string;
  channel: { label: string; url: string };
  options: { people: { index: number; label: string }[]; channels: { index: number; label: string; url: string }[] };
  sources: { kind: "verified" | "yours"; text: string; url: string | null }[];
}
export interface SavedDraft {
  id: string;
  variant: Variant;
  recipient: string;
  channel_label: string | null;
  channel_url: string | null;
  subject: string | null;
  message: string;
  status: "draft" | "sent";
  sent_at: string | null;
  created_at: string;
}

export const drafts = {
  generate: (slug: string, p: { variant: Variant; to?: number | "team"; via?: number }) => {
    const q = new URLSearchParams({ variant: p.variant });
    if (p.to !== undefined) q.set("to", String(p.to));
    if (p.via !== undefined) q.set("via", String(p.via));
    return call<GeneratedDraft>("GET", `/companies/${encodeURIComponent(slug)}/draft?${q}`);
  },
  list: (slug: string) => call<{ drafts: SavedDraft[] }>("GET", `/companies/${encodeURIComponent(slug)}/drafts`),
  save: (slug: string, d: Record<string, unknown>) =>
    call<{ draft: SavedDraft }>("POST", `/companies/${encodeURIComponent(slug)}/drafts`, d),
  update: (id: string, d: Record<string, unknown>) =>
    call<{ draft: SavedDraft }>("PATCH", `/drafts/${encodeURIComponent(id)}`, d),
  remove: (id: string) => call<{ ok: true }>("DELETE", `/drafts/${encodeURIComponent(id)}`),
};

export type Stage = "shortlisted" | "contacted" | "in_discussion" | "partnered";
export interface PipelineItem {
  id: string;
  stage: Stage;
  follow_up_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  slug: string;
  name: string;
  domain: string;
  company_status: string;
  sectors: string | null;
  last_sent_at: string | null;
  last_sent_via: string | null;
  drafts: number;
}

export const pipeline = {
  list: () => call<{ items: PipelineItem[]; due: number; today: string }>("GET", "/pipeline"),
  save: (slug: string) =>
    call<{ saved: { id: string; stage: Stage } }>("POST", `/companies/${encodeURIComponent(slug)}/save`, {}),
  update: (id: string, d: { stage?: Stage; follow_up_at?: string | null; notes?: string }) =>
    call<{ saved: { id: string; stage: Stage } }>("PATCH", `/pipeline/${encodeURIComponent(id)}`, d),
  remove: (id: string) => call<{ ok: true }>("DELETE", `/pipeline/${encodeURIComponent(id)}`),
  timeline: (id: string) =>
    call<{ events: { at: string; text: string }[] }>("GET", `/pipeline/${encodeURIComponent(id)}/timeline`),
};
