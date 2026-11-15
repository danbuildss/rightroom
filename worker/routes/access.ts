/**
 * Public: the marketing site's Request access form posts here (no login).
 * JSON gets a JSON answer; a plain form post (no JavaScript) is sent on to /thanks.html.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { accessRequestSchema } from "../../shared/access.ts";
import { submitAccessRequest, TooManyRequestsError } from "../db/access.ts";
import type { AppEnv } from "../env.ts";
import { jsonError } from "../http.ts";

export const accessApi = new Hono<AppEnv>().post(
  "/",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => jsonError(c, 413, "invalid_request", "Request body is too large."),
  }),
  async (c) => {
    const isJson = (c.req.header("content-type") ?? "").includes("application/json");
    const raw = isJson ? await c.req.json().catch(() => undefined) : await c.req.parseBody().catch(() => undefined);
    if (raw === undefined || raw === null || typeof raw !== "object") {
      return jsonError(c, 400, "invalid_request", "Please fill in the form.");
    }
    const parsed = accessRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return jsonError(
        c,
        400,
        "invalid_request",
        first?.message ?? "Some fields are invalid.",
        parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
      );
    }
    // A filled-in honeypot is a bot: answer as if it worked, store nothing.
    if (!parsed.data.company_fax) {
      try {
        await submitAccessRequest(c.env.DB, parsed.data);
      } catch (err) {
        if (err instanceof TooManyRequestsError) {
          return jsonError(c, 429, "rate_limited", "We're getting a lot of requests. Please try again in an hour.");
        }
        throw err;
      }
    }
    return isJson ? c.json({ ok: true }, 202) : c.redirect("/thanks.html", 303);
  },
);
