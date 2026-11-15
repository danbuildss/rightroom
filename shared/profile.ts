/**
 * Company profile: how a company is classified for Explore (type, location, stage, audience).
 * These are Rightroom's own labels, set or confirmed by Dan in the back office, not verified claims,
 * so changing them never reopens a company for review. Suggestions (from an import or the
 * pre-filled list) stay hidden from founders until Dan confirms them.
 */
import { z } from "zod";

export const ORG_TYPES = [
  "startup_product",
  "platform_api",
  "ecosystem",
  "distribution",
  "community_media",
  "accelerator_program",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** The Explore category tiles, in display order. */
export const ORG_TYPE_INFO: Record<OrgType, { label: string; blurb: string }> = {
  startup_product: {
    label: "Startups & Products",
    blurb: "Companies building products that could complement yours.",
  },
  platform_api: {
    label: "Platforms & APIs",
    blurb: "Platforms and developer tools other products build on and integrate with.",
  },
  ecosystem: {
    label: "Ecosystems",
    blurb: "Networks, protocols and open-source projects with their own builders, plugins or programs.",
  },
  distribution: {
    label: "Distribution",
    blurb: "Marketplaces, app stores and channels that put products in front of customers.",
  },
  community_media: {
    label: "Communities & Media",
    blurb: "Communities, newsletters, podcasts and events that reach your audience.",
  },
  accelerator_program: {
    label: "Accelerators & Programs",
    blurb: "Accelerators, grant programs and partner programs you can apply to.",
  },
};

export const STAGES = ["early", "growth", "established"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  early: "Early stage",
  growth: "Growth",
  established: "Established",
};

export const AUDIENCES = ["b2b", "b2c", "developers"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABELS: Record<Audience, string> = { b2b: "B2B", b2c: "Consumers", developers: "Developers" };

export const PROFILE_STATUSES = ["empty", "suggested", "confirmed"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/** Headquarters country as an ISO 3166-1 alpha-2 code, e.g. US, NG, GB. */
export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: "use a two-letter country code, e.g. US, NG, GB" });

export const profileFields = {
  org_type: z.enum(ORG_TYPES, { error: `org_type must be one of: ${ORG_TYPES.join(", ")}` }).nullable(),
  hq_country: countrySchema.nullable(),
  stage: z.enum(STAGES, { error: `stage must be one of: ${STAGES.join(", ")}` }).nullable(),
  audiences: z
    .array(z.enum(AUDIENCES, { error: `audiences must be from: ${AUDIENCES.join(", ")}` }))
    .max(3)
    .transform((a) => [...new Set(a)]),
};

export interface CompanyProfile {
  org_type: OrgType | null;
  hq_country: string | null;
  stage: Stage | null;
  audiences: Audience[];
  profile_status: ProfileStatus;
}

export function parseAudiences(json: string | null | undefined): Audience[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is Audience => (AUDIENCES as readonly string[]).includes(x)) : [];
  } catch {
    return [];
  }
}
