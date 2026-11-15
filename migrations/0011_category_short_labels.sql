-- Short names for founder-facing chips and cards. The full label stays for the back office and tooltips.
ALTER TABLE categories ADD COLUMN short_label TEXT;
UPDATE categories SET short_label = 'AI infra' WHERE slug = 'ai-dev-infra';
UPDATE categories SET short_label = 'Payments' WHERE slug = 'payments';
UPDATE categories SET short_label = 'Dev platforms' WHERE slug = 'dev-platforms';
UPDATE categories SET short_label = 'MCP' WHERE slug = 'mcp';
UPDATE categories SET short_label = 'SDKs' WHERE slug = 'sdk';
