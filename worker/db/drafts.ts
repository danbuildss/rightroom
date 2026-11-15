/** Founder drafts: private to the workspace, never sent by Rightroom. */
import type { Variant } from "../../shared/draft.ts";
import { NotFoundError, newId, nowIso } from "./util.ts";

export interface Draft {
  id: string;
  variant: Variant;
  recipient: string;
  channel_label: string | null;
  channel_url: string | null;
  subject: string | null;
  message: string;
  status: "draft" | "sent";
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLS =
  "id, variant, recipient, channel_label, channel_url, subject, message, status, sent_at, created_at, updated_at";

export async function verifiedCompanyId(db: D1Database, slug: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM companies WHERE slug = ? AND status = 'verified' AND is_sample = 0")
    .bind(slug)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function listDrafts(db: D1Database, workspaceId: string, companyId: string): Promise<Draft[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM founder_drafts WHERE workspace_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(workspaceId, companyId)
    .all<Draft>();
  return results;
}

export async function saveDraft(
  db: D1Database,
  workspaceId: string,
  companyId: string,
  d: {
    variant: Variant;
    recipient: string;
    channel_label?: string;
    channel_url?: string;
    subject?: string;
    message: string;
  },
  now = new Date(),
): Promise<Draft> {
  const at = nowIso(now);
  return (await db
    .prepare(
      `INSERT INTO founder_drafts (id, workspace_id, company_id, variant, recipient, channel_label, channel_url, subject, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLS}`,
    )
    .bind(
      newId(),
      workspaceId,
      companyId,
      d.variant,
      d.recipient,
      d.channel_label ?? null,
      d.channel_url ?? null,
      d.subject ?? null,
      d.message,
      at,
      at,
    )
    .first<Draft>()) as Draft;
}

export async function updateDraft(
  db: D1Database,
  workspaceId: string,
  id: string,
  patch: { subject?: string; message?: string; status?: "draft" | "sent" },
  now = new Date(),
): Promise<Draft> {
  const at = nowIso(now);
  const row = await db
    .prepare(
      `UPDATE founder_drafts SET subject = COALESCE(?, subject), message = COALESCE(?, message),
         status = COALESCE(?, status),
         sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, ?) WHEN ? = 'draft' THEN NULL ELSE sent_at END,
         updated_at = ?
       WHERE id = ? AND workspace_id = ? RETURNING ${COLS}`,
    )
    .bind(
      patch.subject ?? null,
      patch.message ?? null,
      patch.status ?? null,
      patch.status ?? null,
      at,
      patch.status ?? null,
      at,
      id,
      workspaceId,
    )
    .first<Draft>();
  if (!row) throw new NotFoundError("Draft not found.");
  return row;
}

export async function deleteDraft(db: D1Database, workspaceId: string, id: string): Promise<void> {
  const res = await db
    .prepare("DELETE FROM founder_drafts WHERE id = ? AND workspace_id = ?")
    .bind(id, workspaceId)
    .run();
  if (!res.meta.changes) throw new NotFoundError("Draft not found.");
}
