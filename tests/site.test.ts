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
    const all = vercel.headers.find((h) => h.source === "/(.*)")?.headers ?? [];
    for (const { key, value } of all) expect(headers).toContain(`${key}: ${value}`);
    expect(all.map((h) => h.key)).toContain("Content-Security-Policy");
  });
});
