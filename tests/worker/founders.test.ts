import { env } from "cloudflare:workers";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createApp } from "../../worker/app.ts";
import type { Env } from "../../worker/env.ts";
import { call } from "./helpers.ts";

const APP_ID = "test-privy-app";
const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "p1", alg: "ES256" }] });
const app = createApp({ privyKey: () => jwks });
const testEnv = () => ({ ...env, PRIVY_APP_ID: APP_ID }) as unknown as Env;

let n = 0;
async function idToken(accounts: unknown[], opts: { aud?: string; iss?: string; sub?: string } = {}) {
  n += 1;
  return new SignJWT({ linked_accounts: JSON.stringify(accounts) })
    .setProtectedHeader({ alg: "ES256", kid: "p1" })
    .setSubject(opts.sub ?? `did:privy:test${n}`)
    .setIssuer(opts.iss ?? "privy.io")
    .setAudience(opts.aud ?? APP_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return app.fetch(new Request(`https://rightroom.example/api/app${path}`, { ...init, headers }), testEnv());
}
const signIn = (token: string) => req("/session", { method: "POST", body: JSON.stringify({ identity_token: token }) });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

async function invite(body: Record<string, string>) {
  const res = await call("/api/admin/access-requests", { method: "POST", body: JSON.stringify(body) });
  expect(res.status).toBe(201);
}

describe("founder sign-in", () => {
  it("says 'not invited' (and sets no session) for someone not on the list", async () => {
    const res = await signIn(await idToken([{ type: "email", address: "stranger@test.example" }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not_invited", identity: { email: "stranger@test.example" } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("lets an invited Google user in with a secure session cookie", async () => {
    await invite({ email: "ada@test.example" });
    const res = await signIn(await idToken([{ type: "google_oauth", email: "Ada@Test.example", name: "Ada Test" }]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; founder: { name: string; onboarding_step: number } };
    expect(body).toMatchObject({ status: "active", founder: { name: "Ada Test", onboarding_step: 1 } });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-rr_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    const me = await req("/me", { cookie: cookieOf(res) });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { founder: { email: string } }).founder.email).toBe("ada@test.example");
  });

  it("matches X sign-ins by handle", async () => {
    await invite({ x_handle: "@SamTest" });
    const res = await signIn(await idToken([{ type: "twitter_oauth", username: "samtest", name: "Sam" }]));
    expect(((await res.json()) as { status: string }).status).toBe("active");
  });

  it("rejects tokens for another app, from another issuer, or tampered", async () => {
    await invite({ email: "eve@test.example" });
    const accounts = [{ type: "email", address: "eve@test.example" }];
    expect((await signIn(await idToken(accounts, { aud: "other-app" }))).status).toBe(401);
    expect((await signIn(await idToken(accounts, { iss: "evil.example" }))).status).toBe(401);
    const good = await idToken(accounts);
    expect((await signIn(`${good.slice(0, -4)}AAAA`)).status).toBe(401);
  });

  it("only accepts changes from this site, as JSON", async () => {
    const token = await idToken([{ type: "email", address: "x@test.example" }]);
    const cross = await req("/session", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      body: JSON.stringify({ identity_token: token }),
    });
    expect(cross.status).toBe(403);
    // The Vercel copy forwards /api here; its address arrives as x-forwarded-host.
    const viaVercel = await req("/session", {
      method: "POST",
      headers: { origin: "https://rightroom.vercel.app", "x-forwarded-host": "rightroom.vercel.app" },
      body: JSON.stringify({ identity_token: token }),
    });
    expect(viaVercel.status).toBe(200);
    const form = await req("/session", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "identity_token=x",
    });
    expect(form.status).toBe(400);
  });
});

describe("onboarding, sign-out and delete", () => {
  async function founder() {
    n += 1;
    const email = `founder${n}@test.example`;
    await invite({ email });
    const res = await signIn(await idToken([{ type: "email", address: email }]));
    return cookieOf(res);
  }

  it("saves each step and finishes onboarding", async () => {
    const cookie = await founder();
    const put = (body: unknown) => req("/profile", { method: "PUT", cookie, body: JSON.stringify(body) });
    expect((await put({ name: "Ada", role: "CEO", step: 2 })).status).toBe(200);
    expect((await put({ website: "exampleco.dev", one_liner: "Payments API", buyers: "SMEs", step: 3 })).status).toBe(
      200,
    );
    expect((await put({ goals: ["integrations", "distribution"], step: 4 })).status).toBe(200);
    const done = await put({ markets: ["nigeria", "uk"], step: 5 });
    const view = (await done.json()) as {
      founder: { onboarding_step: number; onboarded_at: string | null };
      profile: { website: string; goals: string[]; markets: string[] };
    };
    expect(view.founder.onboarding_step).toBe(5);
    expect(view.founder.onboarded_at).not.toBeNull();
    expect(view.profile).toMatchObject({
      website: "https://exampleco.dev",
      goals: ["integrations", "distribution"],
      markets: ["nigeria", "uk"],
    });
    expect((await put({ goals: ["parties"] })).status).toBe(400);
    expect((await put({ step: 2 })).status).toBe(200);
    expect(
      ((await (await req("/me", { cookie })).json()) as { founder: { onboarding_step: number } }).founder
        .onboarding_step,
    ).toBe(5);
  });

  it("needs a session for founder pages", async () => {
    expect((await req("/me")).status).toBe(401);
    expect((await req("/me", { cookie: "__Host-rr_session=made-up" })).status).toBe(401);
  });

  it("signs out", async () => {
    const cookie = await founder();
    expect((await req("/signout", { method: "POST", cookie, body: "{}" })).status).toBe(200);
    expect((await req("/me", { cookie })).status).toBe(401);
  });

  it("deletes the account and everything in its workspace", async () => {
    const cookie = await founder();
    const me = (await (await req("/me", { cookie })).json()) as { founder: { id: string } };
    expect((await req("/account", { method: "DELETE", cookie })).status).toBe(200);
    expect((await req("/me", { cookie })).status).toBe(401);
    const left = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM founders WHERE id = ?1) + (SELECT COUNT(*) FROM founder_sessions WHERE founder_id = ?1) AS n",
    )
      .bind(me.founder.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("also deletes the founder's original access request", async () => {
    n += 1;
    const email = `leaving${n}@test.example`;
    await invite({ email });
    const res = await signIn(await idToken([{ type: "email", address: email }]));
    const cookie = cookieOf(res);
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE email = ?")
      .bind(email)
      .first<{ n: number }>();
    expect(before?.n).toBe(1);
    expect((await req("/account", { method: "DELETE", cookie })).status).toBe(200);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE email = ?")
      .bind(email)
      .first<{ n: number }>();
    expect(after?.n).toBe(0);
  });
});

describe("request access after signing in", () => {
  it("attaches the X handle from the token", async () => {
    const token = await idToken([{ type: "twitter_oauth", username: "newperson", name: "New Person" }]);
    const res = await req("/request-access", {
      method: "POST",
      body: JSON.stringify({ identity_token: token, goal: "Distribution partners for our agent SDK." }),
    });
    expect(res.status).toBe(202);
    const row = await env.DB.prepare(
      "SELECT name, email, x_handle, status FROM access_requests WHERE x_handle = 'newperson'",
    ).first();
    expect(row).toEqual({ name: "New Person", email: null, x_handle: "newperson", status: "new" });
  });
});

describe("admin view of founders", () => {
  it("lists founders who signed up", async () => {
    const res = await call("/api/admin/founders");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { founders: unknown[] }).founders.length).toBeGreaterThan(0);
    expect((await call("/api/admin/founders", { as: null })).status).toBe(401);
  });
});
