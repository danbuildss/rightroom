/**
 * AI helpers (Bankr LLM gateway): prompts and answer checks. Pure functions, no network.
 * Only public website text goes in. The AI suggests; Dan approves. It never sets a fit score.
 */
import { z } from "zod";
import { ORG_TYPES } from "./profile.ts";

/** Visible text of a page, for the AI (scripts, styles and tags removed), at most `max` characters. */
export function pageText(html: string, max = 6000): string {
  return html
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, max);
}

export function candidatePrompt(input: { domain: string; found_title: string; text: string; categories: string[] }) {
  return {
    system: `You check whether a website belongs to a company or product team that could be a business partner, for a curated database.
Use only the page text given. Never invent facts. Reply with JSON only:
{"is_company": true|false, "reason": "<one short sentence>", "name": "<the company or product name as written on the page>",
"one_liner": "<what it does, max 160 characters, plain and factual, from the page>",
"org_type": one of ${JSON.stringify(ORG_TYPES)},
"sectors": up to 3 of ${JSON.stringify(input.categories)},
"stage": "early" | "growth" | "established" | "unknown",
"audiences": any of ["b2b","b2c","developers"]}
is_company is false for blogs, personal portfolios, single open-source libraries with no team or product, news articles,
lists or directories, documentation-only pages, and parked or broken pages.
stage is "early" for new launches, betas, waitlists or small new teams; "established" only for large, well-known companies.`,
    user: `Website: https://${input.domain}\nFound as: ${input.found_title}\n\nPage text:\n${input.text}`,
  };
}

export const candidateAnswer = z.object({
  is_company: z.boolean(),
  reason: z.string().max(300),
  name: z.string().trim().min(1).max(120).nullable().optional(),
  one_liner: z.string().trim().min(1).max(200).nullable().optional(),
  org_type: z.enum(ORG_TYPES).nullable().optional(),
  sectors: z.array(z.string()).max(5).optional().default([]),
  stage: z.enum(["early", "growth", "established", "unknown"]).optional().default("unknown"),
  audiences: z
    .array(z.enum(["b2b", "b2c", "developers"]))
    .max(3)
    .optional()
    .default([]),
});
export type CandidateAnswer = z.infer<typeof candidateAnswer>;

export function peoplePrompt(input: { company: string; domain: string; text: string }) {
  return {
    system: `You list the people who work AT a company and would be a sensible first contact about a partnership:
founders, CEO/CTO/COO, partnerships, business development, developer relations, ecosystem or alliances roles.
Use only the page text given. Copy each name exactly as written. Leave out investors, angels, advisors, board members,
mentors, customers, people quoted in testimonials, and people whose role is at another company.
Reply with JSON only: {"people":[{"name":"<exact name>","role":"<role as written>"}]} (empty list if none).`,
    user: `Company: ${input.company} (${input.domain})\n\nPage text:\n${input.text}`,
  };
}

export const peopleAnswer = z.object({
  people: z
    .array(z.object({ name: z.string().trim().min(3).max(120), role: z.string().trim().min(2).max(120) }))
    .max(10),
});

/** The JSON object in a model's answer (it may wrap it in a code block or a sentence). */
export function jsonFrom(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in the answer");
  return JSON.parse(m[0]);
}

/** Keep only people whose exact name appears in the page text (the model can't invent anyone). */
export function onPage<T extends { name: string }>(people: T[], text: string): T[] {
  const page = text.replace(/\s+/g, " ").toLowerCase();
  return people.filter((p) => page.includes(p.name.replace(/\s+/g, " ").toLowerCase()));
}
