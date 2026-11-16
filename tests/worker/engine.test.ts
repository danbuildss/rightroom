import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { engineStatus, runTick, TASKS } from "../../worker/db/engine.ts";
import type { Env } from "../../worker/env.ts";
import { appWithFetcher, token } from "./helpers.ts";

const offline = (async () => new Response("offline", { status: 503 })) as unknown as typeof fetch;

describe("the engine (every 10 minutes, one small task per run)", () => {
  it("takes turns, moves on from tasks with nothing to do, and records every run", async () => {
    await env.DB.prepare("DELETE FROM job_runs").run();
    await env.DB.prepare("DELETE FROM discovery_state WHERE key = 'engine_next'").run();
    const first = await runTick(env.DB, env as unknown as Env, { fetcher: offline });
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.length).toBeLessThanOrEqual(3);
    // The first task (Hacker News) fails offline and is recorded with its error.
    expect(first[0]).toMatchObject({ task: TASKS[0]?.key, status: "failed" });
    const second = await runTick(env.DB, env as unknown as Env, { fetcher: offline });
    expect(second[0]?.task).toBe(TASKS[1]?.key);

    const { results } = await env.DB.prepare(
      "SELECT task, status, finished_at, error FROM job_runs ORDER BY started_at",
    ).all<{
      task: string;
      status: string;
      finished_at: string | null;
      error: string | null;
    }>();
    expect(results.length).toBe(first.length + second.length);
    expect(results.every((r) => r.finished_at)).toBe(true);
    expect(results[0]?.error).toMatch(/503/);
  });

  it("shows a run that never finished as cut short, plus today's totals and what's waiting", async () => {
    await env.DB.prepare(
      "INSERT INTO job_runs (id, task, started_at, status) VALUES ('stuck', 'links', '2020-01-01T00:00:00.000Z', 'running')",
    ).run();
    const s = await engineStatus(env.DB);
    expect(s.runs.find((r) => r.id === "stuck")).toMatchObject({
      status: "cut_short",
      label: "Fill links from websites",
    });
    expect(s.waiting).toEqual(
      expect.objectContaining({ teams: expect.any(Number), contacts: expect.any(Number), inbox: expect.any(Number) }),
    );
    expect(s.last_run_at).not.toBeNull();
  });

  it("the back office can run one step now and read the status", async () => {
    const req = async (method: string, path: string) =>
      appWithFetcher(offline).fetch(
        new Request(`https://talo.example/api/admin${path}`, {
          method,
          headers: { "Cf-Access-Jwt-Assertion": await token() },
        }),
        env as unknown as Env,
      );
    const run = (await (await req("POST", "/engine/run")).json()) as { done: { task: string }[] };
    expect(run.done.length).toBeGreaterThanOrEqual(1);
    const st = (await (await req("GET", "/engine")).json()) as { runs: unknown[] };
    expect(st.runs.length).toBeGreaterThan(0);
  });
});
