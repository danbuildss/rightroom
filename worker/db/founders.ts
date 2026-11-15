/**
 * Founder accounts, sessions and onboarding answers. Every founder has their own workspace;
 * every query here is scoped to it, and deleting the workspace deletes everything.
 */
import type { PrivyIdentity, ProfileUpdate } from "../../shared/founder.ts";
import { ONBOARDING_STEPS } from "../../shared/founder.ts";
import { newId, nowIso } from "./util.ts";

export const SESSION_DAYS = 30;

export interface Founder {
  id: string;
  workspace_id: string;
  name: string | null;
  email: string | null;
  x_handle: string | null;
  role: string | null;
  onboarding_step: number;
  onboarded_at: string | null;
  created_at: string;
  last_sign_in_at: string;
}

export interface FounderProfile {
  company_name: string | null;
  website: string | null;
  one_liner: string | null;
  buyers: string | null;
  goals: string[];
  markets: string[];
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function findFounderByDid(db: D1Database, did: string): Promise<Founder | null> {
  return db
    .prepare(
      "SELECT id, workspace_id, name, email, x_handle, role, onboarding_step, onboarded_at, created_at, last_sign_in_at FROM founders WHERE privy_did = ?",
    )
    .bind(did)
    .first<Founder>();
}

/** Create the founder (and their private workspace) on first sign-in, or refresh their details. */
export async function upsertFounder(db: D1Database, who: PrivyIdentity, now = new Date()): Promise<Founder> {
  const at = nowIso(now);
  const email = who.emails[0] ?? null;
  const existing = await findFounderByDid(db, who.did);
  if (existing) {
    await db
      .prepare(
        "UPDATE founders SET email = COALESCE(?, email), x_handle = COALESCE(?, x_handle), last_sign_in_at = ? WHERE id = ?",
      )
      .bind(email, who.x_handle, at, existing.id)
      .run();
    return {
      ...existing,
      email: email ?? existing.email,
      x_handle: who.x_handle ?? existing.x_handle,
      last_sign_in_at: at,
    };
  }
  const workspaceId = newId();
  const founderId = newId();
  const owner = email ?? `x:${who.x_handle ?? who.did}`;
  await db.batch([
    db
      .prepare("INSERT INTO workspaces (id, name, owner_email, is_sample, created_at) VALUES (?, ?, ?, 0, ?)")
      .bind(workspaceId, who.name ?? owner, owner, at),
    db
      .prepare(
        `INSERT INTO founders (id, workspace_id, privy_did, name, email, x_handle, onboarding_step, created_at, last_sign_in_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(founderId, workspaceId, who.did, who.name, email, who.x_handle, at, at),
    db.prepare("INSERT INTO founder_profiles (workspace_id, updated_at) VALUES (?, ?)").bind(workspaceId, at),
  ]);
  return (await findFounderByDid(db, who.did)) as Founder;
}

/** Returns the cookie value; only its hash is stored. */
export async function createSession(db: D1Database, founder: Founder, now = new Date()): Promise<string> {
  const token = randomToken();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db
    .prepare(
      "INSERT INTO founder_sessions (id, workspace_id, founder_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(await sha256Hex(token), founder.workspace_id, founder.id, nowIso(now), nowIso(expires))
    .run();
  return token;
}

export async function sessionFounder(
  db: D1Database,
  token: string,
  now = new Date(),
): Promise<{ id: string; workspace_id: string; session_id: string } | null> {
  const id = await sha256Hex(token);
  const row = await db
    .prepare("SELECT founder_id, workspace_id FROM founder_sessions WHERE id = ? AND expires_at > ?")
    .bind(id, nowIso(now))
    .first<{ founder_id: string; workspace_id: string }>();
  return row ? { id: row.founder_id, workspace_id: row.workspace_id, session_id: id } : null;
}

export async function endSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM founder_sessions WHERE id = ?").bind(sessionId).run();
}

export async function getFounderView(db: D1Database, workspaceId: string) {
  const founder = await db
    .prepare(
      "SELECT id, workspace_id, name, email, x_handle, role, onboarding_step, onboarded_at, created_at, last_sign_in_at FROM founders WHERE workspace_id = ?",
    )
    .bind(workspaceId)
    .first<Founder>();
  if (!founder) return null;
  const p = await db
    .prepare(
      "SELECT company_name, website, one_liner, buyers, goals_json, markets_json FROM founder_profiles WHERE workspace_id = ?",
    )
    .bind(workspaceId)
    .first<Omit<FounderProfile, "goals" | "markets"> & { goals_json: string; markets_json: string }>();
  const profile: FounderProfile = {
    company_name: p?.company_name ?? null,
    website: p?.website ?? null,
    one_liner: p?.one_liner ?? null,
    buyers: p?.buyers ?? null,
    goals: p ? JSON.parse(p.goals_json) : [],
    markets: p ? JSON.parse(p.markets_json) : [],
  };
  const { workspace_id: _ws, ...rest } = founder;
  return { founder: rest, profile };
}

export async function updateProfile(db: D1Database, workspaceId: string, u: ProfileUpdate, now = new Date()) {
  const at = nowIso(now);
  const blank = (v: string | undefined) => (v === undefined ? undefined : v === "" ? null : v);
  const stmts: D1PreparedStatement[] = [];
  const fSet: string[] = [];
  const fArgs: unknown[] = [];
  if (u.name !== undefined) {
    fSet.push("name = ?");
    fArgs.push(u.name);
  }
  if (u.role !== undefined) {
    fSet.push("role = ?");
    fArgs.push(blank(u.role));
  }
  if (u.step !== undefined) {
    // Steps only move forward through onboarding; finishing records the date once.
    fSet.push("onboarding_step = MAX(onboarding_step, ?)");
    fArgs.push(u.step);
    if (u.step > ONBOARDING_STEPS) {
      fSet.push("onboarded_at = COALESCE(onboarded_at, ?)");
      fArgs.push(at);
    }
  }
  if (fSet.length) {
    stmts.push(db.prepare(`UPDATE founders SET ${fSet.join(", ")} WHERE workspace_id = ?`).bind(...fArgs, workspaceId));
  }
  const pSet: string[] = [];
  const pArgs: unknown[] = [];
  for (const k of ["company_name", "website", "one_liner", "buyers"] as const) {
    if (u[k] !== undefined) {
      pSet.push(`${k} = ?`);
      pArgs.push(blank(u[k]));
    }
  }
  if (u.goals !== undefined) {
    pSet.push("goals_json = ?");
    pArgs.push(JSON.stringify([...new Set(u.goals)]));
  }
  if (u.markets !== undefined) {
    pSet.push("markets_json = ?");
    pArgs.push(JSON.stringify([...new Set(u.markets)]));
  }
  if (pSet.length) {
    stmts.push(
      db
        .prepare(`UPDATE founder_profiles SET ${pSet.join(", ")}, updated_at = ? WHERE workspace_id = ?`)
        .bind(...pArgs, at, workspaceId),
    );
  }
  if (stmts.length) await db.batch(stmts);
  return getFounderView(db, workspaceId);
}

/** Deletes the founder's workspace; foreign keys remove the founder, sessions and profile with it. */
export async function deleteFounderWorkspace(db: D1Database, workspaceId: string): Promise<void> {
  await db.prepare("DELETE FROM workspaces WHERE id = ?").bind(workspaceId).run();
}

export async function listFounders(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT f.id, f.name, f.email, f.x_handle, f.role, f.onboarding_step, f.onboarded_at, f.created_at, f.last_sign_in_at,
         p.company_name, p.website
       FROM founders f LEFT JOIN founder_profiles p ON p.workspace_id = f.workspace_id
       ORDER BY f.created_at DESC LIMIT 500`,
    )
    .all();
  return results;
}
