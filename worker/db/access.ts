/** Storage for Request access submissions (see shared/access.ts). */
import type { AccessRequestInput, AccessStatus } from "../../shared/access.ts";
import { NotFoundError } from "./util.ts";

/** At most this many submissions an hour across the whole site, to blunt spam. */
export const HOURLY_LIMIT = 30;

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  website: string | null;
  goal: string;
  status: AccessStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export class TooManyRequestsError extends Error {}

/**
 * Save a request. Sending again with the same email updates a still-new request rather
 * than creating a duplicate, and gives the same answer, so the form never reveals who has applied.
 */
export async function submitAccessRequest(db: D1Database, input: AccessRequestInput, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM access_requests WHERE updated_at >= ?")
    .bind(since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= HOURLY_LIMIT) throw new TooManyRequestsError("Too many requests right now.");
  const at = now.toISOString();
  await db
    .prepare(
      `INSERT INTO access_requests (id, name, email, website, goal, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'new', ?, ?)
       ON CONFLICT (email) DO UPDATE SET name = excluded.name, website = excluded.website, goal = excluded.goal,
         updated_at = excluded.updated_at
       WHERE access_requests.status = 'new'`,
    )
    .bind(crypto.randomUUID(), input.name, input.email, input.website ?? null, input.goal, at, at)
    .run();
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
