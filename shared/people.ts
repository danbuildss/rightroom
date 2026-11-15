/**
 * Points of contact from a company's own pages (data engine, part C). Pure functions, no network.
 *
 * Finds named people whose role makes them a sensible first contact for a partnership (founders,
 * partnerships, business development, developer relations, ecosystem), from structured data
 * (JSON-LD Person) or a team grid (a name followed by a role). Also finds team/about pages to read.
 * Only names and roles printed on the company's own site are taken; nothing is guessed.
 * Every person found is a suggestion that Dan approves.
 */

export interface FoundPerson {
  name: string;
  role: string;
}

/** Roles worth contacting about a partnership. */
const ROLE =
  /\b(co-?founder|founder|ceo|chief executive|cto|chief technology|coo|head of (partnerships?|business development|bd|growth|ecosystem|developer relations|devrel|alliances|integrations|bizdev)|(vp|director|lead|manager)[, ]+(of )?(partnerships?|business development|bd|alliances|ecosystem|developer relations|devrel|integrations)|partnerships?( lead| manager)?|business development|bizdev|developer relations|devrel|developer advocate|ecosystem lead|alliances)\b/i;

const NOT_NAME =
  /\b(team|about|our|the|and|with|join|careers|company|contact|blog|product|founders?|partners?|ceo|cto|coo|head|lead|inc|ltd|llc|labs?)\b/i;

/** "Jane Doe", "Jean-Luc O'Neil", "Ana María López": 2–4 capitalised words, nothing else. */
export function looksLikeName(s: string): boolean {
  const t = s.trim();
  if (t.length < 4 || t.length > 60 || NOT_NAME.test(t)) return false;
  return /^\p{Lu}[\p{L}'’.-]+(\s\p{Lu}[\p{L}'’.-]+){1,3}$/u.test(t);
}

const clean = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;|&rsquo;/g, "’")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function fromJsonLd(html: string): FoundPerson[] {
  const out: FoundPerson[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const type = Array.isArray(o["@type"]) ? o["@type"].join(" ") : String(o["@type"] ?? "");
    if (/Person/.test(type) && typeof o.name === "string") {
      const role = typeof o.jobTitle === "string" ? o.jobTitle : null;
      if (role && ROLE.test(role) && looksLikeName(o.name)) out.push({ name: clean(o.name), role: clean(role) });
    }
    for (const k of ["founder", "founders", "employee", "employees", "member", "members", "@graph"]) visit(o[k]);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1] ?? ""));
    } catch {
      // Broken JSON-LD: ignore it.
    }
  }
  return out;
}

/** A name in one text block followed by a role in the next (the usual team-grid layout), or "Name, Role". */
function fromText(html: string): FoundPerson[] {
  const body = html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const blocks = body
    .split(/<[^>]+>/)
    .map(clean)
    .filter((b) => b.length > 0 && b.length < 120);
  const out: FoundPerson[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as string;
    const inline = b.match(/^(.{4,60}?)\s*[,–—|-]\s*(.{3,80})$/);
    if (inline && looksLikeName(inline[1] ?? "") && !ROLE.test(inline[1] ?? "") && ROLE.test(inline[2] ?? "")) {
      out.push({ name: (inline[1] as string).trim(), role: (inline[2] as string).trim() });
      continue;
    }
    const next = blocks[i + 1];
    if (next && looksLikeName(b) && !ROLE.test(b) && ROLE.test(next) && next.length <= 80) {
      out.push({ name: b, role: next });
      i += 1;
    }
  }
  return out;
}

export function extractPeople(html: string): FoundPerson[] {
  const seen = new Set<string>();
  const out: FoundPerson[] = [];
  for (const p of [...fromJsonLd(html), ...fromText(html)]) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.slice(0, 8);
}

/** Team, about, company or leadership pages on the company's own site, linked from a page. */
export function teamPages(html: string, base: string, domain: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1] ?? "", base);
      const host = u.hostname.replace(/^www\./, "");
      if (host !== domain && !host.endsWith(`.${domain}`)) continue;
      if (/^\/(about(-us)?|team|our-team|company|people|leadership|founders)\/?$/i.test(u.pathname))
        out.add(`https://${u.hostname}${u.pathname.replace(/\/$/, "")}`);
    } catch {
      // not a link
    }
  }
  return [...out].slice(0, 2);
}
