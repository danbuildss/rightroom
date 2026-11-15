-- A founder's saved companies and where each conversation is. Private to their workspace.
-- Follow-up dates are reminders inside the app; Rightroom never contacts anyone.
CREATE TABLE founder_saved (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'shortlisted' CHECK (stage IN ('shortlisted', 'contacted', 'in_discussion', 'partnered')),
  follow_up_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, company_id)
);
CREATE INDEX idx_founder_saved_ws ON founder_saved (workspace_id, stage);

CREATE TABLE founder_pipeline_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  saved_id TEXT NOT NULL REFERENCES founder_saved(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('saved', 'stage', 'sent', 'follow_up')),
  from_stage TEXT,
  to_stage TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_founder_events_saved ON founder_pipeline_events (workspace_id, saved_id, created_at);
