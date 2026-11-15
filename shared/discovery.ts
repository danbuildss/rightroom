/**
 * Finding early-stage teams (data engine, part B). Pure helpers, no network:
 * reading Hacker News "Show HN" search results and GitHub repository search results,
 * telling a product's own website apart from hosting and social sites, reading a homepage's
 * name and description, and suggesting sectors and a type.
 *
 * Everything here only proposes a candidate. Dan approves candidates before they become companies.
 */
import { parseQuery } from "./discover.ts";
import type { OrgType } from "./profile.ts";

export interface FoundTeam {
  domain: string;
  name: string | null;
  found_via: "hn" | "github" | "inbox";
  found_url: string;
  found_title: string;
  found_at: string | null;
  hint: string | null;
}

/** Hosts that aren't a team's own website: code hosts, social sites, app hosting and blogs. */
const NOT_A_PRODUCT_SITE =
  /(^|\.)(github\.com|gitlab\.com|github\.io|x\.com|twitter\.com|youtube\.com|youtu\.be|medium\.com|substack\.com|linkedin\.com|reddit\.com|news\.ycombinator\.com|producthunt\.com|google\.com|apple\.com|notion\.site|vercel\.app|netlify\.app|pages\.dev|replit\.app|herokuapp\.com|fly\.dev|railway\.app|onrender\.com|huggingface\.co|npmjs\.com|pypi\.org|docs\.google\.com|discord\.gg|discord\.com|t\.me|bit\.ly|arxiv\.org|wikipedia\.org)$/;

export function productDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || NOT_A_PRODUCT_SITE.test(host)) return null;
    // Keep the registrable part for common subdomains (app., docs., get.) so one team is one domain.
    return host.replace(/^(app|docs|get|try|use|beta|www2)\./, "");
  } catch {
    return null;
  }
}

/** Words that say a post is about something our founders could partner with. */
const RELEVANT =
  /\b(api|sdk|agent|agents|llm|ai|mcp|developer|developers|devtool|payments?|stablecoin|wallet|onchain|on-chain|crypto|base|ethereum|solana|x402|infrastructure|platform|integration|integrations|open[- ]source|plugin|automation|database|inference)\b/i;

const showHnName = (title: string) =>
  title
    .replace(/^show hn:\s*/i, "")
    .split(/\s[–—-]\s|:\s|,\s/)[0]
    ?.trim()
    .slice(0, 80) || null;

/** Hacker News search (hn.algolia.com) "Show HN" hits that point at a product's own website. */
export function parseHnShow(json: unknown): FoundTeam[] {
  const hits = (json as { hits?: unknown[] })?.hits;
  if (!Array.isArray(hits)) return [];
  const out: FoundTeam[] = [];
  for (const h of hits as Record<string, unknown>[]) {
    const title = typeof h.title === "string" ? h.title : "";
    const url = typeof h.url === "string" ? h.url : null;
    const domain = productDomain(url);
    if (!domain || !RELEVANT.test(title)) continue;
    out.push({
      domain,
      name: showHnName(title),
      found_via: "hn",
      found_url: `https://news.ycombinator.com/item?id=${String(h.objectID ?? "")}`,
      found_title: title.slice(0, 300),
      found_at: typeof h.created_at === "string" ? h.created_at.slice(0, 10) : null,
      hint: title,
    });
  }
  return out;
}

/** GitHub repository search results whose repo lists a homepage on the team's own domain. */
export function parseGithubSearch(json: unknown): FoundTeam[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const out: FoundTeam[] = [];
  for (const r of items as Record<string, unknown>[]) {
    const domain = productDomain(typeof r.homepage === "string" ? r.homepage : null);
    const html = typeof r.html_url === "string" ? r.html_url : null;
    if (!domain || !html) continue;
    const owner = (r.owner as { login?: string; type?: string } | undefined) ?? {};
    const desc = typeof r.description === "string" ? r.description : "";
    out.push({
      domain,
      name: owner.type === "Organization" && owner.login ? owner.login : typeof r.name === "string" ? r.name : null,
      found_via: "github",
      found_url: html,
      found_title: `${String(r.full_name ?? "")}: ${desc}`.slice(0, 300),
      found_at: typeof r.created_at === "string" ? r.created_at.slice(0, 10) : null,
      hint: desc,
    });
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** A homepage's own name and one-line description, from its meta tags or title. */
export function readSiteMeta(html: string): { name: string | null; description: string | null } {
  const meta = (key: string) => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const k = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (k === key) {
        const v = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
        if (v?.trim()) return decode(v);
      }
    }
    return null;
  };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const fromTitle = title
    ? decode(title)
        .split(/\s[|–—-]\s|:\s/)[0]
        ?.trim() || null
    : null;
  const name = meta("og:site_name") ?? fromTitle;
  const description = meta("description") ?? meta("og:description");
  return {
    name: name ? name.slice(0, 120) : null,
    description: description ? description.slice(0, 400) : null,
  };
}

/** Sectors from our keyword list, and a type: platform/API, ecosystem or product. */
export function suggestProfile(text: string): { categories: string[]; type: OrgType } {
  const categories = parseQuery(text).categories.slice(0, 3);
  const t = text.toLowerCase();
  const type: OrgType = /\b(protocol|network|chain|l2|layer[- ]2|ecosystem|dao)\b/.test(t)
    ? "ecosystem"
    : /\b(api|apis|sdk|infrastructure|infra|platform|developers?|framework|database|open[- ]source|library|toolkit)\b/.test(
          t,
        )
      ? "platform_api"
      : "startup_product";
  return { categories, type };
}
