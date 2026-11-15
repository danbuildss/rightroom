import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call } from "./helpers.ts";

let n = 0;
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
const patch = (path: string, body: unknown) => call(path, { method: "PATCH", body: JSON.stringify(body) });

/** Import one fictional company, optionally with a suggested profile, and return its id. */
async function importCompany(profile: Record<string, unknown> = {}) {
  n += 1;
  const domain = `profile-co-${n}.example`;
  const res = await post("/api/admin/import", {
    format: "talo.registry.v1",
    companies: [
      { name: `Profile Co ${n} (fictional)`, domain, categories: ["ai-agents"], is_sample: true, ...profile },
    ],
  });
  expect(res.status).toBeLessThan(300);
  const list = (await (await call(`/api/admin/companies?q=${domain}`)).json()) as {
    companies: { id: string; profile_status: string; org_type: string | null; audiences: string[] }[];
  };
  return list.companies[0]!;
}

describe("company profile (Explore labels)", () => {
  it("an imported profile is only a suggestion", async () => {
    const c = await importCompany({
      org_type: "platform_api",
      audiences: ["developers", "developers"],
      stage: "growth",
    });
    expect(c.profile_status).toBe("suggested");
    expect(c.org_type).toBe("platform_api");
    expect(c.audiences).toEqual(["developers"]);
    const plain = await importCompany();
    expect(plain.profile_status).toBe("empty");
  });

  it("refuses unknown types, stages and country codes", async () => {
    const bad = await post("/api/admin/import", {
      format: "talo.registry.v1",
      companies: [
        { name: "Bad Profile (fictional)", domain: "bad-profile.example", org_type: "bank", is_sample: true },
      ],
    });
    expect(bad.status).toBe(400);
    const c = await importCompany();
    expect((await patch(`/api/admin/companies/${c.id}`, { hq_country: "Nigeria" })).status).toBe(400);
    expect((await patch(`/api/admin/companies/${c.id}`, { stage: "unicorn" })).status).toBe(400);
  });

  it("editing the profile confirms it, records who did it, and doesn't reopen review", async () => {
    const c = await importCompany({ org_type: "ecosystem" });
    await env.DB.prepare(
      "UPDATE companies SET status = 'verified', last_verified_at = '2026-11-15T00:00:00Z' WHERE id = ?",
    )
      .bind(c.id)
      .run();
    const res = await patch(`/api/admin/companies/${c.id}`, { org_type: "platform_api", hq_country: "ng" });
    const body = (await res.json()) as {
      reopened: boolean;
      company: {
        status: string;
        org_type: string;
        hq_country: string;
        profile_status: string;
        profile_confirmed_by: string;
      };
    };
    expect(res.status).toBe(200);
    expect(body.reopened).toBe(false);
    expect(body.company).toMatchObject({
      status: "verified",
      org_type: "platform_api",
      hq_country: "NG",
      profile_status: "confirmed",
      profile_confirmed_by: "admin@talo.example",
    });
  });

  it("confirms suggestions in a batch, skipping empty ones", async () => {
    const a = await importCompany({ org_type: "startup_product" });
    const b = await importCompany({ org_type: "ecosystem" });
    const empty = await importCompany();
    const res = await post("/api/admin/companies/profiles/confirm", { ids: [a.id, b.id, empty.id] });
    expect(await res.json()).toEqual({ confirmed: 2 });
    const left = (await (await call("/api/admin/companies?profile=suggested&limit=200")).json()) as {
      companies: { id: string }[];
    };
    expect(left.companies.map((x) => x.id)).not.toContain(a.id);
  });

  it("the database refuses a lowercase or long country code", async () => {
    const c = await importCompany();
    await expect(
      env.DB.prepare("UPDATE companies SET hq_country = 'usa' WHERE id = ?").bind(c.id).run(),
    ).rejects.toThrow();
  });
});
