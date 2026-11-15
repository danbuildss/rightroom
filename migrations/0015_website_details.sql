-- Details read from a company's own homepage (no review needed: it is the company's own site).
-- X and GitHub are stored as aliases, docs and partner page as sources; these are the rest.
CREATE TABLE company_web_links (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('linkedin', 'email', 'contact_form')),
  value TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('website', 'dan')),
  found_at TEXT NOT NULL,
  PRIMARY KEY (company_id, kind)
);

-- When each company's website was last read, what was found, and what Dan removed
-- (a removed detail is never filled in again automatically).
CREATE TABLE company_enrichment (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  found_json TEXT NOT NULL DEFAULT '{}',
  note TEXT,
  blocked_json TEXT NOT NULL DEFAULT '[]'
);
