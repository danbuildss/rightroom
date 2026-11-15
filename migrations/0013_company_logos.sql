-- Company logos for Explore and company pages: the company's own icon, read once from its own website
-- by the server and served from our domain. Raster images only (no SVG), at most 100 KB.
-- status: found (shown), none (nothing usable; initials shown), hidden (Dan turned it off).
CREATE TABLE company_logos (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('found', 'none', 'hidden')),
  content_type TEXT CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon')),
  bytes BLOB,
  source_url TEXT,
  note TEXT,
  checked_at TEXT NOT NULL,
  set_by TEXT NOT NULL,
  CHECK (status != 'found' OR (bytes IS NOT NULL AND content_type IS NOT NULL))
);
