/**
 * Pilot A: Grok signal search (official xAI API, x_search tool).
 *
 * Grok helps *find* partnership posts on X. It never verifies anything: results
 * land in the inbox, and a person checks each post before it becomes a signal.
 *
 * Guard against made-up results: a post is kept only if its link is an X post URL
 * AND appears in the citations xAI returned for the search.
 */
import { z } from "zod";
import { normalizeDomain } from "./candidate.ts";
import { type CollectedItem, excerpt, toIsoDate } from "./collector.ts";

export const grokConfigSchema = z.strictObject({
  /** What to look for, in plain words. */
  query: z.string().trim().min(5).max(300),
  /** Only search posts from these accounts (without @), if set. */
  allowed_x_handles: z
    .array(z.string().regex(/^[A-Za-z0-9_]{1,15}$/))
    .max(10)
    .optional(),
  /** How far back to search, in days. */
  lookback_days: z.number().int().min(1).max(30).default(2),
  /** At most this many posts per search. */
  max_posts: z.number().int().min(1).max(15).default(10),
  /** Company research: find this company's official X account and its recent partnership posts. */
  company: z
    .strictObject({ name: z.string().trim().min(1).max(200), domain: z.string().trim().min(3).max(253) })
    .optional(),
});
export type GrokConfig = z.infer<typeof grokConfigSchema>;

/** Prices used for Talo's own estimate. Set from env; defaults from xAI's public pricing page (Nov 2026). */
export interface GrokPrices {
  per_post_usd: number;
  input_per_million_usd: number;
  output_per_million_usd: number;
}
export const DEFAULT_GROK_PRICES: GrokPrices = {
  per_post_usd: 0.005,
  input_per_million_usd: 1.25,
  output_per_million_usd: 2.5,
};

const INSTRUCTIONS = `You find partnership signals for a curated database. Use X search only.
Find recent posts in which a company announces something that could create a partnership:
a partner or integration program, a request for partners or collaborators, a new integration,
a new API or SDK, a launch on a new chain or platform, or a partnerships role.
Ignore funding news, price talk, giveaways, memes and posts by people who are not speaking for the company.
Never invent posts, links, handles or websites. If unsure about a field, leave it null.
Reply with JSON only, no prose:
{"items":[{"post_url":"https://x.com/<handle>/status/<id>","author_handle":"<handle>","posted_at":"YYYY-MM-DD",
"post_text":"<exact text, max 400 chars>","company_name":"<name or null>","company_website":"<https URL or null>"}]}`;

const COMPANY_INSTRUCTIONS = `You research one company for a curated partnership database. Use X search only.
1) Find the company's official X account: the account that speaks for the company itself (not a founder, fan,
   reseller or parody). Give one of its own posts as evidence, from the search results.
2) List its own recent posts that could create a partnership: a partner or integration program, a request for
   partners or collaborators, a new integration, a new API or SDK, a launch on a new chain or platform,
   an ecosystem or grants program, or a partnerships role.
3) List up to 3 people who say in their own post that they work at the company in founding, partnerships,
   business development, developer relations or ecosystem roles. Give one of their own posts as evidence.
Ignore funding news, price talk, giveaways and memes. Never invent posts, links, names or handles. If unsure, use null.
Reply with JSON only, no prose:
{"official_handle":{"handle":"<handle without @>","evidence_post_url":"https://x.com/<handle>/status/<id>"} or null,
"people":[{"name":"<full name or null>","handle":"<handle>","role":"<role as they state it>","evidence_post_url":"https://x.com/<handle>/status/<id>"}],
"items":[{"post_url":"https://x.com/<handle>/status/<id>","author_handle":"<handle>","posted_at":"YYYY-MM-DD",
"post_text":"<exact text, max 400 chars>","company_name":"<name or null>","company_website":"<https URL or null>"}]}`;

export function buildGrokRequest(config: GrokConfig, model: string, now: Date) {
  const from = new Date(now.getTime() - config.lookback_days * 86_400_000).toISOString().slice(0, 10);
  const tool: Record<string, unknown> = { type: "x_search", from_date: from };
  if (config.allowed_x_handles?.length) tool.allowed_x_handles = config.allowed_x_handles;
  if (config.company) {
    return {
      model,
      instructions: COMPANY_INSTRUCTIONS,
      input: `Company: ${config.company.name} (website ${config.company.domain}). ${config.query}. Return at most ${config.max_posts} posts from ${from} onwards.`,
      tools: [tool],
      store: false,
    };
  }
  return {
    model,
    instructions: INSTRUCTIONS,
    input: `Search X for: ${config.query}. Return at most ${config.max_posts} posts from ${from} onwards.`,
    tools: [tool],
    // Never store the conversation on xAI's side.
    store: false,
  };
}

