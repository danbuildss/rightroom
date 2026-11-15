-- Introductions a founder drafts in the app. Private to their workspace. Rightroom never sends
-- anything: "sent" only records that the founder said they sent it themselves, and when.
CREATE TABLE founder_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  variant TEXT NOT NULL CHECK (variant IN ('first', 'shorter', 'follow_up')),
  recipient TEXT NOT NULL,
  channel_label TEXT,
  channel_url TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_founder_drafts_company ON founder_drafts (workspace_id, company_id, created_at);
