import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { companyInputSchema } from "../../shared/registry.ts";
import { createCompany } from "../../worker/db/companies.ts";
import { reviewCompany } from "../../worker/db/signals.ts";
import type { Env } from "../../worker/env.ts";
import { appWithFetcher, call, founderSession, token } from "./helpers.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
let n = 0;

async function verified() {
  n += 1;
  const c = await createCompany(
    env.DB,
    companyInputSchema.parse({ name: `Logo Co ${n}`, domain: `logo${n}.example`, categories: ["payments"] }),
    "admin@talo.example",
  );
  await reviewCompany(
    env.DB,
    c.id,
    { action: "verify", checked_url: `https://${c.primary_domain}` },
    "admin@talo.example",
  );
  return c;
}

/** A fake web: the company's homepage links an icon; requests are recorded. */
function fakeWeb(pages: Record<string, Response | (() => Response)>, seen: string[] = []) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const p = pages[url];
    return p ? (typeof p === "function" ? p() : p.clone()) : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

async function admin(fetcher: typeof fetch, method: string, path: string, body?: unknown) {
  return appWithFetcher(fetcher).fetch(
    new Request(`https://talo.example/api/admin${path}`, {
      method,
      headers: { "Cf-Access-Jwt-Assertion": await token(), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env as unknown as Env,
  );
}

describe("company logos", () => {
  it("reads the icon from the company's own site, stores it and serves it from our domain", async () => {
    const c = await verified();
    const seen: string[] = [];
    const web = fakeWeb(
      {
        [`https://${c.primary_domain}/`]: new Response(
          `<link rel="icon" type="image/svg+xml" href="/i.svg"><link rel="apple-touch-icon" href="/apple.png"><link rel="icon" href="https://evil.example/x.png">`,
          { headers: { "content-type": "text/html" } },
        ),
        [`https://${c.primary_domain}/apple.png`]: new Response(PNG, { headers: { "content-type": "image/png" } }),
      },
      seen,
    );
    const res = await admin(web, "POST", `/companies/${c.id}/logo/fetch`, {});
    expect(await res.json()).toMatchObject({ status: "found", source_url: `https://${c.primary_domain}/apple.png` });
    expect(seen.some((u) => u.includes("evil.example") || u.endsWith(".svg"))).toBe(false);

    const img = await call(`/api/public/logos/${c.slug}`, { as: null });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  it("stores nothing for SVG, HTML or oversized images, and shows initials instead", async () => {
    const c = await verified();
    const web = fakeWeb({
      [`https://${c.primary_domain}/`]: new Response(`<link rel="icon" href="/fav.png">`, {
        headers: { "content-type": "text/html" },
      }),
      [`https://${c.primary_domain}/fav.png`]: new Response("<svg><script>alert(1)</script></svg>", {
        headers: { "content-type": "image/png" },
      }),
      [`https://${c.primary_domain}/favicon.ico`]: () => new Response(new Uint8Array(200_000).fill(1)),
    });
    expect(await (await admin(web, "POST", `/companies/${c.id}/logo/fetch`, {})).json()).toMatchObject({
      status: "none",
    });
    expect((await call(`/api/public/logos/${c.slug}`, { as: null })).status).toBe(404);
  });

  it("Dan can point to a better image or hide the logo; hidden logos stay hidden", async () => {
    const c = await verified();
    const web = fakeWeb({ "https://cdn.example/brand.png": new Response(PNG) });
    expect(
      await (
        await admin(web, "POST", `/companies/${c.id}/logo/fetch`, { url: "https://cdn.example/brand.png" })
      ).json(),
    ).toMatchObject({ status: "found" });
    // A bad replacement link changes nothing for founders.
    expect(
      await (
        await admin(web, "POST", `/companies/${c.id}/logo/fetch`, { url: "https://cdn.example/missing.png" })
      ).json(),
    ).toMatchObject({ status: "none" });
    expect((await call(`/api/public/logos/${c.slug}`, { as: null })).status).toBe(200);
    expect((await admin(web, "POST", `/companies/${c.id}/logo/hide`)).status).toBe(200);
    expect((await call(`/api/public/logos/${c.slug}`, { as: null })).status).toBe(404);
    const missing = (await (await admin(web, "POST", "/logos/fetch-missing")).json()) as { results: { id: string }[] };
    expect(missing.results.map((r) => r.id)).not.toContain(c.id);
  });

  it("links: X and GitHub as aliases, partner page and docs only on the company's own site", async () => {
    const c = await verified();
    const web = fakeWeb({});
    expect((await admin(web, "POST", `/companies/${c.id}/links`, { kind: "x", value: "@LogoCo" })).status).toBe(200);
    expect(
      (await admin(web, "POST", `/companies/${c.id}/links`, { kind: "github", value: "https://github.com/logo-co" }))
        .status,
    ).toBe(200);
    expect(
      (
        await admin(web, "POST", `/companies/${c.id}/links`, {
          kind: "partners",
          value: "https://other.example/partners",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin(web, "POST", `/companies/${c.id}/links`, {
          kind: "partners",
          value: `https://${c.primary_domain}/partners`,
        })
      ).status,
    ).toBe(200);

    const { cookie } = await founderSession();
    const res = await call(`/api/app/explore?q=${encodeURIComponent(c.name)}`, { as: null, headers: { cookie } });
    const card = ((await res.json()) as { results: { links: Record<string, string | null>; logo: string | null }[] })
      .results[0];
    expect(card?.links).toEqual({
      website: `https://${c.primary_domain}`,
      x: "https://x.com/logoco",
      github: "https://github.com/logo-co",
      partners: `https://${c.primary_domain}/partners`,
      docs: null,
      linkedin: null,
      email: null,
      contact_form: null,
    });
    expect(card?.logo).toBeNull();

    expect((await admin(web, "DELETE", `/companies/${c.id}/details/x`)).status).toBe(200);
    const again = await call(`/api/app/explore?q=${encodeURIComponent(c.name)}`, { as: null, headers: { cookie } });
    expect(((await again.json()) as { results: { links: { x: string | null } }[] }).results[0]?.links.x).toBeNull();
  });
});
