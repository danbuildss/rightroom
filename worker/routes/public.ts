/**
 * Public Discover API: read-only, no login, verified records only (worker/db/public.ts).
 * Responses can be cached for a minute, which also keeps load low.
 */
import { Hono } from "hono";
import { z } from "zod";
import { SIGNAL_TYPE_SLUGS } from "../../shared/signals.ts";
import { getLogo } from "../db/logos.ts";
import { getPublicCompany, listPublicCompanies, listPublicSignals, publicCategories } from "../db/public.ts";
import type { AppEnv } from "../env.ts";
import { jsonError } from "../http.ts";

const page = {
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(10_000).optional(),
};
const companyQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().max(60).optional(),
  ...page,
});
const signalQuery = z.object({
  type: z.enum(SIGNAL_TYPE_SLUGS).optional(),
  category: z.string().max(60).optional(),
  ...page,
});

export const publicApi = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    await next();
    if (c.res.status === 200 && !c.res.headers.has("Cache-Control"))
      c.res.headers.set("Cache-Control", "public, max-age=60");
  })
  .get("/categories", async (c) => c.json({ categories: await publicCategories(c.env.DB) }))
  .get("/companies", async (c) => {
    const q = companyQuery.safeParse(c.req.query());
    if (!q.success) return jsonError(c, 400, "invalid_request", "Invalid filters.");
    return c.json({ companies: await listPublicCompanies(c.env.DB, q.data) });
  })
  .get("/companies/:slug", async (c) => {
    const company = await getPublicCompany(c.env.DB, c.req.param("slug"));
    return company ? c.json({ company }) : jsonError(c, 404, "not_found", "Company not found.");
  })
  // A verified company's stored logo (raster only), served from our domain. Versioned URLs, so cache long.
  .get("/logos/:slug", async (c) => {
    const logo = await getLogo(c.env.DB, c.req.param("slug"));
    if (!logo) return jsonError(c, 404, "not_found", "No logo.");
    return new Response(logo.bytes, {
      headers: {
        "Content-Type": logo.type,
        "Cache-Control": "public, max-age=604800",
      },
    });
  })
  .get("/signals", async (c) => {
    const q = signalQuery.safeParse(c.req.query());
    if (!q.success) return jsonError(c, 400, "invalid_request", "Invalid filters.");
    return c.json({ signals: await listPublicSignals(c.env.DB, q.data) });
  });
