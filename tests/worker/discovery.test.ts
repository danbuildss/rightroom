import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../../worker/env.ts";
import { appWithFetcher, call, founderSession, token } from "./helpers.ts";

let n = 0;
/** A fake internet: HN search, GitHub search, and each team's homepage. */
function web(teams: { domain: string; via: "hn" | "github" }[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://hn.algolia.com/")) {
      return Response.json({
        hits: teams
          .filter((t) => t.via === "hn")
          .map((t, i) => ({
            objectID: `${i}`,
            title: `Show HN: ${t.domain.split(".")[0]} – an API for AI agents`,
            url: `https://${t.domain}`,
            created_at: "2026-11-14T00:00:00Z",
          })),
      });
    }
    if (url.startsWith("https://api.github.com/search/")) {
      return Response.json({
        items: url.includes("mcp-server")
          ? teams
              .filter((t) => t.via === "github")
              .map((t) => ({
                full_name: `${t.domain.split(".")[0]}/mcp`,
                name: "mcp",
                html_url: `https://github.com/${t.domain.split(".")[0]}/mcp`,
                homepage: `https://${t.domain}`,
                description: "MCP server for payments",
                owner: { login: t.domain.split(".")[0], type: "Organization" },
                created_at: "2026-11-01T00:00:00Z",
              }))
          : [],
      });
    }
    const t = teams.find((x) => url === `https://${x.domain}/`);
    if (t) {
      return new Response(
        `<title>${t.domain.split(".")[0]} | Payments API for AI agents</title><meta name="description" content="Let agents pay with one API (fictional test team).">
         <a href="https://x.com/${t.domain.split(".")[0]}hq">X</a><a href="mailto:partners@${t.domain}">Partner</a>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    return new Response("not found", { status: 404 });
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
type Cand = {
  id: string;
  domain: string;
  found_via: string;
  site_name: string | null;
  site_description: string | null;
  site_links: Record<string, string>;
  suggested_type: string;
};

describe("finding early-stage teams", () => {
  it("finds teams on Show HN and GitHub, reads their websites, and never proposes one twice", async () => {
    n += 1;
    const a = `hnteam${n}.example`;
    const b = `ghteam${n}.example`;
    const fetcher = web([
      { domain: a, via: "hn" },
      { domain: b, via: "github" },
    ]);
    const res = (await (await admin(fetcher, "POST", "/candidates/find")).json()) as {
      sources: { source: string; added: number }[];
      sites_read: number;
    };
    expect(res.sources.find((s) => s.source === "hn")?.added).toBeGreaterThanOrEqual(1);
    expect(res.sources.find((s) => s.source === "github")?.added).toBeGreaterThanOrEqual(1);
    await admin(fetcher, "POST", "/candidates/read-sites");
    const list = ((await (await admin(fetcher, "GET", "/candidates")).json()) as { candidates: Cand[] }).candidates;
    const ca = list.find((c) => c.domain === a);
    expect(ca).toMatchObject({
      found_via: "hn",
      site_description: "Let agents pay with one API (fictional test team).",
      suggested_type: "platform_api",
    });
    expect(ca?.site_links.email).toBe(`partners@${a}`);
    expect(list.find((c) => c.domain === b)?.found_via).toBe("github");

    const again = (await (await admin(fetcher, "POST", "/candidates/find")).json()) as { sources: { added: number }[] };
    expect(again.sources.reduce((s, x) => s + x.added, 0)).toBe(0);
  });

  it("skips off-target sites by their own words, and takes categories from the site, not the GitHub repo", async () => {
    n += 1;
    const beach = `beachgh${n}.example`;
    const pay = `paygh${n}.example`;
    const base = web([
      { domain: beach, via: "github" },
      { domain: pay, via: "github" },
    ]);
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === `https://${beach}/`)
        return new Response(
          `<title>Beach Test</title><meta name="description" content="Explore top beach clubs. Book day passes and cabanas (fictional test site).">`,
          { headers: { "content-type": "text/html" } },
        );
      return base(input);
    }) as unknown as typeof fetch;
    await admin(fetcher, "POST", "/candidates/find");
    await admin(fetcher, "POST", "/candidates/read-sites");
    const open = ((await (await admin(fetcher, "GET", "/candidates")).json()) as { candidates: Cand[] }).candidates;
    expect(open.find((c) => c.domain === beach)).toBeUndefined();
    const p = open.find((c) => c.domain === pay) as Cand & { suggested_categories: string[] };
    expect(p.suggested_categories).not.toContain("mcp");
    const rejected = (
      (await (await admin(fetcher, "GET", "/candidates?status=rejected")).json()) as {
        candidates: (Cand & { site_note: string })[];
      }
    ).candidates.find((c) => c.domain === beach);
    expect(rejected?.site_note).toBe("Skipped automatically: local service.");
  });

  it("approving makes a verified, early-stage company with its links; founders see it in Explore", async () => {
    n += 1;
    const d = `approve${n}.example`;
    const fetcher = web([{ domain: d, via: "hn" }]);
    await admin(fetcher, "POST", "/candidates/find");
    await admin(fetcher, "POST", "/candidates/read-sites");
    const cand = (
      (await (await admin(fetcher, "GET", "/candidates")).json()) as { candidates: Cand[] }
    ).candidates.find((c) => c.domain === d);
    const r = (await (
      await admin(fetcher, "POST", "/candidates/approve", {
        ids: [cand?.id],
        names: { [cand?.id ?? ""]: `Approve Co ${n}` },
      })
    ).json()) as {
      results: { ok: boolean; company_id: string }[];
    };
    expect(r.results[0]?.ok).toBe(true);
    const co = await env.DB.prepare("SELECT status, stage, profile_status, org_type, name FROM companies WHERE id = ?")
      .bind(r.results[0]?.company_id)
      .first();
    expect(co).toMatchObject({
      status: "verified",
      stage: "early",
      profile_status: "confirmed",
      org_type: "platform_api",
      name: `Approve Co ${n}`,
    });

    const { cookie } = await founderSession();
    const ex = await call(`/api/app/explore?q=${encodeURIComponent(`Approve Co ${n}`)}`, {
      as: null,
      headers: { cookie },
    });
    const card = (
      (await ex.json()) as { results: { links: Record<string, string | null>; profile: { stage: string } }[] }
    ).results[0];
    expect(card?.profile.stage).toBe("early");
    expect(card?.links.x).toBe(`https://x.com/approve${n}hq`);
    expect(card?.links.email).toBe(`partners@${d}`);

    // Approving twice does nothing; rejecting a new one keeps it out for good.
    const twice = (await (await admin(fetcher, "POST", "/candidates/approve", { ids: [cand?.id] })).json()) as {
      results: { ok: boolean }[];
    };
    expect(twice.results[0]?.ok).toBe(false);
  });

  it("rejected teams are never proposed again", async () => {
    n += 1;
    const d = `reject${n}.example`;
    const fetcher = web([{ domain: d, via: "hn" }]);
    await admin(fetcher, "POST", "/candidates/find");
    const cand = (
      (await (await admin(fetcher, "GET", "/candidates")).json()) as { candidates: Cand[] }
    ).candidates.find((c) => c.domain === d);
    expect(await (await admin(fetcher, "POST", "/candidates/reject", { ids: [cand?.id] })).json()).toEqual({
      rejected: 1,
    });
    await admin(fetcher, "POST", "/candidates/find");
    const list = ((await (await admin(fetcher, "GET", "/candidates")).json()) as { candidates: Cand[] }).candidates;
    expect(list.some((c) => c.domain === d)).toBe(false);
  });
});
