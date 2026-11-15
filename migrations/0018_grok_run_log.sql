-- What each Grok search asked and got back, so Dan can see why a search found nothing.
-- No secrets: the request summary, Grok's answer (trimmed), what was kept or dropped and why, and the cost.
CREATE TABLE grok_runs (
  id TEXT PRIMARY KEY,
  watched_source_id TEXT REFERENCES watched_sources(id) ON DELETE CASCADE,
  ran_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  model TEXT NOT NULL,
  query TEXT NOT NULL,
  from_date TEXT NOT NULL,
  max_posts INTEGER NOT NULL,
  posts_read INTEGER NOT NULL DEFAULT 0,
  listed INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0,
  dropped_json TEXT NOT NULL DEFAULT '[]',
  answer_excerpt TEXT,
  error TEXT,
  cost_usd REAL
);
CREATE INDEX idx_grok_runs_source ON grok_runs (watched_source_id, ran_at);
