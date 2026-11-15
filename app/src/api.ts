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
