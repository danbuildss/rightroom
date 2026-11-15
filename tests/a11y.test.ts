/**
 * Accessibility scan (axe) of the static pages and of rendered app screens, so issues found in
 * the audit stay fixed. jsdom has no layout, so colour contrast is checked in the browser audit
 * instead; everything else axe checks runs here.
 */
// @vitest-environment node
import { readFileSync } from "node:fs";
import axe from "axe-core";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignInPlaceholder } from "../app/src/App.tsx";
import type { DiscoverResult } from "../app/src/api.ts";
import { ResultCard } from "../app/src/Discover.tsx";
import { CountUp, FitMeter } from "../app/src/motion.tsx";

async function scan(html: string, opts: { fragment?: boolean } = {}) {
  const doc = opts.fragment
    ? `<!doctype html><html lang="en"><head><title>Test</title></head><body><main><h1>Screen</h1>${html}</main></body></html>`
    : html;
  const dom = new JSDOM(doc, { runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(axe.source);
  const runner = (dom.window as unknown as { axe: typeof axe }).axe;
  const result = await runner.run(dom.window.document, {
    runOnly: ["wcag2a", "wcag2aa", "best-practice"],
    rules: { "color-contrast": { enabled: false } },
  });
  dom.window.close();
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(" ")})`);
}

const card: DiscoverResult = {
  saved: null,
  slug: "example-pay",
  name: "Example Pay",
  domain: "example.com",
  description: "Payments API (test record).",
  categories: [{ slug: "payments", label: "Payments", kind: "sector" }],
  fit: {
    overall: 82,
    label: "strong",
    evidence: "high",
    why: "Matches Payments",
    factors: [
      {
        factor: "alignment",
        label: "Product and audience alignment",
        weight: 30,
        score: 5,
        reason: "Matches Payments.",
      },
      {
        factor: "mutual_value",
        label: "Mutual commercial value",
        weight: 25,
        score: 4,
        reason: "You want integrations.",
      },
      {
        factor: "readiness",
        label: "Partnership readiness",
        weight: 20,
        score: 5,
        reason: "Partner program launched.",
      },
      {
        factor: "contact_access",
        label: "Contact accessibility",
        weight: 15,
        score: 3,
        reason: "Public partner page.",
      },
      { factor: "feasibility", label: "Execution feasibility", weight: 10, score: 2, reason: "No shared technology." },
    ],
  },
  signals: [
    {
      type: "partner_program_launched",
      type_label: "Partner program launched",
      title: "Opened a partner program",
      claim: "They opened a partner program.",
      excerpt: "Our partner program is open.",
      event_date: "2026-11-10",
      last_verified_at: "2026-11-12T10:00:00Z",
      status: "verified",
      sources: [{ url: "https://example.com/partners", title: "Partners", role: "primary" }],
    },
  ],
};

describe("accessibility (axe)", () => {
  it("catches real problems (the scanner is running)", async () => {
    const issues = await scan('<h1>Page</h1><h4>Skipped levels</h4><img src="x.png"><button></button>', {
      fragment: true,
    });
    expect(issues.join("\n")).toMatch(/heading-order/);
    expect(issues.join("\n")).toMatch(/image-alt/);
  });

  for (const page of [
    "site/index.html",
    "site/privacy.html",
    "site/terms.html",
    "site/thanks.html",
    "site/404.html",
    "site/admin/index.html",
  ]) {
    it(`${page} has no issues`, async () => {
      expect(await scan(readFileSync(page, "utf8"))).toEqual([]);
    });
  }

  it("a Discover result card with details open has no issues", async () => {
    const html = renderToStaticMarkup(
      createElement(ResultCard, { r: card, open: true, onToggle: () => {}, onOpen: () => {} }),
    );
    expect(await scan(html, { fragment: true })).toEqual([]);
  });

  it("the sign-in screen has no issues", async () => {
    const html = renderToStaticMarkup(createElement(SignInPlaceholder));
    expect(
      await scan(`<!doctype html><html lang="en"><head><title>Sign in</title></head><body>${html}</body></html>`),
    ).toEqual([]);
  });

  it("the weighted fit meter and score count-up have no issues and give the real values", async () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(FitMeter, { factors: card.fit.factors }),
        createElement("div", null, createElement(CountUp, { value: 78 })),
      ),
    );
    expect(await scan(html, { fragment: true })).toEqual([]);
    expect(html).toContain("Partnership readiness 5 of 5");
    expect(html).toContain('<span class="sr">78</span>');
  });
});
