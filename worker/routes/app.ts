/**
 * Founder app API (/api/app). Sign-in happens in the browser through Privy; the browser
 * sends Privy's signed identity token here once, and gets Rightroom's own session cookie.
 *
 * - Only invited founders (email or X handle on Dan's invited list) get a session.
 * - The cookie is HttpOnly, Secure, SameSite=Lax; only its hash is stored.
 * - Changes must come from this site (Origin check) as JSON.
 */
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { buildDraft, draftPatchSchema, draftSaveSchema, VARIANTS } from "../../shared/draft.ts";
import { GOALS, profileUpdateSchema } from "../../shared/founder.ts";
import { pipelinePatchSchema } from "../../shared/pipeline.ts";
import { isInvited, submitAccessRequest, TooManyRequestsError } from "../db/access.ts";
import { companyIntel, discover } from "../db/discover.ts";
import { deleteDraft, listDrafts, saveDraft, updateDraft, verifiedCompanyId } from "../db/drafts.ts";
import {
  createSession,
  deleteFounderWorkspace,
  endSession,
  findFounderByDid,
  getFounderView,
  SESSION_DAYS,
  sessionFounder,
  updateProfile,
  upsertFounder,
} from "../db/founders.ts";
import { listPipeline, recordSent, removeSaved, saveCompany, timeline, updateSaved } from "../db/pipeline.ts";
import { NotFoundError } from "../db/util.ts";
import type { AppEnv, Env } from "../env.ts";
import { jsonError } from "../http.ts";
import { PrivyTokenError, verifyIdentityToken } from "../privy.ts";

export const SESSION_COOKIE = "__Host-rr_session";

const tokenSchema = z.object({ identity_token: z.string().min(20).max(20_000) });
const list = (max: number) =>
  z
    .string()
    .max(500)
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, max),
    );
const discoverQuery = z.object({
  q: z.string().max(500).default(""),
  cats: list(20).optional(),
  goals: list(4)
    .pipe(z.array(z.enum(GOALS)))
    .optional(),
  category: z.string().max(60).optional(),
});

const draftQuery = z.object({
  variant: z.enum(VARIANTS).default("first"),
  to: z.union([z.literal("team"), z.coerce.number().int().min(0).max(20)]).optional(),
  via: z.coerce.number().int().min(0).max(20).optional(),
});

const requestSchema = tokenSchema.extend({
  goal: z.string().trim().min(10, "Tell us a little more about the partnership you're after.").max(1000),
  website: z.string().trim().max(300).optional(),
});

export interface FounderAppOptions {
  /** Override Privy's signing keys (tests). */
  privyKey?: (env: Env) => JWTVerifyGetKey;
}

/**
 * The site is also served from Vercel, which forwards /api here; the browser's Origin is then the
 * Vercel address. Accept the Worker's own host, the host Vercel says it forwarded from, and any
 * host listed in APP_ORIGIN_HOSTS. JSON-only bodies mean other sites can't post here anyway.
 */
function allowedOrigin(origin: string, c: Context<AppEnv>): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set(
    [new URL(c.req.url).host, c.req.header("x-forwarded-host") ?? "", ...(c.env.APP_ORIGIN_HOSTS ?? "").split(",")]
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(host.toLowerCase());
}

/** Changes are only accepted from pages on this site, sent as JSON (blocks cross-site form posts). */
const sameSite: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    if (origin && !allowedOrigin(origin, c)) {
      return jsonError(c, 403, "forbidden", "Requests must come from Rightroom.");
    }
    if (c.req.method !== "DELETE" && !(c.req.header("content-type") ?? "").includes("application/json")) {
      return jsonError(c, 400, "invalid_request", "Send JSON.");
    }
  }
  await next();
};

const requireFounder: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const founder = token ? await sessionFounder(c.env.DB, token) : null;
  if (!founder) return jsonError(c, 401, "unauthenticated", "Please sign in.");
  c.set("founder", founder);
  await next();
};

async function readBody<T extends z.ZodType>(c: Context<AppEnv>, schema: T) {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Some fields are invalid.",
      parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    );
  }
  return parsed.data as z.infer<T>;
}

