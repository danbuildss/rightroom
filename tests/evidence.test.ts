import { describe, expect, it } from "vitest";
import { bestMatches, keywords, mentionsCompany, sentences } from "../shared/evidence.ts";

const PAGE = `Acme Cloud. Pricing. Today we're opening the Acme partner program to developers building AI agents.
Partners get early API access and co-marketing. Our team loves coffee and long walks on the beach.
Read our privacy policy for more details about cookies and tracking on this site.`;

describe("keywords and sentences", () => {
  it("keeps meaningful words only", () => {
    expect(keywords("The company opened a partner program for AI agents")).toEqual([
      "company",
      "opened",
      "partner",
      "program",
      "agents",
    ]);
  });
  it("splits a page into readable sentences", () => {
    expect(sentences(PAGE)).toHaveLength(4);
  });
});

describe("bestMatches", () => {
  it("finds the sentence that supports the claim, best first", () => {
    const m = bestMatches("Acme opened a partner program for developers building AI agents.", PAGE);
    expect(m[0]?.sentence).toBe("Today we're opening the Acme partner program to developers building AI agents.");
    expect(m[0]?.score).toBeGreaterThan(0.6);
  });
  it("returns nothing when the page doesn't support the claim", () => {
    expect(bestMatches("Acme raised a Series B from Example Ventures.", PAGE)).toEqual([]);
  });
  it("handles empty input", () => {
    expect(bestMatches("", PAGE)).toEqual([]);
    expect(bestMatches("partner program", "")).toEqual([]);
  });
});

describe("mentionsCompany", () => {
  it("finds the company name in the title or text, ignoring suffixes", () => {
    expect(mentionsCompany("Acme Labs", "Acme | Home", "Welcome")).toBe(true);
    expect(mentionsCompany("Venice AI", null, "Private AI by Venice")).toBe(true);
    expect(mentionsCompany("Acme", "Parked domain", "This domain is for sale")).toBe(false);
  });
});
