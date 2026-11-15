import { describe, expect, it } from "vitest";
import { type DiscoverCompany, parseQuery, scoreCompany } from "../shared/discover.ts";

describe("parseQuery", () => {
  it("reads sectors, goals and places from plain words", () => {
    const p = parseQuery(
      "Fintech companies in Africa that could integrate our payments API and help us reach more businesses",
    );
    expect(p.categories).toEqual(expect.arrayContaining(["payments", "dev-platforms"]));
    expect(p.goals).toEqual(expect.arrayContaining(["integrations", "distribution"]));
    expect(p.places).toEqual(["africa"]);
  });

  it("doesn't read 'us' as the United States, but does read 'US'", () => {
    expect(parseQuery("help us find agents").places).toEqual([]);
    expect(parseQuery("agents in the US and UK").places).toEqual(["us", "uk"]);
  });

  it("keeps the longer place name", () => {
    expect(parseQuery("wallets in South Africa").places).toEqual(["south africa"]);
  });

  it("matches whole words only", () => {
    expect(parseQuery("database for our customer base").categories).not.toContain("base");
    expect(parseQuery("apps built on Base").categories).toContain("base");
  });
});

const NOW = new Date("2026-11-15T12:00:00Z");
function company(over: Partial<DiscoverCompany> = {}): DiscoverCompany {
  return {
    name: "Example Pay",
    description: "Payments API for small businesses.",
    domain: "examplepay.example",
    categories: [
      { slug: "payments", label: "Payments", kind: "sector" },
      { slug: "dev-platforms", label: "Developer platforms", kind: "sector" },
    ],
    signals: [
      {
        signal_type: "partner_program_launched",
        event_date: "2026-11-10",
        last_verified_at: "2026-11-12T10:00:00Z",
        fresh: true,
        source_kinds: ["partner_page"],
        source_hosts: ["examplepay.example", "news.example"],
      },
    ],
    ...over,
  };
}
const ctx = {
  target: ["payments", "dev-platforms"],
  own: ["payments"],
  goals: ["integrations" as const],
  terms: ["payments"],
};

describe("scoreCompany", () => {
  it("scores a well-matched company with a fresh partner program as a strong fit, with a reason per factor", () => {
    const fit = scoreCompany(company(), ctx, NOW);
    expect(fit.factors.map((f) => f.score)).toEqual([5, 4, 5, 3, 2]);
    // round((5*30 + 4*25 + 5*20 + 3*15 + 2*10) / 5) = round(415/5) = 83
    expect(fit.overall).toBe(83);
    expect(fit.label).toBe("strong");
    expect(fit.evidence).toBe("high");
    for (const f of fit.factors) expect(f.reason.length).toBeGreaterThan(5);
    expect(fit.factors.find((f) => f.factor === "contact_access")?.reason).toMatch(/no named contact/);
  });

  it("never lets contact access go above 3 (no named contacts in our data yet)", () => {
    const fit = scoreCompany(company(), ctx, NOW);
    expect(fit.factors.find((f) => f.factor === "contact_access")?.score).toBeLessThanOrEqual(3);
  });

  it("says 'needs verification' instead of a score when there are no verified signals", () => {
    const fit = scoreCompany(company({ signals: [] }), ctx, NOW);
    expect(fit.evidence).toBe("low");
    expect(fit.label).toBe("needs_verification");
  });

  it("drops companies that don't match at all", () => {
    const fit = scoreCompany(
      company({
        categories: [{ slug: "solana", label: "Solana", kind: "ecosystem" }],
        description: "Games.",
        signals: [],
      }),
      ctx,
      NOW,
    );
    expect(fit.label).toBe("below");
  });

  it("treats an old signal as weaker readiness", () => {
    const old = company({
      signals: [
        { ...company().signals[0]!, fresh: false, event_date: "2026-06-01", last_verified_at: "2026-06-02T00:00:00Z" },
      ],
    });
    const fit = scoreCompany(old, ctx, NOW);
    expect(fit.factors.find((f) => f.factor === "readiness")?.score).toBe(3);
    expect(fit.evidence).toBe("medium");
  });
});
