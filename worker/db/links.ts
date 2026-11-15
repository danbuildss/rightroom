/**
 * Public links for a company card or page: its website, X and GitHub (from its verified record's
 * aliases), and its partner page and docs (from sources attached to the company, preferring pages
 * on its own site). A link only appears when we have it; nothing is guessed.
 */
export interface CompanyLinks {
  website: string;
  x: string | null;
  github: string | null;
  partners: string | null;
  docs: string | null;
  linkedin: string | null;
  email: string | null;
  contact_form: string | null;
}

const onSite = (url: string, domain: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

export async function linksFor(
  db: D1Database,
  companies: { id: string; domain: string }[],
): Promise<Map<string, CompanyLinks>> {
  const out = new Map<string, CompanyLinks>();
  if (!companies.length) return out;
  for (const c of companies)
    out.set(c.id, {
      website: `https://${c.domain}`,
      x: null,
      github: null,
      partners: null,
      docs: null,
      linkedin: null,
      email: null,
      contact_form: null,
    });
  const ids = companies.map((c) => c.id);
  const marks = ids.map(() => "?").join(",");
  const [aliases, sources, web] = await db.batch([
    db
      .prepare(
        `SELECT company_id, kind, value FROM company_aliases WHERE company_id IN (${marks}) AND kind IN ('x_handle', 'github_org')
         ORDER BY created_at`,
      )
      .bind(...ids),
    db
      .prepare(
        `SELECT company_id, kind, url FROM sources WHERE company_id IN (${marks}) AND kind IN ('partner_page', 'docs')
         ORDER BY first_seen_at DESC`,
      )
      .bind(...ids),
    db.prepare(`SELECT company_id, kind, value FROM company_web_links WHERE company_id IN (${marks})`).bind(...ids),
  ]);
  for (const w of (web?.results ?? []) as { company_id: string; kind: string; value: string }[]) {
    const l = out.get(w.company_id);
    if (!l) continue;
    if (w.kind === "linkedin" && /^https:\/\/(www\.)?linkedin\.com\/company\//.test(w.value)) l.linkedin = w.value;
    if (w.kind === "email" && /^[^\s@<>"]+@[^\s@<>"]+$/.test(w.value)) l.email = w.value;
    if (w.kind === "contact_form" && /^https:\/\//.test(w.value)) l.contact_form = w.value;
  }
  for (const a of (aliases?.results ?? []) as { company_id: string; kind: string; value: string }[]) {
    const l = out.get(a.company_id);
    if (!l) continue;
    if (a.kind === "x_handle" && !l.x) l.x = `https://x.com/${a.value}`;
    if (a.kind === "github_org" && !l.github) l.github = `https://github.com/${a.value}`;
  }
  const domainOf = new Map(companies.map((c) => [c.id, c.domain]));
  const rows = (sources?.results ?? []) as { company_id: string; kind: string; url: string }[];
  // Pages on the company's own site first, then anything else attached to it.
  rows.sort(
    (a, b) =>
      Number(onSite(b.url, domainOf.get(b.company_id) ?? "")) - Number(onSite(a.url, domainOf.get(a.company_id) ?? "")),
  );
  for (const s of rows) {
    const l = out.get(s.company_id);
    if (!l || !/^https?:\/\//i.test(s.url)) continue;
    if (s.kind === "partner_page" && !l.partners) l.partners = s.url;
    if (s.kind === "docs" && !l.docs) l.docs = s.url;
  }
  return out;
}
