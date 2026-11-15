-- Who to contact at a company (Decision C): named people only with a public source page,
-- plus official channels (partner forms, docs, partnership pages). No guessed emails.
-- Dan adds them in the back office; founders see only verified rows.
CREATE TABLE company_contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'channel')),
  name TEXT,
  role TEXT,
  channel_label TEXT,
  url TEXT,
  source_url TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'verified', 'rejected')),
  rejected_reason TEXT,
  last_checked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind != 'person' OR (name IS NOT NULL AND role IS NOT NULL)),
  CHECK (kind != 'channel' OR (channel_label IS NOT NULL AND url IS NOT NULL))
);
CREATE INDEX idx_company_contacts_company ON company_contacts (company_id, status);
