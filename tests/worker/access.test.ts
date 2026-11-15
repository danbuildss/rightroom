import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { HOURLY_LIMIT } from "../../worker/db/access.ts";
import type { Env } from "../../worker/env.ts";
import { app, call } from "./helpers.ts";

let n = 0;
const form = (over: Record<string, string> = {}) => {
  n += 1;
  return {
    name: "Test Founder",
    email: `founder${n}@test.example`,
    website: "test.example",
    goal: "Integration partners for our payments API.",
    ...over,
  };
};
const submit = (body: unknown) =>
  call("/api/public/access-requests", { method: "POST", as: null, body: JSON.stringify(body) });

async function stored(email: string) {
  return env.DB.prepare("SELECT * FROM access_requests WHERE email = ?").bind(email).first<Record<string, unknown>>();
}

describe("Request access (public)", () => {
  it("saves a request without login and normalises the website and email", async () => {
    const f = form({ email: `Mixed.Case${n}@Test.Example` });
    const res = await submit(f);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const row = await stored(f.email.toLowerCase());
    expect(row).toMatchObject({ name: "Test Founder", website: "https://test.example", status: "new" });
  });

  it("explains what's wrong with invalid input", async () => {
    const res = await submit(form({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Enter a valid email address.");
    expect((await submit(form({ goal: "hi" }))).status).toBe(400);
    expect((await submit(form({ website: "javascript:alert(1)" }))).status).toBe(400);
  });

  it("does not duplicate, and gives the same answer, when the same email sends again", async () => {
    const f = form();
    await submit(f);
    const again = await submit({ ...f, goal: "Distribution partners in Nigeria and the UK." });
    expect(again.status).toBe(202);
    const { results } = await env.DB.prepare("SELECT goal FROM access_requests WHERE email = ?").bind(f.email).all();
    expect(results).toEqual([{ goal: "Distribution partners in Nigeria and the UK." }]);
  });

  it("stores nothing when the hidden honeypot field is filled", async () => {
    const f = form({ company_fax: "123" });
    expect((await submit(f)).status).toBe(202);
    expect(await stored(f.email)).toBeNull();
  });

  it("sends a plain form post (no JavaScript) on to the thanks page", async () => {
    const f = form();
    const res = await app.fetch(
      new Request("https://talo.example/api/public/access-requests", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(f).toString(),
      }),
      env as unknown as Env,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/thanks.html");
    expect(await stored(f.email)).not.toBeNull();
  });

  it("slows down when too many requests arrive in an hour", async () => {
    await env.DB.prepare("DELETE FROM access_requests").run();
    const at = new Date().toISOString();
    const insert = env.DB.prepare(
      "INSERT INTO access_requests (id, name, email, goal, created_at, updated_at) VALUES (?, 'x', ?, 'a long enough goal', ?, ?)",
    );
    await env.DB.batch(
      Array.from({ length: HOURLY_LIMIT }, (_, i) => insert.bind(`flood-${i}`, `flood${i}@test.example`, at, at)),
    );
    const res = await submit(form());
    expect(res.status).toBe(429);
    await env.DB.prepare("DELETE FROM access_requests").run();
  });

  it("rejects very large bodies", async () => {
    expect((await submit(form({ goal: "x".repeat(20_000) }))).status).toBe(413);
  });
});

describe("Request access (admin)", () => {
  it("is not readable without admin login", async () => {
    expect((await call("/api/admin/access-requests", { as: null })).status).toBe(401);
  });

  it("lists requests and records Dan's decision", async () => {
    const f = form();
    await submit(f);
    const list = await call("/api/admin/access-requests?status=new");
    expect(list.status).toBe(200);
    const { requests } = (await list.json()) as { requests: { id: string; email: string }[] };
    const mine = requests.find((r) => r.email === f.email);
    expect(mine).toBeDefined();

    const res = await call(`/api/admin/access-requests/${mine?.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "invited", note: "Pilot group 1" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { request: unknown }).request).toMatchObject({
      status: "invited",
      note: "Pilot group 1",
    });

    // Once decided, a re-submission doesn't overwrite it.
    await submit({ ...f, goal: "Something else entirely here." });
    expect(await stored(f.email)).toMatchObject({ status: "invited", goal: f.goal });

    expect(
      (await call("/api/admin/access-requests/nope", { method: "PATCH", body: JSON.stringify({ status: "declined" }) }))
        .status,
    ).toBe(404);
  });
});