export function founderApp(options: FounderAppOptions = {}) {
  const verify = (c: Context<AppEnv>, token: string) => verifyIdentityToken(token, c.env, options.privyKey?.(c.env));

  return (
    new Hono<AppEnv>()
      .use("*", bodyLimit({ maxSize: 32 * 1024, onError: (c) => jsonError(c, 413, "invalid_request", "Too large.") }))
      .use("*", sameSite)

      // Exchange Privy's identity token for a Rightroom session, if invited.
      .post("/session", async (c) => {
        const body = await readBody(c, tokenSchema);
        if (body instanceof Response) return body;
        let who: Awaited<ReturnType<typeof verify>>;
        try {
          who = await verify(c, body.identity_token);
        } catch (err) {
          if (err instanceof PrivyTokenError) return jsonError(c, 401, "unauthenticated", err.message);
          throw err;
        }
        const known = await findFounderByDid(c.env.DB, who.did);
        if (!known && !(await isInvited(c.env.DB, who.emails, who.x_handle))) {
          return c.json({
            status: "not_invited",
            identity: { name: who.name, email: who.emails[0] ?? null, x_handle: who.x_handle },
          });
        }
        const founder = await upsertFounder(c.env.DB, who);
        const token = await createSession(c.env.DB, founder);
        setCookie(c, SESSION_COOKIE, token, {
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
          path: "/",
          maxAge: SESSION_DAYS * 24 * 60 * 60,
        });
        return c.json({ status: "active", ...(await getFounderView(c.env.DB, founder.workspace_id)) });
      })

      // Someone signed in but not invited asks for access; their identity comes from the token.
      .post("/request-access", async (c) => {
        const body = await readBody(c, requestSchema);
        if (body instanceof Response) return body;
        try {
          const who = await verify(c, body.identity_token);
          await submitAccessRequest(c.env.DB, {
            name: who.name ?? who.emails[0] ?? `@${who.x_handle}`,
            email: who.emails[0] ?? null,
            x_handle: who.x_handle,
            website: body.website || null,
            goal: body.goal,
          });
          return c.json({ ok: true }, 202);
        } catch (err) {
          if (err instanceof PrivyTokenError) return jsonError(c, 401, "unauthenticated", err.message);
          if (err instanceof TooManyRequestsError) {
            return jsonError(c, 429, "rate_limited", "We're getting a lot of requests. Please try again in an hour.");
          }
          throw err;
        }
      })

      .get("/me", requireFounder, async (c) => {
        const view = await getFounderView(c.env.DB, c.get("founder").workspace_id);
        return view ? c.json(view) : jsonError(c, 401, "unauthenticated", "Please sign in.");
      })

      // Ranked verified companies for this founder (rule-based, no AI).
      .get("/discover", requireFounder, async (c) => {
        const q = discoverQuery.safeParse(c.req.query());
        if (!q.success) return jsonError(c, 400, "invalid_request", "Invalid search.");
        return c.json(
          await discover(c.env.DB, c.get("founder").workspace_id, {
            q: q.data.q,
            categories: q.data.cats,
            goals: q.data.goals,
            category: q.data.category,
          }),
        );
      })

      .get("/companies/:slug", requireFounder, async (c) => {
        const intel = await companyIntel(c.env.DB, c.get("founder").workspace_id, c.req.param("slug"));
        return intel ? c.json(intel) : jsonError(c, 404, "not_found", "Company not found.");
      })

      // A fresh draft from the templates (not saved). Uses verified facts and the founder's answers only.
      .get("/companies/:slug/draft", requireFounder, async (c) => {
        const q = draftQuery.safeParse(c.req.query());
        if (!q.success) return jsonError(c, 400, "invalid_request", "Invalid draft options.");
        const ws = c.get("founder").workspace_id;
        const intel = await companyIntel(c.env.DB, ws, c.req.param("slug"));
        if (!intel) return jsonError(c, 404, "not_found", "Company not found.");
        const me = await c.env.DB.prepare(
          `SELECT f.name, f.role, p.company_name, p.one_liner, p.website FROM founders f
           LEFT JOIN founder_profiles p ON p.workspace_id = f.workspace_id WHERE f.workspace_id = ?`,
        )
          .bind(ws)
          .first<{
            name: string | null;
            role: string | null;
            company_name: string | null;
            one_liner: string | null;
            website: string | null;
          }>();
        const person = q.data.to === "team" ? null : (intel.people[q.data.to ?? 0] ?? null);
        const channel = q.data.via === undefined ? intel.channels[0] : intel.channels[q.data.via];
        const signal = intel.company.signals.find((s) => s.status === "verified") ?? null;
        const goal = (intel.goals[0] ?? "integrations") as (typeof GOALS)[number];
        const draft = buildDraft({
          variant: q.data.variant,
          goal,
          founder: me ?? { name: null, role: null, company_name: null, one_liner: null, website: null },
          company: { name: intel.company.name },
          recipientName: person?.name ?? null,
          signal: signal ? { type: signal.type as never, event_date: signal.event_date } : null,
        });
        const sources = [
          ...(signal
            ? [
                {
                  kind: "verified",
                  text: `${signal.type_label}${
                    signal.event_date
                      ? ` · ${new Date(`${signal.event_date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
                      : ""
                  }`,
                  url: signal.sources.find((x) => x.role === "primary")?.url ?? null,
                },
              ]
            : []),
          ...(person ? [{ kind: "verified", text: `${person.name}, ${person.role}`, url: person.source_url }] : []),
          ...(me?.one_liner ? [{ kind: "yours", text: `Your answers: “${me.one_liner}”`, url: null }] : []),
        ];
        return c.json({
          ...draft,
          variant: q.data.variant,
          recipient: person
            ? `${person.name} · ${person.role}`
            : `${intel.company.name} team (${intel.suggestions.suggested_role})`,
          channel: channel
            ? { label: channel.label, url: channel.url }
            : { label: "Website", url: `https://${intel.company.domain}` },
          options: {
            people: intel.people.map((p, i) => ({ index: i, label: `${p.name} · ${p.role}` })),
            channels: intel.channels.map((ch, i) => ({ index: i, label: ch.label, url: ch.url })),
          },
          sources,
        });
      })

      .get("/companies/:slug/drafts", requireFounder, async (c) => {
        const id = await verifiedCompanyId(c.env.DB, c.req.param("slug"));
        if (!id) return jsonError(c, 404, "not_found", "Company not found.");
        return c.json({ drafts: await listDrafts(c.env.DB, c.get("founder").workspace_id, id) });
      })
      .post("/companies/:slug/drafts", requireFounder, async (c) => {
        const id = await verifiedCompanyId(c.env.DB, c.req.param("slug"));
        if (!id) return jsonError(c, 404, "not_found", "Company not found.");
        const body = await readBody(c, draftSaveSchema);
        if (body instanceof Response) return body;
        return c.json({ draft: await saveDraft(c.env.DB, c.get("founder").workspace_id, id, body) }, 201);
      })
      .patch("/drafts/:id", requireFounder, async (c) => {
        const body = await readBody(c, draftPatchSchema);
        if (body instanceof Response) return body;
        try {
          const ws = c.get("founder").workspace_id;
          const draft = await updateDraft(c.env.DB, ws, c.req.param("id"), body);
          if (body.status === "sent") {
            const row = await c.env.DB.prepare(
              "SELECT company_id FROM founder_drafts WHERE id = ? AND workspace_id = ?",
            )
              .bind(draft.id, ws)
              .first<{ company_id: string }>();
            if (row) await recordSent(c.env.DB, ws, row.company_id, draft.channel_label);
          }
          return c.json({ draft });
        } catch (err) {
          if (err instanceof NotFoundError) return jsonError(c, 404, "not_found", err.message);
          throw err;
        }
      })
      .delete("/drafts/:id", requireFounder, async (c) => {
        try {
          await deleteDraft(c.env.DB, c.get("founder").workspace_id, c.req.param("id"));
          return c.json({ ok: true });
        } catch (err) {
          if (err instanceof NotFoundError) return jsonError(c, 404, "not_found", err.message);
          throw err;
        }
      })

      // Pipeline: saved companies, stages, follow-ups (reminders only), notes and a timeline.
      .post("/companies/:slug/save", requireFounder, async (c) => {
        const id = await verifiedCompanyId(c.env.DB, c.req.param("slug"));
        if (!id) return jsonError(c, 404, "not_found", "Company not found.");
        return c.json({ saved: await saveCompany(c.env.DB, c.get("founder").workspace_id, id) }, 201);
      })
      .get("/pipeline", requireFounder, async (c) => {
        const items = await listPipeline(c.env.DB, c.get("founder").workspace_id);
        const today = new Date().toISOString().slice(0, 10);
        return c.json({
          items,
          due: items.filter((i) => i.follow_up_at && i.follow_up_at <= today && i.stage !== "partnered").length,
          today,
        });
      })
      .get("/pipeline/:id/timeline", requireFounder, async (c) => {
        try {
          return c.json({ events: await timeline(c.env.DB, c.get("founder").workspace_id, c.req.param("id")) });
        } catch (err) {
          if (err instanceof NotFoundError) return jsonError(c, 404, "not_found", err.message);
          throw err;
        }
      })
      .patch("/pipeline/:id", requireFounder, async (c) => {
        const body = await readBody(c, pipelinePatchSchema);
        if (body instanceof Response) return body;
        try {
          return c.json({ saved: await updateSaved(c.env.DB, c.get("founder").workspace_id, c.req.param("id"), body) });
        } catch (err) {
          if (err instanceof NotFoundError) return jsonError(c, 404, "not_found", err.message);
          throw err;
        }
      })
      .delete("/pipeline/:id", requireFounder, async (c) => {
        try {
          await removeSaved(c.env.DB, c.get("founder").workspace_id, c.req.param("id"));
          return c.json({ ok: true });
        } catch (err) {
          if (err instanceof NotFoundError) return jsonError(c, 404, "not_found", err.message);
          throw err;
        }
      })

      .put("/profile", requireFounder, async (c) => {
        const update = await readBody(c, profileUpdateSchema);
        if (update instanceof Response) return update;
        return c.json(await updateProfile(c.env.DB, c.get("founder").workspace_id, update));
      })

      .post("/signout", requireFounder, async (c) => {
        await endSession(c.env.DB, c.get("founder").session_id);
        deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
        return c.json({ ok: true });
      })

      // Deletes everything Rightroom stores about this founder.
      .delete("/account", requireFounder, async (c) => {
        await deleteFounderWorkspace(c.env.DB, c.get("founder").workspace_id);
        deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
        return c.json({ ok: true });
      })
  );
}
