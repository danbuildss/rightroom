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
import { GOALS, profileUpdateSchema } from "../../shared/founder.ts";
import { isInvited, submitAccessRequest, TooManyRequestsError } from "../db/access.ts";
import { discover } from "../db/discover.ts";
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

const requestSchema = tokenSchema.extend({
  goal: z.string().trim().min(10, "Tell us a little more about the partnership you're after.").max(1000),
  website: z.string().trim().max(300).optional(),
});

export interface FounderAppOptions {
  /** Override Privy's signing keys (tests). */
  privyKey?: (env: Env) => JWTVerifyGetKey;
}

/** Changes are only accepted from pages on this site, sent as JSON (blocks cross-site form posts). */
const sameSite: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== new URL(c.req.url).host) {
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
