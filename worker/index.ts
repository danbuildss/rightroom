import { createApp } from "./app.ts";
import { runTick } from "./db/engine.ts";
import type { Env } from "./env.ts";

const app = createApp();

export default {
  fetch: app.fetch,
  /**
   * Cron Trigger (wrangler.jsonc, every 10 minutes on the free plan): one small engine task per run,
   * taking turns (worker/db/engine.ts). Each run is recorded for Back office → Home → Engine status.
   */
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runTick(env.DB, env).then((done) => {
        console.log(`engine: ${done.map((d) => `${d.task} ${d.status}`).join(", ")}`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
