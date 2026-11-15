import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accessRequestSchema } from "../shared/access.ts";

const html = readFileSync("site/index.html", "utf8");
const css = readFileSync("site/site.css", "utf8");
const headers = readFileSync("site/_headers", "utf8");

describe("marketing site", () => {
  it("loads nothing from other sites (fonts are self-hosted)", () => {
    expect(html).not.toMatch(/(src|href)="https?:\/\//);
    expect(css).not.toMatch(/url\(["']?https?:/);
  });

  it("has no inline scripts, handlers or style attributes, so the strict CSP holds", () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/\sstyle=/);
    expect(headers).toContain("script-src 'self'");
    expect(headers).toContain("frame-ancestors 'none'");
  });

  it("shows the logo with the lowercase wordmark", () => {
    expect(html).toContain('<symbol id="rr"');
    expect(html).toMatch(/<use href="#rr"\/><\/svg>rightroom<\/a>/);
  });

  it("labels the example companies as illustrations", () => {
    expect(html.match(/class="example-note"/g)).toHaveLength(2);
    expect(html).not.toMatch(/trusted by|customers include|partnered with/i);
  });

  it("posts the form fields the API expects", () => {
    expect(html).toContain('action="/api/public/access-requests" method="post"');
    const formHtml = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
    const names = [...formHtml.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(Object.keys(accessRequestSchema.shape).sort());
  });
});

describe("Vercel copy of the site", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    outputDirectory: string;
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };

  it("serves the same site folder and sends /api to the Cloudflare Worker", () => {
    expect(vercel.outputDirectory).toBe("site");
    expect(vercel.rewrites).toEqual([
      { source: "/api/:path*", destination: "https://rightroom.danewurum01.workers.dev/api/:path*" },
    ]);
  });

  it("uses the same security headers as Cloudflare", () => {
    const all = vercel.headers.find((h) => h.source === "/((?!app/).*)")?.headers ?? [];
    for (const { key, value } of all) expect(headers).toContain(`${key}: ${value}`);
    expect(all.map((h) => h.key)).toContain("Content-Security-Policy");
  });
});

describe("back office page", () => {
  const admin = readFileSync("site/admin/index.html", "utf8");
  const js = readFileSync("site/admin/admin.js", "utf8");

  it("works under the strict CSP and is never indexed", () => {
    expect(admin).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(admin).not.toMatch(/\son[a-z]+=/i);
    expect(admin).not.toMatch(/\sstyle=/);
    expect(admin).toContain('name="robots" content="noindex, nofollow"');
    expect(headers).toMatch(/\/admin\/\*\n {2}X-Robots-Tag: noindex, nofollow/);
  });

  it("keeps the key in this tab only and loads nothing from other sites", () => {
    expect(js).toContain("sessionStorage");
    expect(js).not.toContain("localStorage");
    expect(js).not.toMatch(/fetch\(["'`]https?:/);
    expect(js).not.toMatch(/style="/);
  });
});

describe("privacy and terms pages", () => {
  const privacy = readFileSync("site/privacy.html", "utf8");
  const terms = readFileSync("site/terms.html", "utf8");

  it("exist, are linked from the site and the sign-in screen, and work under the strict CSP", () => {
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(/\sstyle=/);
      expect(page).not.toMatch(/<script/);
    }
    expect(html).toContain('href="/privacy.html"');
    expect(html).toContain('href="/terms.html"');
    expect(readFileSync("app/src/App.tsx", "utf8")).toContain('href="/privacy.html"');
  });

  it("contain no unfilled placeholders and say plainly what's still missing", () => {
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(/\[[^\]]*\]/);
      expect(page).toMatch(/isn't a registered company yet/);
    }
  });

  it("match what the product does", () => {
    expect(privacy).toContain("__Host-rr_session");
    expect(privacy).toMatch(/12 months/);
    expect(privacy).toMatch(/never guess email addresses/);
    expect(terms).toMatch(/Rightroom never sends messages/);
  });
});
