-- Founders who sign in (through Privy) once Dan has invited them. Each founder gets a
-- private workspace; everything they enter lives there and is deleted with it.

-- Access requests can now come with an X handle instead of (or as well as) an email,
-- because X sign-in usually gives us no email. Rebuild the table to make email optional.
CREATE TABLE access_requests_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  x_handle TEXT UNIQUE,
  website TEXT,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'invited', 'declined')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (email IS NOT NULL OR x_handle IS NOT NULL)
);
INSERT INTO access_requests_new (id, name, email, website, goal, status, note, created_at, updated_at)
  SELECT id, name, email, website, goal, status, note, created_at, updated_at FROM access_requests;
DROP TABLE access_requests;
ALTER TABLE access_requests_new RENAME TO access_requests;
CREATE INDEX idx_access_requests_status ON access_requests (status, created_at);

CREATE TABLE founders (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  privy_did TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  x_handle TEXT,
  role TEXT,
  onboarding_step INTEGER NOT NULL DEFAULT 1,
  onboarded_at TEXT,
  created_at TEXT NOT NULL,
  last_sign_in_at TEXT NOT NULL
);

-- Only a SHA-256 hash of each session cookie is stored.
CREATE TABLE founder_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  founder_id TEXT NOT NULL REFERENCES founders(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_founder_sessions_founder ON founder_sessions (founder_id);

-- Onboarding answers: what the founder builds, the partners they want and where.
CREATE TABLE founder_profiles (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  company_name TEXT,
  website TEXT,
  one_liner TEXT,
  buyers TEXT,
  goals_json TEXT NOT NULL DEFAULT '[]',
  markets_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
