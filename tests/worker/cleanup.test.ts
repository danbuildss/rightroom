import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CLEANUP_FIX, CLEANUP_REMOVE } from "../../shared/cleanup.ts";
import { companyInputSchema } from "../../shared/registry.ts";
import { applyCleanup, type CleanupPlan, previewCleanup } from "../../worker/db/cleanup.ts";
import { createCompany, getCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import { call, token } from "./helpers.ts";

const ADMIN = "admin@talo.example";

async function verified(name: string, domain: string, categories: string[], description?: string) {
  const c = await createCompany(env.DB, companyInputSchema.parse({ name, domain, categories, description }), ADMIN);
  await reviewCompany(env.DB, c.id, { action: "verify", checked_url: `https://${domain}` }, ADMIN);
  return c;
}

// Fictional test companies; the real list is checked for shape only.
const plan: CleanupPlan = {
  reason: "Test cleanup.",
  remove: [{ domain: "beach-test.example", name: "Beach Test", why: "Local service" }],
  fix: [
    { domain: "canvas-test.example", name: "Canvas", why: "Name was the page title" },
    { domain: "gtm-test.example", categories: ["ai-agents"], why: "Wrong tag" },
  ],
};

describe("data cleanup", () => {
  it("removes, corrects and repairs HTML codes once, keeping corrected companies verified", async () => {
    const beach = await verified("Beach Test", "beach-test.example", ["mcp"]);
    const canvas = await verified("Canvas · The design canvas for your AI", "canvas-test.example", ["mcp"]);
    const gtm = await verified("GTM Test", "gtm-test.example", ["mcp"]);
    const codes = await verified("Codes Test", "codes-test.example", ["sdk"], "Worried that you&#x27;re slow?");

    const before = await previewCleanup(env.DB, plan);
    expect(before.remove[0]).toMatchObject({ found: true, done: false });
    expect(before.fix.map((f) => f.changes.map((c) => c.field))).toEqual([["name"], ["categories"]]);
    expect(before.codes).toContain("Codes Test");

    expect(await applyCleanup(env.DB, ADMIN, plan)).toMatchObject({ removed: 1, fixed: 2 });
    expect((await getCompany(env.DB, beach.id))?.status).toBe("rejected");
    const c2 = await getCompany(env.DB, canvas.id);
    expect(c2).toMatchObject({ name: "Canvas", status: "verified" });
    expect((await getCompany(env.DB, gtm.id))?.categories.map((c) => c.slug)).toEqual(["ai-agents"]);
    expect((await getCompany(env.DB, codes.id))?.description).toBe("Worried that you're slow?");

    const after = await previewCleanup(env.DB, plan);
    expect([...after.remove, ...after.fix].every((x) => x.done)).toBe(true);
    expect(after.codes).toEqual([]);
    expect(await applyCleanup(env.DB, ADMIN, plan)).toEqual({ removed: 0, fixed: 0, repaired: 0 });
  });

  it("the approved list keeps The Product Compass and Getlead, and the back office can read it", async () => {
    const domains = CLEANUP_REMOVE.map((r) => r.domain);
    expect(domains).toHaveLength(30);
    expect(domains).not.toContain("productcompass.pm");
    expect(domains).not.toContain("getle.ad");
    expect(CLEANUP_FIX.map((f) => f.domain)).toContain("modelcontextprotocol.io");
    const res = await call("/api/admin/cleanup", { headers: { "Cf-Access-Jwt-Assertion": await token() } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { remove: unknown[] }).remove).toHaveLength(30);
  });
});
