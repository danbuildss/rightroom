/**
 * Read a source page on the reviewer's behalf and suggest the supporting sentence.
 * Suggestions only: approving is still a person's decision (worker/db/signals.ts).
 */
import { pageFingerprint } from "../../shared/collector.ts";
import { bestMatches, type EvidenceMatch, mentionsCompany } from "../../shared/evidence.ts";
import { USER_AGENT } from "./collector.ts";
import { NotFoundError } from "./util.ts";

const MAX_BYTES = 2_000_000;

export interface PageCheck {
  url: string;
  reachable: boolean;
  http_status: number | null;
  title: string | null;
  error?: string;
  text?: string;
}

async function readPage(fetcher: typeof fetch, url: string): Promise<PageCheck> {
  if (!/^https?:\/\//i.test(url))
    return { url, reachable: false, http_status: null, title: null, error: "not an http(s) link" };
  try {
    const res = await fetcher(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      return { url, reachable: false, http_status: res.status, title: null, error: `the site answered ${res.status}` };
    const body = (await res.text()).slice(0, MAX_BYTES);
    const { text, title } = await pageFingerprint(body);
    return { url, reachable: true, http_status: res.status, title, text };
  } catch (err) {
    return {
      url,
      reachable: false,
      http_status: null,
      title: null,
      error: `could not load the page (${err instanceof Error ? err.name : "error"})`,
    };
  }
}

export interface SignalEvidence {
  page: Omit<PageCheck, "text">;
  claim: string;
  matches: EvidenceMatch[];
}

export async function signalEvidence(db: D1Database, signalId: string, fetcher: typeof fetch): Promise<SignalEvidence> {
  const row = await db
    .prepare(
      `SELECT se.factual_claim, s.url FROM signal_events se
       JOIN signal_sources ss ON ss.signal_id = se.id AND ss.role = 'primary' JOIN sources s ON s.id = ss.source_id
       WHERE se.id = ?`,
    )
    .bind(signalId)
    .first<{ factual_claim: string; url: string }>();
  if (!row) throw new NotFoundError("signal not found");
  const { text, ...page } = await readPage(fetcher, row.url);
  return { page, claim: row.factual_claim, matches: text ? bestMatches(row.factual_claim, text) : [] };
}

export interface CompanyEvidence {
  page: Omit<PageCheck, "text">;
  name_found: boolean;
  /** The page's own first words, to compare with the stored description. */
  intro: string | null;
}

export async function companyEvidence(
  db: D1Database,
  companyId: string,
  fetcher: typeof fetch,
): Promise<CompanyEvidence> {
  const row = await db
    .prepare("SELECT name, primary_domain FROM companies WHERE id = ?")
    .bind(companyId)
    .first<{ name: string; primary_domain: string }>();
  if (!row) throw new NotFoundError("company not found");
  const { text, ...page } = await readPage(fetcher, `https://${row.primary_domain}`);
  return {
    page,
    name_found: text ? mentionsCompany(row.name, page.title, text) : false,
    intro: text ? text.slice(0, 300) : null,
  };
}
