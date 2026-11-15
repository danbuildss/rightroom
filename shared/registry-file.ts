/**
 * talo.registry.v1: a file of companies and signals to add to the shared registry,
 * prepared with Claude's research skills or by hand. Everything in it starts as
 * needs_review; nothing in a file can mark itself verified.
 */
import { z } from "zod";
import { profileFields } from "./profile.ts";
import { companyInputSchema } from "./registry.ts";
import { signalInputSchema } from "./signals.ts";

export const registryFileSchema = z
  .strictObject({
    format: z.literal("talo.registry.v1", { error: 'format must be "talo.registry.v1"' }),
    companies: z.array(companyInputSchema).max(500).default([]),
    signals: z.array(signalInputSchema).max(500).default([]),
  })
  .refine((f) => f.companies.length + f.signals.length > 0, { error: "the file has no companies or signals" });
export type RegistryFile = z.infer<typeof registryFileSchema>;

/**
 * Editable company fields. Changing name, domain or description of a verified company reopens it for review.
 * Profile fields (org_type, hq_country, stage, audiences) are Rightroom's labels: saving any of them, or
 * confirm_profile, marks the profile as confirmed by the editor without reopening review.
 */
export const companyPatchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(1000).nullable().optional(),
    categories: z
      .array(z.string().regex(/^[a-z0-9-]+$/))
      .max(10)
      .optional(),
    org_type: profileFields.org_type.optional(),
    hq_country: profileFields.hq_country.optional(),
    stage: profileFields.stage.optional(),
    audiences: profileFields.audiences.optional(),
    confirm_profile: z.literal(true).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { error: "nothing to change" });
export type CompanyPatch = z.infer<typeof companyPatchSchema>;

/** Editable signal fields. Changing what a verified signal claims reopens it for review. */
export const signalPatchSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    factual_claim: z.string().trim().min(1).max(1000).optional(),
    source_excerpt: z.string().trim().min(1).max(2000).optional(),
    opportunity_note: z.string().trim().min(1).max(1000).nullable().optional(),
    event_date: z.iso.date().nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { error: "nothing to change" });
export type SignalPatch = z.infer<typeof signalPatchSchema>;
