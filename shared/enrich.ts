/**
 * Reading a company's own homepage for its public links: X, GitHub, LinkedIn company page, docs,
 * partner page, and a published partnerships or contact email or form. Pure functions, no network.
 *
 * Only what the company itself links to is taken. Nothing is guessed: no email is made up,
 * and a link appears only if it is on the page.
 */

export interface SiteFindings {
  x: string | null;
  github: string | null;
  linkedin: string | null;
  docs: string | null;
  partners: string | null;
  email: string | null;
  contact_form: string | null;
}

const X_RESERVED = new Set([
  "share",
  "intent",
  "home",
  "i",
  "search",
  "hashtag",
  "explore",
  "settings",
  "login",
  "signup",
  "tos",
  "privacy",
]);
const GH_RESERVED = new Set([
  "sponsors",
  "features",
  "about",
  "orgs",
  "topics",
  "marketplace",
  "login",
  "pricing",
  "enterprise",
  "site",
]);

const sameSite = (host: string, domain: string) => {
  const h = host.replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
};

/** Count the most-linked value, so a footer link to the company's own account wins over a one-off mention. */
function top(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function readHomepage(html: string, base: string, domain: string): SiteFindings {
  const xs: string[] = [];
  const ghs: string[] = [];
  const lis: string[] = [];
  const docs: string[] = [];
  const partners: string[] = [];
  const emails: string[] = [];
  const forms: string[] = [];

  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1] ?? "";
    const text = (m[2] ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (!href) continue;

    if (/^mailto:/i.test(href)) {
      const addr = href.slice(7).split("?")[0]?.trim().toLowerCase() ?? "";
      const at = addr.split("@");
      if (
        at.length === 2 &&
        at[1] &&
        sameSite(at[1], domain) &&
        /^(partner|partners|partnerships|bd|bizdev|business|biz|alliances|integrations)\b/.test(at[0] ?? "")
      )
        emails.push(addr);
      continue;
    }
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const seg = u.pathname.split("/").filter(Boolean);

    if (host === "x.com" || host === "twitter.com") {
      const h = seg[0]?.toLowerCase();
      if (h && seg.length === 1 && /^[a-z0-9_]{1,15}$/.test(h) && !X_RESERVED.has(h)) xs.push(h);
    } else if (host === "github.com") {
      const o = seg[0]?.toLowerCase();
      if (o && /^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(o) && !GH_RESERVED.has(o)) ghs.push(o);
    } else if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
      if (seg[0] === "company" && seg[1]) lis.push(`https://www.linkedin.com/company/${seg[1].toLowerCase()}`);
    } else if (sameSite(host, domain)) {
      const clean = `https://${u.hostname}${u.pathname.replace(/\/$/, "")}`;
      const path = u.pathname.toLowerCase();
      if (
        host.startsWith("docs.") ||
        /^\/(docs|documentation|developers?)(\/|$)/.test(path) ||
        /^(docs|documentation|developers?|api docs)$/.test(text)
      )
        docs.push(host.startsWith("docs.") ? `https://${u.hostname}` : clean);
      if (
        /\/(partners?|partnerships?|partner-program|integrations-partners)(\/|$)/.test(path) ||
        /^(partners?|partnerships?|partner program|become a partner)$/.test(text)
      )
        partners.push(clean);
      if (/\/(contact|contact-us|contact-sales)(\/|$)/.test(path) && /partner|contact/.test(text)) forms.push(clean);
    }
  }
  return {
    x: top(xs),
    github: top(ghs),
    linkedin: top(lis),
    docs: docs[0] ?? null,
    partners: partners[0] ?? null,
    email: top(emails),
    contact_form: forms[0] ?? null,
  };
}
