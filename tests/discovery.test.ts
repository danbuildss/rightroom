import { describe, expect, it } from "vitest";
import {
  offTarget,
  parseGithubSearch,
  parseHnShow,
  productDomain,
  readSiteMeta,
  suggestProfile,
} from "../shared/discovery.ts";

describe("finding early-stage teams", () => {
  it("keeps a product's own website and drops code hosts, social sites and app hosting", () => {
    expect(productDomain("https://www.acme.dev/launch")).toBe("acme.dev");
    expect(productDomain("https://app.acme.dev")).toBe("acme.dev");
    for (const u of [
      "https://github.com/acme/x",
      "https://acme.vercel.app",
      "https://x.com/acme",
      "https://medium.com/@a/b",
      "ftp://acme.dev",
      "not a url",
    ])
      expect(productDomain(u)).toBeNull();
  });

  it("reads Show HN posts about relevant products only", () => {
    const found = parseHnShow({
      hits: [
        {
          objectID: "1",
          title: "Show HN: Acme – an API for agent payments",
          url: "https://acme.dev",
          created_at: "2026-11-14T10:00:00Z",
        },
        { objectID: "2", title: "Show HN: My knitting blog", url: "https://knit.example" },
        { objectID: "3", title: "Show HN: Repo only SDK", url: "https://github.com/x/y" },
      ],
    });
    expect(found).toEqual([
      {
        domain: "acme.dev",
        name: "Acme",
        found_via: "hn",
        found_url: "https://news.ycombinator.com/item?id=1",
        found_title: "Show HN: Acme – an API for agent payments",
        found_at: "2026-11-14",
        hint: "Show HN: Acme – an API for agent payments",
      },
    ]);
  });

  it("reads GitHub repos that list their own homepage, preferring the organisation's name", () => {
    const found = parseGithubSearch({
      items: [
        {
          full_name: "acmehq/mcp",
          name: "mcp",
          html_url: "https://github.com/acmehq/mcp",
          homepage: "https://acme.dev",
          description: "MCP server",
          owner: { login: "acmehq", type: "Organization" },
          created_at: "2026-11-01T00:00:00Z",
        },
        {
          full_name: "bob/tool",
          name: "tool",
          html_url: "https://github.com/bob/tool",
          homepage: "",
          owner: { login: "bob", type: "User" },
        },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ domain: "acme.dev", name: "acmehq", found_via: "github", found_at: "2026-11-01" });
  });

  it("reads a homepage's name and description, and suggests sectors and a type", () => {
    const meta = readSiteMeta(
      `<title>Acme | Payments API for AI agents</title><meta name="description" content="Let agents pay &amp; get paid with one API.">`,
    );
    expect(meta).toEqual({ name: "Acme", description: "Let agents pay & get paid with one API." });
    expect(readSiteMeta(`<meta property="og:site_name" content="Acme Labs"><title>Home</title>`).name).toBe(
      "Acme Labs",
    );
    const s = suggestProfile("Payments API for AI agents");
    expect(s.type).toBe("platform_api");
    expect(s.categories).toEqual(expect.arrayContaining(["payments"]));
    expect(suggestProfile("A layer-2 network for games").type).toBe("ecosystem");
    expect(suggestProfile("A notes app for teams").type).toBe("startup_product");
  });

  it("turns every HTML code back into its character (&#x27;, &#32;, &#39;)", () => {
    expect(
      readSiteMeta(`<meta name="description" content="Worried that you&#x27;re losing&#32;your edge? It&#39;s fine.">`)
        .description,
    ).toBe("Worried that you're losing your edge? It's fine.");
  });

  it("spots sites that aren't companies founders would partner with", () => {
    expect(offTarget("Explore top beach clubs in Dubai. Book day passes and cabanas.")).toBe("Local service");
    expect(offTarget("Full Stack Developer specializing in MERN stack, based in Surat")).toBe("Personal site");
    expect(offTarget("Free online tools: tax, electricity bill and CGPA calculators")).toBe("Free tool site");
    expect(offTarget("Turn one photo into viral TikTok AI meme videos")).toBe("Consumer app");
    expect(offTarget("1:1 coaching for software developers")).toBe("Courses");
    for (const ok of [
      "Cloud sandboxes for running AI-generated code and agents.",
      "Payments API for AI agents",
      "The #1 AI & PM newsletter with playbooks",
      "AI GTM finds your B2B buyers and verifies the decision maker",
    ])
      expect(offTarget(ok)).toBeNull();
  });
});
