import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import { call, founderSession } from "./helpers.ts";

// D1 refuses a query with more than 100 values. Founder pages broke in production once the
// database passed 100 verified companies (test data, fictional names).
describe("more than 100 verified companies", () => {
  it("founder pages still load", async () => {
    let last = "";
    for (let i = 1; i <= 120; i++) {
      const c = await createCompany(
        env.DB,
        companyInputSchema.parse({
          name: `Many Co ${i}`,
          domain: `many${i}.example`,
          categories: ["payments"],
          aliases: i === 120 ? [{ kind: "x_handle", value: "manyco120" }] : [],
        }),
        "admin@talo.example",
      );
      await reviewCompany(
        env.DB,
        c.id,
        { action: "verify", checked_url: `https://${c.primary_domain}` },
        "admin@talo.example",
      );
      last = c.slug;
    }
    const { cookie } = await founderSession();
    for (const path of ["/api/app/home", "/api/app/explore", "/api/app/discover", `/api/app/companies/${last}`]) {
      const res = await call(path, { as: null, headers: { cookie } });
      expect(res.status, path).toBe(200);
    }
    const res = await call("/api/app/explore?q=Many%20Co%20120", { as: null, headers: { cookie } });
    const card = ((await res.json()) as { results: { links: { x: string | null } }[] }).results[0];
    expect(card?.links.x).toBe("https://x.com/manyco120");
    expect((await call("/api/public/companies?limit=100", { as: null })).status).toBe(200);
  }, 60_000);
});
