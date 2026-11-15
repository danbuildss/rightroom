-- AI helpers through Dan's Bankr LLM gateway (approved 2026-11-15): back-office only, public website text only.
-- Settings Dan chooses in the back office (e.g. which model).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Every AI call: what for, which model, tokens and Rightroom's cost estimate (the monthly cap is checked first).
CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('candidate', 'contacts', 'test')),
  subject_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_usd REAL NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_calls_month ON ai_calls (created_at);
-- The AI's read of a new company candidate (a suggestion Dan sees before approving).
ALTER TABLE company_candidates ADD COLUMN ai_json TEXT;
ALTER TABLE company_candidates ADD COLUMN ai_checked_at TEXT;
