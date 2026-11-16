/**
 * Points of contact, found automatically (data engine, part C) and approved by Dan in batches.
 *
 *  - Named people from the company's own homepage and its team/about pages (shared/people.ts);
 *  - official channels: the company's partner page and contact form (found by the website reader);
 *  - people from Grok company research, only with their own cited post (worker/db/grok.ts).
 * Everything is added as needs_review with the page it came from; founders see a contact only after
 * Dan approves it. Never a guessed email.
 */
import { EXTERNAL, extractPeople, teamPages } from "../../shared/people.ts";
import { type AiEnv, AiOffError, aiPeople } from "./ai.ts";
import { USER_AGENT } from "./collector.ts";
import { addContact } from "./contacts.ts";
import { NotFoundError, nowIso } from "./util.ts";

const RECHECK_DAYS = 30;

async function page(fetcher: typeof fetch, url: string): Promise<{ html: string; url: string } | null> {
  try {
    const res = await fetcher(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return { html: (await res.text()).slice(0, 300_000), url: res.url || url };
  } catch {
    return null;
  }
}

/** Add a suggestion unless the company already has that person or channel (in any status). */
export async function suggestContact(
  db: D1Database,
  companyId: string,
  c:
    | { kind: "person"; name: string; role: string; source_url: string; confidence: "high" | "medium" | "low" }
    | {
        kind: "channel";
        channel_label: string;
        url: string;
        source_url: string;
        confidence: "high" | "medium" | "low";
      },
  by: string,
): Promise<boolean> {
  const dup = await db
    .prepare(
      c.kind === "person"
        ? "SELECT 1 FROM company_contacts WHERE company_id = ? AND kind = 'person' AND lower(name) = lower(?)"
        : "SELECT 1 FROM company_contacts WHERE company_id = ? AND kind = 'channel' AND url = ?",
    )
    .bind(companyId, c.kind === "person" ? c.name : c.url)
    .first();
  if (dup) return false;
  await addContact(db, companyId, c, by);
  return true;
}

export async function findContacts(
  db: D1Database,
  companyId: string,
  opts: { fetcher?: typeof fetch; env?: AiEnv } = {},
) {
  const fetcher = opts.fetcher ?? fetch;
  const co = await db
    .prepare("SELECT id, name, primary_domain AS domain FROM companies WHERE id = ?")
    .bind(companyId)
    .first<{ id: string; name: string; domain: string }>();
  if (!co) throw new NotFoundError("company not found");

  let added = 0;
  const home = await page(fetcher, `https://${co.domain}/`);
  const pages = home ? [home] : [];
  for (const url of home ? teamPages(home.html, home.url, co.domain) : []) {
    const p = await page(fetcher, url);
    if (p) pages.push(p);
  }
  // With the AI helpers on, the AI also reads each page (names must appear on the page; investors left out).
  const aiOn = Boolean(opts.env?.BANKR_LLM_KEY);
  for (const p of pages) {
    if (aiOn && opts.env) {
      try {
        for (const person of await aiPeople(db, opts.env, co, p.html, fetcher)) {
          if (EXTERNAL.test(person.role)) continue;
          if (
            await suggestContact(
              db,
              co.id,
              { kind: "person", ...person, source_url: p.url, confidence: "high" },
              "ai-website-reader",
            )
          )
            added += 1;
        }
      } catch (err) {
        if (!(err instanceof AiOffError)) console.log(`contacts AI: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    for (const person of extractPeople(p.html, co.name)) {
      if (
        await suggestContact(
          db,
          co.id,
          { kind: "person", ...person, source_url: p.url, confidence: "high" },
          "website-reader",
        )
      )
        added += 1;
    }
  }

  // Official channels the website reader already found: partner page and contact form.
  const [partner, form] = await Promise.all([
    db
      .prepare(
        "SELECT url FROM sources WHERE company_id = ? AND kind = 'partner_page' ORDER BY first_seen_at DESC LIMIT 1",
      )
      .bind(co.id)
      .first<{ url: string }>(),
    db
      .prepare("SELECT value AS url FROM company_web_links WHERE company_id = ? AND kind = 'contact_form'")
      .bind(co.id)
      .first<{ url: string }>(),
  ]);
  if (
    partner &&
    (await suggestContact(
      db,
      co.id,
      { kind: "channel", channel_label: "Partner page", url: partner.url, source_url: partner.url, confidence: "high" },
      "website-reader",
    ))
  )
    added += 1;
  if (
    form &&
    (await suggestContact(
      db,
      co.id,
      { kind: "channel", channel_label: "Contact form", url: form.url, source_url: form.url, confidence: "high" },
      "website-reader",
    ))
  )
    added += 1;

  await db
    .prepare(
      `INSERT INTO company_enrichment (company_id, checked_at, contacts_checked_at) VALUES (?, ?, ?)
       ON CONFLICT (company_id) DO UPDATE SET contacts_checked_at = excluded.contacts_checked_at`,
    )
    .bind(co.id, nowIso(), nowIso())
    .run();
  return { added, pages_read: pages.length };
}

/** A few verified companies not looked at for contacts yet (or not for a month). */
export async function findMissingContacts(
  db: D1Database,
  opts: { fetcher?: typeof fetch; limit?: number; env?: AiEnv } = {},
) {
  const since = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT c.id FROM companies c LEFT JOIN company_enrichment e ON e.company_id = c.id
       WHERE c.status = 'verified' AND c.is_sample = 0 AND (e.contacts_checked_at IS NULL OR e.contacts_checked_at < ?)
       ORDER BY e.contacts_checked_at IS NOT NULL, e.contacts_checked_at LIMIT ?`,
    )
    .bind(since, opts.limit ?? 3)
    .all<{ id: string }>();
  const out = [];
  for (const r of results) out.push({ id: r.id, ...(await findContacts(db, r.id, opts)) });
  return out;
}

/** Every contact waiting for Dan, with its company. */
export async function pendingContacts(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT k.id, k.kind, k.name, k.role, k.channel_label, k.url, k.source_url, k.confidence, k.created_by, k.created_at,
         c.id AS company_id, c.name AS company, c.primary_domain AS domain
       FROM company_contacts k JOIN companies c ON c.id = k.company_id
       WHERE k.status = 'needs_review' AND c.status = 'verified' ORDER BY c.name COLLATE NOCASE, k.kind DESC, k.created_at LIMIT 300`,
    )
    .all();
  return results;
}
