-- Grok test (3 USD): Dan rates each Grok result, and company research can suggest an official X handle.
ALTER TABLE collected_items ADD COLUMN useful INTEGER CHECK (useful IN (0, 1));
ALTER TABLE collected_items ADD COLUMN rated_at TEXT;

-- An X handle Grok found for a company, backed by a cited post from that same account.
-- It only becomes the company's X link when Dan accepts it.
CREATE TABLE x_handle_suggestions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  watched_source_id TEXT REFERENCES watched_sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'dismissed')),
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (company_id, handle)
);
CREATE INDEX idx_handle_suggestions ON x_handle_suggestions (status, created_at);
