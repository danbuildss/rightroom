import { createApp } from "./app.ts";
import { purgeOldAccessRequests } from "./db/access.ts";
import { runDueSources } from "./db/collector.ts";
import { discover } from "./db/discovery.ts";
import { enrichMissing } from "./db/enrich.ts";
import { fetchMissingLogos } from "./db/logos.ts";
import type { Env } from "./env.ts";

const app = createApp();

export default {
  fetch: app.fetch,
  /** Cron Trigger (wrangler.jsonc): check a few due sources each run. */
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runDueSources(env.DB, { env }).then((outcomes) => {
        const failed = outcomes.filter((o) => o.status === "failed").length;
        console.log(`collector: ${outcomes.length} sources checked, ${failed} failed`);
      }),
    );
    // Privacy policy: decided access requests are deleted 12 months after the decision.
    ctx.waitUntil(
      purgeOldAccessRequests(env.DB).then((n) => {
        if (n) console.log(`access requests: ${n} older than 12 months deleted`);
      }),
    );
    // New early-stage teams: each source about once a day, then a few candidates' websites read.
    ctx.waitUntil(
      discover(env.DB, { env }).then((r) => {
        const added = r.sources.reduce((n, s) => n + s.added, 0);
        if (r.sources.length || r.sites_read)
          console.log(`discovery: ${added} new candidates, ${r.sites_read} sites read`);
      }),
    );
    // Website details (X, GitHub, LinkedIn, docs, partner page, partnerships email or form): 5 companies an hour.
    ctx.waitUntil(
      enrichMissing(env.DB, { limit: 5 }).then((r) => {
        const n = r.reduce((sum, x) => sum + x.added.length, 0);
        if (r.length) console.log(`website details: ${r.length} companies read, ${n} details added`);
      }),
    );
    // Logos: a few verified companies without a checked logo (or not checked for a month) each hour.
    ctx.waitUntil(
      fetchMissingLogos(env.DB, { limit: 5 }).then((r) => {
        if (r.length) console.log(`logos: ${r.filter((x) => x.status === "found").length}/${r.length} found`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
