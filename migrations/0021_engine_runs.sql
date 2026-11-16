-- The engine: one small task every 10 minutes (Cloudflare cron, free plan), each run recorded here
-- so Dan can see what ran, what it found and any errors. A run left at 'running' was cut short.
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'idle', 'failed')),
  summary TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  error TEXT
);
CREATE INDEX idx_job_runs_started ON job_runs (started_at);
