-- One-time clean-up: suggestions from the website reader that are investors, advisors or board members
-- (the first version took a bare "Partner" or a "Backed by" list as contacts). Rejected, with a reason.
UPDATE company_contacts
SET status = 'rejected', rejected_reason = 'Investor, advisor or board member (automatic clean-up)', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'needs_review' AND created_by = 'website-reader' AND kind = 'person' AND (
  lower(role) LIKE '%investor%' OR lower(role) LIKE '%angel%' OR lower(role) LIKE '%advis%' OR lower(role) LIKE '%board%'
  OR lower(role) LIKE '%venture%' OR lower(role) LIKE '%capital%' OR lower(role) LIKE '%fund%' OR lower(role) LIKE '%backer%'
  OR lower(role) LIKE '%mentor%' OR lower(role) LIKE '%general partner%' OR lower(role) LIKE '%managing partner%'
  OR lower(trim(role)) IN ('partner', 'partners', 'vc')
  OR lower(role) LIKE 'partner at %' OR lower(role) LIKE 'partner, %'
);

-- Grok run log: also keep which posts each run kept, so the details read as results, not just counts.
ALTER TABLE grok_runs ADD COLUMN kept_json TEXT NOT NULL DEFAULT '[]';
