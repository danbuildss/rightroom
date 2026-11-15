/**
 * Contacts and official channels for a company (PLAN.md decision C).
 * - A named person needs a public source page that shows them in that role.
 * - A channel is an official route in (partner form, partnership page, docs).
 * - Never a guessed email. Founders see only verified rows.
 */
import { z } from "zod";

export const CONTACT_KINDS = ["person", "channel"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;

const httpUrl = z.url({ protocol: /^https?$/, message: "Use a full link starting with https://" }).max(500);
const text = (max: number) => z.string().trim().min(1).max(max);

export const contactInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("person"),
    name: text(120),
    role: text(120),
    source_url: httpUrl,
    confidence: z.enum(CONFIDENCE),
  }),
  z.strictObject({
    kind: z.literal("channel"),
    channel_label: text(120),
    url: httpUrl.refine((u) => !/^mailto:/i.test(u), "Links only, no email addresses"),
    source_url: httpUrl.optional(),
    confidence: z.enum(CONFIDENCE),
  }),
]);
export type ContactInput = z.infer<typeof contactInputSchema>;

export const contactReviewSchema = z
  .strictObject({ action: z.enum(["verify", "reject"]), reason: z.string().trim().max(500).optional() })
  .refine((r) => r.action !== "reject" || r.reason, { message: "Give a reason for rejecting.", path: ["reason"] });
