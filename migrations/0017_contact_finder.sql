-- Points of contact found automatically (company's own team/about pages, partner pages, Grok with cited posts).
-- They are added to company_contacts as needs_review; this records when each company was last looked at.
ALTER TABLE company_enrichment ADD COLUMN contacts_checked_at TEXT;
