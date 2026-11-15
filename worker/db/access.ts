/** Storage for Request access submissions (see shared/access.ts). */
import type { AccessStatus } from "../../shared/access.ts";
import { NotFoundError } from "./util.ts";

/** At most this many submissions an hour across the whole site, to blunt spam. */
export const HOURLY_LIMIT = 30;

export interface AccessRequest {
  id: string;
  name: string;
  email: string | null;
  x_handle: string | null;
  website: string | null;
  goal: string;
  status: AccessStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccessSubmission {
  name: string;
  email?: string | null;
  x_handle?: string | null;
  website?: string | null;
  goal: string;
}

export class TooManyRequestsError extends Error {}

async function findExisting(db: D1Database, email?: string | null, x?: string | null) {
  if (!email && !x) return null;
  return db
    .prepare("SELECT id, status FROM access_requests WHERE email = ? OR x_handle = ? ORDER BY created_at LIMIT 1")
    .bind(email ?? null, x ?? null)
    .first<{ id: string; status: AccessStatus }>();
}

/**
 * Save a request. Sending again with the same email or X handle updates a still-new request
 * rather than creating a duplicate, and gives the same answer, so the form never reveals who has applied.
 */
export async function submitAccessRequest(db: D1Database, input: AccessSubmission, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM access_requests WHERE updated_at >= ?")
    .bind(since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) throw new TooManyRequestsError("Too many requests right now.");
  const at = now.toISOString();
  const existing = await findExisting(db, input.email, input.x_handle);
  if (existing) {
    if (existing.status !== "new") return;
    await db
      .prepare(
        `UPDATE access_requests SET name = ?, website = ?, goal = ?, updated_at = ?,
           email = COALESCE(email, ?), x_handle = COALESCE(x_handle, ?) WHERE id = ?`,
      )
      .bind(input.name, input.website ?? null, input.goal, at, input.email ?? null, input.x_handle ?? null, existing.id)
      .run()
      .catch(() => undefined); // a clash on the other identifier: keep the request as it was
    return;
  }
  await db
    .prepare(
      `INSERT INTO access_requests (id, name, email, x_handle, website, goal, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.name,
      input.email ?? null,
      input.x_handle ?? null,
      input.website ?? null,
      input.goal,
      at,
      at,
    )
    .run();
}

/** Dan invites someone directly. An existing request for the same email or handle is marked invited instead. */
export async function inviteDirectly(
  db: D1Database,
  input: { name?: string; email?: string; x_handle?: string; note?: string },
  now = new Date(),
): Promise<AccessRequest> {
  const at = now.toISOString();
  const existing = await findExisting(db, input.email, input.x_handle);
  if (existing) return reviewAccessRequest(db, existing.id, { status: "invited", note: input.note }, now);
  const row = await db
    .prepare(
      `INSERT INTO access_requests (id, name, email, x_handle, goal, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Invited directly by Dan', 'invited', ?, ?, ?) RETURNING *`,
    )
    .bind(
      crypto.randomUUID(),
      input.name || input.email || `@${input.x_handle}`,
      input.email ?? null,
      input.x_handle ?? null,
      input.note ?? null,
      at,
      at,
    )
    .first<AccessRequest>();
  if (!row) throw new Error("invite not saved");
  return row;
}

/** Is any of these identities on the invited list? */
export async function isInvited(db: D1Database, emails: string[], x: string | null): Promise<boolean> {
  if (emails.length === 0 && !x) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM access_requests WHERE status = 'invited' AND (
         x_handle = ? ${emails.length ? `OR email IN (${emails.map(() => "?").join(",")})` : ""}) LIMIT 1`,
    )
    .bind(x ?? null, ...emails)
    .first<{ ok: number }>();
  return Boolean(row);
}

export async function listAccessRequests(
  db: D1Database,
  filter: { status?: AccessStatus; limit?: number; offset?: number } = {},
): Promise<AccessRequest[]> {
  const where = filter.status ? "WHERE status = ?" : "";
  const args: unknown[] = filter.status ? [filter.status] : [];
  const { results } = await db
    .prepare(`SELECT * FROM access_requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...args, Math.min(Math.max(filter.limit ?? 50, 1), 200), Math.max(filter.offset ?? 0, 0))
    .all<AccessRequest>();
  return results;
}

export async function reviewAccessRequest(
  db: D1Database,
  id: string,
  input: { status: AccessStatus; note?: string },
  now = new Date(),
): Promise<AccessRequest> {
  const row = await db
    .prepare("UPDATE access_requests SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ? RETURNING *")
    .bind(input.status, input.note ?? null, now.toISOString(), id)
    .first<AccessRequest>();
  if (!row) throw new NotFoundError("Access request not found.");
  return row;
}
