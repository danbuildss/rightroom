/** Saved companies and the founder's pipeline (step 7). Private per workspace. */
import { z } from "zod";

export const STAGES = ["shortlisted", "contacted", "in_discussion", "partnered"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  shortlisted: "Shortlisted",
  contacted: "Contacted",
  in_discussion: "In discussion",
  partnered: "Partnered",
};
/** "I sent it" suggests a follow-up this many days later (the founder can change or clear it). */
export const FOLLOW_UP_DAYS = 7;

export const pipelinePatchSchema = z
  .strictObject({
    stage: z.enum(STAGES).optional(),
    follow_up_at: z.union([z.iso.date({ message: "Use a date like 2026-11-20" }), z.null()]).optional(),
    notes: z.string().max(4000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
