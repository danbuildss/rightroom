import type { Context, MiddlewareHandler } from "hono";

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_configured"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "rate_limited"
  | "internal";

/** Every error response has the same shape: { error: { code, message, details? } }. */
export function jsonError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 503,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  return c.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
}

/** Security headers on every API response (the site's own headers are in site/_headers). */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "no-referrer");
  // Private by default; public Discover routes opt in to short caching.
  if (!h.has("Cache-Control")) h.set("Cache-Control", "no-store");
};