const X_STATUS = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/;

/** The canonical form of an X post link, or null if it isn't one. */
export function canonicalPostUrl(url: string): string | null {
  const m = url.trim().match(X_STATUS);
  return m ? `https://x.com/${m[1]?.toLowerCase()}/status/${m[2]}` : null;
}

const itemSchema = z.object({
  post_url: z.string(),
  author_handle: z.string().nullable().optional(),
  posted_at: z.string().nullable().optional(),
  post_text: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  company_website: z.string().nullable().optional(),
});

export interface GrokParseResult {
  items: CollectedItem[];
  /** Posts Grok listed but that weren't among its citations: dropped. */
  dropped: number;
  /** Company research: the official account, only when a cited post from that same account backs it. */
  handle: { handle: string; evidence_url: string } | null;
  /** Company research: people whose own cited post backs their role. */
  people: { name: string | null; handle: string; role: string; evidence_url: string }[];
  citations: number;
  input_tokens: number;
  output_tokens: number;
  /** For the run log: how many posts Grok listed, which were dropped and why, and the start of its answer. */
  debug: { listed: number; dropped: { url: string; reason: string }[]; answer_excerpt: string };
}

/** Any X post link, including x.com/i/status/<id> and x.com/i/web/status/<id> as xAI cites them. */
const ANY_STATUS =
  /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:i\/web|[A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/g;
const postId = (url: string) => url.match(/\/status(?:es)?\/(\d{5,25})/)?.[1] ?? null;

function collectStrings(value: unknown, into: string[]) {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, into);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, into);
}

/**
 * Read an xAI Responses API reply. The answer text must be JSON as instructed;
 * citations are gathered from anywhere in the reply (annotations, citations lists).
 * Throws if the reply has no readable answer, so the run is logged as failed.
 */
