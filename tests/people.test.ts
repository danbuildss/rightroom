import { describe, expect, it } from "vitest";
import { extractPeople, looksLikeName, teamPages } from "../shared/people.ts";

describe("points of contact from a company's own pages", () => {
  it("reads a team grid: a name, then a role worth contacting", () => {
    const html = `<section><h2>Our team</h2>
      <div><h3>Jane Doe</h3><p>Co-founder &amp; CEO</p></div>
      <div><h3>Kwame Mensah</h3><p>Head of Partnerships</p></div>
      <div><h3>Ana María López</h3><p>Designer</p></div>
      <div><h3>Join the team</h3><p>Developer Relations</p></div>
      <p>Tomás Ruiz, Business Development</p></section>`;
    expect(extractPeople(html)).toEqual([
      { name: "Jane Doe", role: "Co-founder & CEO" },
      { name: "Kwame Mensah", role: "Head of Partnerships" },
      { name: "Tomás Ruiz", role: "Business Development" },
    ]);
  });

  it("reads JSON-LD founders and people with job titles", () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme",
      "founder":[{"@type":"Person","name":"Lee Park","jobTitle":"Founder"}],
      "employee":{"@type":"Person","name":"Sam Hill","jobTitle":"Office Manager"}}</script>`;
    expect(extractPeople(html)).toEqual([{ name: "Lee Park", role: "Founder" }]);
  });

  it("doesn't invent people from headings, products or sentences", () => {
    expect(looksLikeName("Get Started Today")).toBe(true); // shape only; the role check below filters it
    expect(extractPeople("<h3>Get Started Today</h3><p>Pricing</p><h3>Our Founders</h3><p>CEO</p>")).toEqual([]);
    expect(looksLikeName("Acme Labs")).toBe(false);
    expect(looksLikeName("the payments api")).toBe(false);
  });

  it("finds team and about pages on the company's own site only", () => {
    const html = `<a href="/about">About</a><a href="https://acme.dev/team/">Team</a><a href="https://other.dev/team">x</a><a href="/about/press">Press</a>`;
    expect(teamPages(html, "https://acme.dev/", "acme.dev")).toEqual([
      "https://acme.dev/about",
      "https://acme.dev/team",
    ]);
  });
});
