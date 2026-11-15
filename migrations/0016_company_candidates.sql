-- Early-stage teams found automatically (Show HN, new GitHub repos, website links in the Inbox).
-- A candidate is only a proposal: Dan approves it, in batches, before it becomes a verified company.
-- A domain is listed once, so a rejected team is never proposed again.
CREATE TABLE company_candidates (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  found_via TEXT NOT NULL CHECK (found_via IN ('hn', 'github', 'inbox')),
  found_url TEXT NOT NULL,
  found_title TEXT NOT NULL,
  found_at TEXT,
  hint TEXT,
  site_name TEXT,
  site_description TEXT,
  site_links_json TEXT NOT NULL DEFAULT '{}',
  site_checked_at TEXT,
  site_note TEXT,
  suggested_categories_json TEXT NOT NULL DEFAULT '[]',
  suggested_type TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'rejected', 'duplicate')),
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_candidates_status ON company_candidates (status, created_at);

-- When each discovery source last ran (so the hourly job runs each one about once a day).
CREATE TABLE discovery_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
