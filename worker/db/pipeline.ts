/** Founder pipeline: saved companies, stages, follow-ups, notes and a timeline. Workspace-scoped. */
import { addDays, FOLLOW_UP_DAYS, STAGE_LABELS, type Stage } from "../../shared/pipeline.ts";
import { NotFoundError, newId, nowIso } from "./util.ts";

export interface SavedRow {
  id: string;
  company_id: string;
  stage: Stage;
  follow_up_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = "id, company_id, stage, follow_up_at, notes, created_at, updated_at";

function event(
  db: D1Database,
  ws: string,
  savedId: string,
  e: {
    type: "saved" | "stage" | "sent" | "follow_up";
    from?: string | null;
    to?: string | null;
    detail?: string | null;
  },
  at: string,
) {
  return db
    .prepare(
      "INSERT INTO founder_pipeline_events (id, workspace_id, saved_id, event_type, from_stage, to_stage, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(newId(), ws, savedId, e.type, e.from ?? null, e.to ?? null, e.detail ?? null, at);
}

export async function findSaved(db: D1Database, ws: string, companyId: string): Promise<SavedRow | null> {
  return db
    .prepare(`SELECT ${COLS} FROM founder_saved WHERE workspace_id = ? AND company_id = ?`)
    .bind(ws, companyId)
    .first<SavedRow>();
}

/** Save a company to Shortlisted. Saving again returns the existing entry unchanged. */
export async function saveCompany(db: D1Database, ws: string, companyId: string, now = new Date()): Promise<SavedRow> {
  const existing = await findSaved(db, ws, companyId);
  if (existing) return existing;
  const at = nowIso(now);
  const id = newId();
  await db.batch([
    db
      .prepare(
        "INSERT INTO founder_saved (id, workspace_id, company_id, stage, created_at, updated_at) VALUES (?, ?, ?, 'shortlisted', ?, ?)",
      )
      .bind(id, ws, companyId, at, at),
    event(db, ws, id, { type: "saved", to: "shortlisted" }, at),
  ]);
  return (await findSaved(db, ws, companyId)) as SavedRow;
}

export async function getSaved(db: D1Database, ws: string, id: string): Promise<SavedRow> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM founder_saved WHERE id = ? AND workspace_id = ?`)
    .bind(id, ws)
    .first<SavedRow>();
  if (!row) throw new NotFoundError("Not in your pipeline.");
  return row;
}

export async function updateSaved(
  db: D1Database,
  ws: string,
  id: string,
  patch: { stage?: Stage; follow_up_at?: string | null; notes?: string },
  now = new Date(),
): Promise<SavedRow> {
  const current = await getSaved(db, ws, id);
  const at = nowIso(now);
  const stmts: D1PreparedStatement[] = [];
  const set: string[] = [];
  const args: unknown[] = [];
  if (patch.stage && patch.stage !== current.stage) {
    set.push("stage = ?");
    args.push(patch.stage);
    stmts.push(event(db, ws, id, { type: "stage", from: current.stage, to: patch.stage }, at));
  }
  if (patch.follow_up_at !== undefined && patch.follow_up_at !== current.follow_up_at) {
    set.push("follow_up_at = ?");
    args.push(patch.follow_up_at);
    stmts.push(event(db, ws, id, { type: "follow_up", detail: patch.follow_up_at ?? "cleared" }, at));
  }
  if (patch.notes !== undefined) {
    set.push("notes = ?");
    args.push(patch.notes.trim() || null);
  }
  if (set.length) {
    stmts.unshift(
      db
        .prepare(`UPDATE founder_saved SET ${set.join(", ")}, updated_at = ? WHERE id = ? AND workspace_id = ?`)
        .bind(...args, at, id, ws),
    );
    await db.batch(stmts);
  }
  return getSaved(db, ws, id);
}

export async function removeSaved(db: D1Database, ws: string, id: string): Promise<void> {
  const res = await db.prepare("DELETE FROM founder_saved WHERE id = ? AND workspace_id = ?").bind(id, ws).run();
  if (!res.meta.changes) throw new NotFoundError("Not in your pipeline.");
}

/**
 * The founder said they sent an introduction: save the company if needed, move it to Contacted
 * (only forward from Shortlisted), and suggest a follow-up a week later if none is set.
 */
export async function recordSent(
  db: D1Database,
  ws: string,
  companyId: string,
  channel: string | null,
  now = new Date(),
): Promise<SavedRow> {
  const saved = await saveCompany(db, ws, companyId, now);
  const at = nowIso(now);
  const stmts: D1PreparedStatement[] = [event(db, ws, saved.id, { type: "sent", detail: channel }, at)];
  const set: string[] = [];
  const args: unknown[] = [];
  if (saved.stage === "shortlisted") {
    set.push("stage = 'contacted'");
    stmts.push(
      event(db, ws, saved.id, { type: "stage", from: "shortlisted", to: "contacted", detail: "automatic" }, at),
    );
  }
  if (!saved.follow_up_at) {
    const follow = addDays(at, FOLLOW_UP_DAYS);
    set.push("follow_up_at = ?");
    args.push(follow);
    stmts.push(event(db, ws, saved.id, { type: "follow_up", detail: follow }, at));
  }
  if (set.length) {
    stmts.unshift(
      db.prepare(`UPDATE founder_saved SET ${set.join(", ")}, updated_at = ? WHERE id = ?`).bind(...args, at, saved.id),
    );
  }
  await db.batch(stmts);
  return getSaved(db, ws, saved.id);
}

export async function listPipeline(db: D1Database, ws: string) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.stage, s.follow_up_at, s.notes, s.created_at, s.updated_at,
         c.slug, c.name, c.primary_domain AS domain, c.status AS company_status,
         (SELECT GROUP_CONCAT(cat.label, ' · ') FROM company_categories cc JOIN categories cat ON cat.id = cc.category_id
            WHERE cc.company_id = c.id AND cat.kind = 'sector') AS sectors,
         (SELECT MAX(sent_at) FROM founder_drafts d WHERE d.workspace_id = s.workspace_id AND d.company_id = c.id) AS last_sent_at,
         (SELECT channel_label FROM founder_drafts d WHERE d.workspace_id = s.workspace_id AND d.company_id = c.id AND d.status = 'sent'
            ORDER BY sent_at DESC LIMIT 1) AS last_sent_via,
         (SELECT COUNT(*) FROM founder_drafts d WHERE d.workspace_id = s.workspace_id AND d.company_id = c.id) AS drafts
       FROM founder_saved s JOIN companies c ON c.id = s.company_id
       WHERE s.workspace_id = ? ORDER BY s.updated_at DESC`,
    )
    .bind(ws)
    .all<{
      id: string;
      stage: Stage;
      follow_up_at: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
      slug: string;
      name: string;
      domain: string;
      company_status: string;
      sectors: string | null;
      last_sent_at: string | null;
      last_sent_via: string | null;
      drafts: number;
    }>();
  return results;
}

const shortDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    : iso;

export async function timeline(db: D1Database, ws: string, id: string) {
  await getSaved(db, ws, id);
  const { results } = await db
    .prepare(
      "SELECT event_type, from_stage, to_stage, detail, created_at FROM founder_pipeline_events WHERE workspace_id = ? AND saved_id = ? ORDER BY created_at DESC, rowid DESC",
    )
    .bind(ws, id)
    .all<{
      event_type: string;
      from_stage: Stage | null;
      to_stage: Stage | null;
      detail: string | null;
      created_at: string;
    }>();
  return results.map((e) => ({
    at: e.created_at,
    text:
      e.event_type === "saved"
        ? "Saved to Shortlisted"
        : e.event_type === "sent"
          ? `You marked an introduction as sent${e.detail ? ` (${e.detail})` : ""}`
          : e.event_type === "follow_up"
            ? e.detail === "cleared"
              ? "Follow-up cleared"
              : `Follow-up set for ${shortDate(e.detail ?? "")}`
            : `Moved to ${e.to_stage ? STAGE_LABELS[e.to_stage] : "?"}${e.detail === "automatic" ? " (automatic, from “I sent it”)" : ""}`,
  }));
}