export function parseGrokResponse(json: unknown): GrokParseResult {
  const body = z
    .object({
      output: z.array(z.unknown()).optional(),
      output_text: z.string().optional(),
      citations: z.array(z.unknown()).optional(),
      usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).loose().optional(),
    })
    .loose()
    .parse(json);

  // The answer text: output[].content[] items of type output_text, or a top-level output_text.
  const texts: string[] = [];
  if (body.output_text) texts.push(body.output_text);
  for (const block of body.output ?? []) {
    const content = (block as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if ((c as { type?: string }).type === "output_text" && typeof (c as { text?: unknown }).text === "string") {
          texts.push((c as { text: string }).text);
        }
      }
    }
  }
  const answer = texts.join("\n");
  const jsonText = answer.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error("no JSON answer in the reply");
  const parsed = z
    .object({ items: z.array(z.unknown()), official_handle: z.unknown().optional(), people: z.unknown().optional() })
    .parse(JSON.parse(jsonText));

  // Every X post link anywhere in the reply outside the answer text counts as a citation.
  const strings: string[] = [];
  collectStrings(
    {
      ...body,
      output_text: undefined,
      output: (body.output ?? []).map((b) => ({ ...(b as object), content: undefined })),
    },
    strings,
  );
  for (const block of body.output ?? []) {
    const content = (block as { content?: unknown }).content;
    if (Array.isArray(content))
      for (const c of content) collectStrings((c as { annotations?: unknown }).annotations, strings);
  }
  // Cited posts by number: xAI often cites x.com/i/status/<id>, while Grok's answer names the account.
  // The author is known only when the citation names it.
  const citedAuthor = new Map<string, string | null>();
  for (const str of strings) {
    for (const m of str.matchAll(ANY_STATUS)) {
      const id = m[1] as string;
      const seg = m[0].split("/")[3]?.toLowerCase() ?? "";
      const author = seg === "i" ? null : seg;
      if (!citedAuthor.has(id) || (author && !citedAuthor.get(id))) citedAuthor.set(id, author);
    }
  }
  /** The post's author if it was cited (the citation's name wins over Grok's), or null if it wasn't cited. */
  const citedPost = (url: string): { id: string; author: string } | null => {
    const id = postId(url);
    if (!id || !citedAuthor.has(id)) return null;
    const claimed = url.split("/")[3]?.toLowerCase() ?? "";
    return { id, author: citedAuthor.get(id) ?? claimed };
  };

  const items: CollectedItem[] = [];
  const droppedList: { url: string; reason: string }[] = [];
  for (const raw of parsed.items) {
    const r = itemSchema.safeParse(raw);
    const given = r.success ? r.data.post_url : String((raw as { post_url?: unknown })?.post_url ?? "");
    const url = r.success ? canonicalPostUrl(r.data.post_url) : null;
    if (!r.success || !url) {
      droppedList.push({ url: given.slice(0, 200), reason: "not an X post link" });
      continue;
    }
    const cited = citedPost(url);
    if (!cited) {
      droppedList.push({ url, reason: "not among the posts xAI says it found" });
      continue;
    }
    const handle = cited.author;
    const canonical = handle && handle !== "i" ? `https://x.com/${handle}/status/${cited.id}` : url;
    const text = r.data.post_text?.trim() ?? "";
    const website = r.data.company_website ? normalizeDomain(r.data.company_website) : null;
    items.push({
      url: canonical,
      title: `@${handle}: ${text.slice(0, 120) || "post"}`.slice(0, 300),
      published_at: toIsoDate(r.data.posted_at),
      excerpt: excerpt(text),
      domain: website,
    });
  }
  const dropped = droppedList.length;
  /** Evidence for a handle: a cited post written by that same account. */
  const backs = (evidence: string, h: string) => {
    const ev = canonicalPostUrl(evidence);
    const cited = ev ? citedPost(ev) : null;
    return cited && cited.author === h ? `https://x.com/${h}/status/${cited.id}` : null;
  };
  let handle: GrokParseResult["handle"] = null;
  const oh = z.object({ handle: z.string(), evidence_post_url: z.string() }).safeParse(parsed.official_handle ?? null);
  if (oh.success) {
    const h = oh.data.handle.replace(/^@/, "").toLowerCase();
    const ev = /^[a-z0-9_]{1,15}$/.test(h) ? backs(oh.data.evidence_post_url, h) : null;
    if (ev) handle = { handle: h, evidence_url: ev };
  }
  const people: GrokParseResult["people"] = [];
  for (const raw of Array.isArray(parsed.people) ? parsed.people.slice(0, 3) : []) {
    const p = z
      .object({
        name: z.string().nullable().optional(),
        handle: z.string(),
        role: z.string(),
        evidence_post_url: z.string(),
      })
      .safeParse(raw);
    if (!p.success) continue;
    const h = p.data.handle.replace(/^@/, "").toLowerCase();
    const role = p.data.role.trim().slice(0, 120);
    const ev = /^[a-z0-9_]{1,15}$/.test(h) && role.length >= 2 ? backs(p.data.evidence_post_url, h) : null;
    if (!ev) continue;
    const name = p.data.name?.trim().slice(0, 120) || null;
    people.push({ name, handle: h, role, evidence_url: ev });
  }
  return {
    items,
    dropped,
    handle,
    people,
    citations: citedAuthor.size,
    debug: { listed: parsed.items.length, dropped: droppedList.slice(0, 20), answer_excerpt: answer.slice(0, 1500) },
    input_tokens: body.usage?.input_tokens ?? 0,
    output_tokens: body.usage?.output_tokens ?? 0,
  };
}

/**
 * Talo's estimate of one search's cost. Conservative: every cited post counts as
 * read. The xAI console's spending limit is the hard stop; this is the second one.
 */
export function estimateGrokCost(
  r: Pick<GrokParseResult, "citations" | "input_tokens" | "output_tokens">,
  p: GrokPrices,
): number {
  const cost =
    r.citations * p.per_post_usd +
    (r.input_tokens / 1_000_000) * p.input_per_million_usd +
    (r.output_tokens / 1_000_000) * p.output_per_million_usd;
  return Math.round(cost * 10_000) / 10_000;
}

/**
 * A cautious estimate before a search runs, shown in the back office. x_search may read more posts
 * than it returns, so it assumes three times max_posts were read, plus generous token counts.
 */
export function estimateSearchCost(config: Pick<GrokConfig, "max_posts">, p: GrokPrices): number {
  const read = config.max_posts * 3;
  return estimateGrokCost(
    { citations: read, input_tokens: 6_000 + read * 600, output_tokens: 1_500 + config.max_posts * 350 },
    p,
  );
}
