/**
 * The one-off data cleanup Dan approved (shared/cleanup.ts), shown and applied from the back office,
 * plus a repair of HTML codes (like &#x27;) left in names and descriptions by the website reader.
 */
import { CLEANUP_FIX, CLEANUP_REASON, CLEANUP_REMOVE } from "../../shared/cleanup.ts";
import { decodeEntities } from "../../shared/collector.ts";
import { updateCompany } from "./curation.ts";
import { reviewCompany } from "./signals.ts";

type Row = { id: string; name: string; status: string; description: string | null; org_type: string | null };

async function byDomain(db: D1Database, domain: string) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.status, c.description, c.org_type FROM company_aliases a JOIN companies c ON c.id = a.company_id
       WHERE a.kind = 'domain' AND a.value = ?`,
    )
    .bind(domain)
    .first<Row>();
}

async function categoriesOf(db: D1Database, id: string) {
  const { results } = await db
    .prepare(
      "SELECT c.slug FROM company_categories cc JOIN categories c ON c.id = cc.category_id WHERE cc.company_id = ? ORDER BY c.slug",
    )
    .bind(id)
    .all<{ slug: string }>();
  return results.map((r) => r.slug);
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();
const HAS_CODES = "(name LIKE '%&%;%' OR description LIKE '%&%;%')";

async function withCodes(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT id, name, description FROM companies WHERE ${HAS_CODES}`)
    .all<{ id: string; name: string; description: string | null }>();
  return results.filter((r) => clean(r.name) !== r.name || (r.description && clean(r.description) !== r.description));
}

export type CleanupPlan = { remove: typeof CLEANUP_REMOVE; fix: typeof CLEANUP_FIX; reason: string };
const PLAN: CleanupPlan = { remove: CLEANUP_REMOVE, fix: CLEANUP_FIX, reason: CLEANUP_REASON };

async function fixChanges(db: D1Database, f: CleanupPlan["fix"][number], row: Row) {
  const changes: { field: string; from: string; to: string }[] = [];
  if (f.name !== undefined && f.name !== row.name) changes.push({ field: "name", from: row.name, to: f.name });
  if (f.description !== undefined && f.description !== row.description)
    changes.push({ field: "description", from: row.description ?? "", to: f.description });
  if (f.org_type !== undefined && f.org_type !== row.org_type)
    changes.push({ field: "type", from: row.org_type ?? "", to: f.org_type });
  if (f.categories !== undefined) {
    const now = await categoriesOf(db, row.id);
    const want = [...f.categories].sort();
    if (now.join(",") !== want.join(","))
      changes.push({ field: "categories", from: now.join(", "), to: want.join(", ") });
  }
  return changes;
}

/** What the cleanup would do now (items already done show as done). */
export async function previewCleanup(db: D1Database, plan: CleanupPlan = PLAN) {
  const remove = [];
  for (const r of plan.remove) {
    const row = await byDomain(db, r.domain);
    remove.push({ ...r, found: Boolean(row), status: row?.status ?? null, done: !row || row.status === "rejected" });
  }
  const fix = [];
  for (const f of plan.fix) {
    const row = await byDomain(db, f.domain);
    const changes = row ? await fixChanges(db, f, row) : [];
    fix.push({
      domain: f.domain,
      name: row?.name ?? f.domain,
      why: f.why,
      found: Boolean(row),
      changes,
      done: !changes.length,
    });
  }
  const codes = (await withCodes(db)).map((r) => r.name);
  return { remove, fix, codes };
}

/** Apply it: reject the removals, make the fixes (re-verified on the company's homepage), repair HTML codes. */
export async function applyCleanup(db: D1Database, editor: string, plan: CleanupPlan = PLAN, now = new Date()) {
  let removed = 0;
  let fixed = 0;
  for (const r of plan.remove) {
    const row = await byDomain(db, r.domain);
    if (!row || row.status === "rejected") continue;
    await reviewCompany(db, row.id, { action: "reject", reason: `${plan.reason} (${r.why})` }, editor, now);
    removed += 1;
  }
  for (const f of plan.fix) {
    const row = await byDomain(db, f.domain);
    if (!row || !(await fixChanges(db, f, row)).length) continue;
    const { reopened } = await updateCompany(
      db,
      row.id,
      {
        ...(f.name !== undefined ? { name: f.name } : {}),
        ...(f.description !== undefined ? { description: f.description } : {}),
        ...(f.org_type !== undefined ? { org_type: f.org_type } : {}),
        ...(f.categories !== undefined ? { categories: f.categories } : {}),
      },
      editor,
      now,
    );
    // Dan approved these exact corrections against the company's own site: keep it showing.
    if (reopened)
      await reviewCompany(db, row.id, { action: "verify", checked_url: `https://${f.domain}/` }, editor, now);
    fixed += 1;
  }
  // Same text, just readable: not a change of fact, so no new review.
  const rows = await withCodes(db);
  for (const r of rows)
    await db
      .prepare("UPDATE companies SET name = ?, description = ? WHERE id = ?")
      .bind(clean(r.name), r.description ? clean(r.description) : null, r.id)
      .run();
  return { removed, fixed, repaired: rows.length };
}
