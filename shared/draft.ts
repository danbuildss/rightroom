/**
 * Draft introductions, written from templates (no AI). They use only verified facts (the
 * company's latest verified signal, a verified named contact) and the founder's own answers.
 * The one sentence about fit is left in [brackets] for the founder to write: we can't verify it.
 * Rightroom never sends anything.
 */
import { z } from "zod";
import type { Goal } from "./discover.ts";
import type { SignalType } from "./signals.ts";

export const VARIANTS = ["first", "shorter", "follow_up"] as const;
export type Variant = (typeof VARIANTS)[number];
export const MAX_MESSAGE: Record<Variant, number> = { first: 1200, shorter: 600, follow_up: 800 };
export const PLACEHOLDER = /\[[^\]]+\]/;

export interface DraftInput {
  variant: Variant;
  goal: Goal;
  founder: {
    name: string | null;
    role: string | null;
    company_name: string | null;
    one_liner: string | null;
    website: string | null;
  };
  company: { name: string };
  /** A verified person's name, or null to address the team. */
  recipientName: string | null;
  signal: { type: SignalType; event_date: string | null } | null;
}

const SIGNAL_PHRASE: Record<SignalType, string> = {
  partner_program_launched: "opened its partner program",
  collaboration_request: "is looking for collaborators",
  partnerships_role_posted: "is hiring for partnerships",
  integration_announced: "announced a new integration",
  api_or_sdk_released: "released a new API",
  product_launched: "launched something new",
  ecosystem_expansion: "is growing its ecosystem",
};

const SUBJECT: Record<Goal, (fc: string, co: string) => string> = {
  integrations: (fc, co) => `Integration idea: ${fc} × ${co}`,
  distribution: (fc, co) => `Partnership idea: ${fc} × ${co}`,
  co_marketing: (fc, co) => `Co-marketing idea: ${fc} × ${co}`,
  ecosystem: (fc, co) => `${fc} and the ${co} ecosystem`,
};

const ASK: Record<Goal, string> = {
  integrations: "Would you be open to a 20-minute call next week to see if an integration makes sense?",
  distribution: "Would you be open to a 20-minute call next week to explore reaching your customers together?",
  co_marketing: "Would you be open to a 20-minute call next week about a joint launch or piece of content?",
  ecosystem: "Would you be open to a 20-minute call next week about how we could join your ecosystem?",
};

const GOAL_NOUN: Record<Goal, string> = {
  integrations: "an integration",
  distribution: "a distribution partnership",
  co_marketing: "a joint launch",
  ecosystem: "joining your ecosystem",
};

const day = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : "";
const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};
const host = (url: string | null) => (url ? url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "");

export function buildDraft(input: DraftInput): { subject: string; message: string } {
  const fc = input.founder.company_name?.trim() || "our company";
  const co = input.company.name;
  const first = input.founder.name?.trim().split(/\s+/)[0] || "[Your name]";
  const hello = `Hi ${input.recipientName?.trim().split(/\s+/)[0] ?? `${co} team`},`;
  const signalLine = input.signal
    ? `I saw ${co} ${SIGNAL_PHRASE[input.signal.type]}${input.signal.event_date ? ` on ${day(input.signal.event_date)}` : ""}.`
    : `I've been looking at what ${co} is building.`;
  const who = `I'm ${first}${input.founder.role ? `, ${input.founder.role} of ${fc}` : ` from ${fc}`}.`;
  const what = input.founder.one_liner ? ` ${sentence(input.founder.one_liner)}` : " [One line on what you build.]";
  const signOff = `Best,\n${first}${input.founder.website ? `\n${host(input.founder.website)}` : ""}`;
  const fit = "[In one line, what their customers or team would get from working with you.]";

  if (input.variant === "shorter") {
    return {
      subject: SUBJECT[input.goal](fc, co),
      message: `${hello}\n\n${signalLine} ${who}${what}\n\nOpen to a quick call about ${GOAL_NOUN[input.goal]}?\n\n${signOff}`,
    };
  }
  if (input.variant === "follow_up") {
    return {
      subject: `Re: ${SUBJECT[input.goal](fc, co)}`,
      message: `${hello}\n\nFollowing up on my note about ${GOAL_NOUN[input.goal]} between ${fc} and ${co}. [Add one new, useful detail since your last message.]\n\nHappy to send a short overview instead if that's easier.\n\n${signOff}`,
    };
  }
  return {
    subject: SUBJECT[input.goal](fc, co),
    message: `${hello}\n\n${signalLine} ${who}${what}\n\n${fit}\n\n${ASK[input.goal]}\n\n${signOff}`,
  };
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const draftSaveSchema = z.strictObject({
  variant: z.enum(VARIANTS),
  recipient: z.string().trim().min(1).max(200),
  channel_label: optionalText(120),
  channel_url: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .optional(),
  subject: optionalText(200),
  message: z.string().trim().min(1).max(MAX_MESSAGE.first),
});

export const draftPatchSchema = z
  .strictObject({
    subject: optionalText(200),
    message: z.string().trim().min(1).max(MAX_MESSAGE.first).optional(),
    status: z.enum(["draft", "sent"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change." });
