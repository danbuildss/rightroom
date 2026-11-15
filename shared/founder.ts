/**
 * Founders: sign-in through Privy (X, Google or email), invite check, onboarding answers.
 * Rightroom stores only what's listed here; Privy holds the login itself.
 */
import { z } from "zod";

export const GOALS = ["integrations", "distribution", "co_marketing", "ecosystem"] as const;
export const MARKETS = ["nigeria", "uk", "us", "kenya", "ghana", "south_africa", "other"] as const;
export const ONBOARDING_STEPS = 4;

/** "@Name_1" → "name_1". X handles are 1–15 letters, digits or underscores. */
export const xHandleSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/^@/, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9_]{1,15}$/, "Enter an X handle like @yourname"));

export function normalizeXHandle(value: string | null | undefined): string | null {
  const parsed = xHandleSchema.safeParse(value ?? "");
  return parsed.success ? parsed.data : null;
}

const text = (max: number) => z.string().trim().max(max);

/** One onboarding step at a time, or later edits from settings. Every field is optional. */
export const profileUpdateSchema = z.strictObject({
  name: text(100).min(1).optional(),
  role: text(100).optional(),
  company_name: text(200).optional(),
  website: text(300)
    .transform((s) => (s === "" || /^https?:\/\//i.test(s) ? s : `https://${s}`))
    .pipe(
      z.union([
        z.literal(""),
        z.url({ protocol: /^https?$/, message: "Enter a website like https://yourcompany.com" }),
      ]),
    )
    .optional(),
  one_liner: text(300).optional(),
  buyers: text(300).optional(),
  goals: z.array(z.enum(GOALS)).max(GOALS.length).optional(),
  markets: z.array(z.enum(MARKETS)).max(MARKETS.length).optional(),
  /** The step the founder has reached (1–4); 5 means onboarding is finished. */
  step: z
    .number()
    .int()
    .min(1)
    .max(ONBOARDING_STEPS + 1)
    .optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Who someone is, from Privy's signed identity token. */
export interface PrivyIdentity {
  did: string;
  name: string | null;
  emails: string[];
  x_handle: string | null;
}

type LinkedAccount = Record<string, unknown> & { type?: string };

/** Pull emails, X handle and a display name out of Privy's linked accounts. Unknown shapes are ignored. */
export function identityFromLinkedAccounts(did: string, raw: unknown): PrivyIdentity {
  let accounts: LinkedAccount[] = [];
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(value)) accounts = value.filter((a): a is LinkedAccount => typeof a === "object" && a !== null);
  } catch {
    accounts = [];
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const emails = new Set<string>();
  let x: string | null = null;
  let name: string | null = null;
  for (const a of accounts) {
    if (a.type === "email") {
      const e = str(a.address);
      if (e) emails.add(e.toLowerCase());
    } else if (a.type === "google_oauth") {
      const e = str(a.email);
      if (e) emails.add(e.toLowerCase());
      name ??= str(a.name);
    } else if (a.type === "twitter_oauth") {
      x ??= normalizeXHandle(str(a.username));
      name ??= str(a.name);
    }
  }
  return { did, name, emails: [...emails], x_handle: x };
}
