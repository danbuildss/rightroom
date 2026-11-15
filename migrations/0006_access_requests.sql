-- Founders asking to join the invite-only pilot (the marketing site's Request access form).
-- Personal data: only the admin API reads it, and it is never logged.
CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  website TEXT,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'invited', 'declined')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_access_requests_status ON access_requests (status, created_at);
