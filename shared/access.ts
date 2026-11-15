/**
 * The marketing site's Request access form. Founders ask to join the invite-only pilot;
 * Dan reviews each request and sends any invitation. Nothing is sent automatically.
 */
import { z } from "zod";

export const ACCESS_STATUSES = ["new", "invited", "declined"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

/** Accepts "acme.com" as well as "https://acme.com"; only http(s) links are kept. */
const website = z
  .string()
  .trim()
  .max(300)
  .transform((s) => (s === "" ? undefined : /^https?:\/\//i.test(s) ? s : `https://${s}`))
  .pipe(z.url({ protocol: /^https?$/, message: "Enter a website like https://yourcompany.com" }).optional());

export const accessRequestSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .pipe(z.email({ message: "Enter a valid email address." })),
  website: website.optional(),
  goal: z
    .string()
    .trim()
    .min(10, "Tell us a little more about the partnership you're after.")
    .max(1000, "Keep it under 1,000 characters."),
  /** Honeypot: hidden from people; bots tend to fill it in. */
  company_fax: z.string().max(200).optional(),
});
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;

export const accessReviewSchema = z.object({
  status: z.enum(ACCESS_STATUSES),
  note: z.string().trim().max(1000).optional(),
});
