/** Company contacts and channels (shared registry, admin-curated). */
import type { ContactInput } from "../../shared/contacts.ts";
import { NotFoundError, newId, nowIso } from "./util.ts";

export interface Contact {
  id: string;
  company_id: string;
  kind: "person" | "channel";
  name: string | null;
  role: string | null;
  channel_label: string | null;
  url: string | null;
  source_url: string;
  confidence: "high" | "medium" | "low";
  status: "needs_review" | "verified" | "rejected";
  rejected_reason: string | null;
  last_checked_at: string | null;
  created_at: string;
}

const COLS =
  "id, company_id, kind, name, role, channel_label, url, source_url, confidence, status, rejected_reason, last_checked_at, created_at";

export async function addContact(db: D1Database, companyId: string, input: ContactInput, by: string, now = new Date()) {
  const company = await db.prepare("SELECT id FROM companies WHERE id = ?").bind(companyId).first();
  if (!company) throw new NotFoundError("company not found");
  const at = nowIso(now);
  const person = input.kind === "person" ? input : null;
  const channel = input.kind === "channel" ? input : null;
  return (await db
    .prepare(
      `INSERT INTO company_contacts (id, company_id, kind, name, role, channel_label, url, source_url, confidence, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
    )
    .bind(
      newId(),
      companyId,
      input.kind,
      person?.name ?? null,
      person?.role ?? null,
      channel?.channel_label ?? null,
      channel?.url ?? null,
      person?.source_url ?? channel?.source_url ?? channel?.url ?? "",
      input.confidence,
      by,
      at,
      at,
    )
    .first<Contact>()) as Contact;
}

export async function listContacts(db: D1Database, companyId: string, opts: { verifiedOnly?: boolean } = {}) {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM company_contacts WHERE company_id = ? ${opts.verifiedOnly ? "AND status = 'verified'" : "AND status != 'rejected'"}
       ORDER BY kind DESC, created_at`,
    )
    .bind(companyId)
    .all<Contact>();
  return results;
}

export async function reviewContact(
  db: D1Database,
  id: string,
  review: { action: "verify" | "reject"; reason?: string },
  now = new Date(),
) {
  const at = nowIso(now);
  const row = await db
    .prepare(
      `UPDATE company_contacts SET status = ?, rejected_reason = ?, last_checked_at = CASE WHEN ? = 'verify' THEN ? ELSE last_checked_at END,
         updated_at = ? WHERE id = ? RETURNING ${COLS}`,
    )
    .bind(review.action === "verify" ? "verified" : "rejected", review.reason ?? null, review.action, at, at, id)
    .first<Contact>();
  if (!row) throw new NotFoundError("contact not found");
  return row;
}
