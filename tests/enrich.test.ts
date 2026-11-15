import { describe, expect, it } from "vitest";
import { readHomepage } from "../shared/enrich.ts";

const page = `<html><body>
<nav><a href="/docs">Docs</a><a href="https://example.com/partners">Partners</a></nav>
<p>As mentioned by <a href="https://x.com/someinvestor">@someinvestor</a></p>
<footer>
  <a href="https://twitter.com/ExampleHQ">Twitter</a>
  <a href="https://x.com/examplehq">X</a>
  <a href="https://x.com/intent/tweet?text=hi">Share</a>
  <a href="https://x.com/examplehq/status/123">A post</a>
  <a href="https://github.com/example-labs/sdk">SDK</a>
  <a href="https://github.com/example-labs">GitHub</a>
  <a href="https://github.com/sponsors/x">Sponsor</a>
  <a href="https://www.linkedin.com/company/example-inc/">LinkedIn</a>
  <a href="mailto:partnerships@example.com?subject=Hi">Partner with us</a>
  <a href="mailto:jane@gmail.com">Jane</a>
  <a href="mailto:press@example.com">Press</a>
  <a href="/contact-sales">Contact sales</a>
</footer></body></html>`;

describe("reading a company's homepage", () => {
  it("takes only the company's own links, the most linked account first", () => {
    expect(readHomepage(page, "https://example.com/", "example.com")).toEqual({
      x: "examplehq",
      github: "example-labs",
      linkedin: "https://www.linkedin.com/company/example-inc",
      docs: "https://example.com/docs",
      partners: "https://example.com/partners",
      email: "partnerships@example.com",
      contact_form: "https://example.com/contact-sales",
    });
  });

  it("never invents: an empty page gives nothing, and emails on other domains or for press are ignored", () => {
    expect(readHomepage("<p>Hello</p>", "https://example.com/", "example.com")).toEqual({
      x: null,
      github: null,
      linkedin: null,
      docs: null,
      partners: null,
      email: null,
      contact_form: null,
    });
    const other = `<a href="mailto:partners@other.com">x</a><a href="mailto:press@example.com">y</a>`;
    expect(readHomepage(other, "https://example.com/", "example.com").email).toBeNull();
  });

  it("finds a docs subdomain", () => {
    expect(
      readHomepage(`<a href="https://docs.example.com/start">Read the docs</a>`, "https://example.com/", "example.com")
        .docs,
    ).toBe("https://docs.example.com");
  });
});
