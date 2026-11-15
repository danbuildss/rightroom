import { env } from "cloudflare:workers";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { createApp } from "../../worker/app.ts";
import type { Env } from "../../worker/env.ts";

export const TEAM = "talo-test.cloudflareaccess.com";
export const AUD = "test-audience";
export const ADMIN = "admin@talo.example";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" }] });

/** The app wired to a local test key set instead of Cloudflare's. */
export const app = createApp({ getKey: () => jwks });

/** The same, with a fake web for pages the Worker fetches. */
export function appWithFetcher(fetcher: typeof fetch) {
  return createApp({ getKey: () => jwks, fetcher });
}

export async function token(
  claims: JWTPayload = {},
  opts: { key?: CryptoKey; exp?: string; iss?: string; aud?: string } = {},
) {
  return new SignJWT({ email: ADMIN, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);
}

export async function call(
  path: string,
  init: RequestInit & { as?: string | null } = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.as !== null) headers.set("Cf-Access-Jwt-Assertion", init.as ?? (await token()));
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(new Request(`https://talo.example${path}`, { ...init, headers }), { ...env, ...overrides } as Env);
}

let founderN = 0;
/** A signed-in founder with a private workspace and profile (test data). Returns the cookie and workspace id. */
export async function founderSession(
  profile: {
    one_liner?: string;
    goals?: string[];
    name?: string;
    role?: string;
    company_name?: string;
    website?: string;
  } = {},
) {
  founderN += 1;
  const ws = `ws-test-founder-${founderN}-${crypto.randomUUID().slice(0, 8)}`;
  const token = `test-founder-session-${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const at = new Date().toISOString();
  const far = new Date(Date.now() + 86_400_000).toISOString();
  const fid = `f-${ws}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO workspaces (id, name, owner_email, created_at) VALUES (?, 'Test founder', 'f@test.example', ?)",
    ).bind(ws, at),
    env.DB.prepare(
      "INSERT INTO founders (id, workspace_id, privy_did, name, role, created_at, last_sign_in_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(fid, ws, `did:privy:${ws}`, profile.name ?? "Ada Test", profile.role ?? "CEO", at, at),
    env.DB.prepare(
      "INSERT INTO founder_profiles (workspace_id, company_name, website, one_liner, goals_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      ws,
      profile.company_name ?? "Test Co",
      profile.website ?? "https://testco.example",
      profile.one_liner ?? "Payments API for small businesses",
      JSON.stringify(profile.goals ?? ["integrations"]),
      at,
    ),
    env.DB.prepare(
      "INSERT INTO founder_sessions (id, workspace_id, founder_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(hash, ws, fid, at, far),
  ]);
  return { cookie: `__Host-rr_session=${token}`, workspaceId: ws };
}
