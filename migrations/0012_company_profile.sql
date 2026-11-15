-- Company profile for Explore: type, headquarters country, stage and audience.
-- Rightroom's own labels, set or confirmed by Dan; changing them never reopens review.
-- profile_status: empty (nothing set), suggested (pre-filled or imported; hidden from founders), confirmed (shown).
ALTER TABLE companies ADD COLUMN org_type TEXT CHECK (org_type IN ('startup_product', 'platform_api', 'ecosystem', 'distribution', 'community_media', 'accelerator_program'));
ALTER TABLE companies ADD COLUMN hq_country TEXT CHECK (hq_country IS NULL OR (length(hq_country) = 2 AND hq_country = upper(hq_country)));
ALTER TABLE companies ADD COLUMN stage TEXT CHECK (stage IN ('early', 'growth', 'established'));
ALTER TABLE companies ADD COLUMN audiences_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE companies ADD COLUMN profile_status TEXT NOT NULL DEFAULT 'empty' CHECK (profile_status IN ('empty', 'suggested', 'confirmed'));
ALTER TABLE companies ADD COLUMN profile_confirmed_at TEXT;
ALTER TABLE companies ADD COLUMN profile_confirmed_by TEXT;
CREATE INDEX idx_companies_explore ON companies (status, profile_status, org_type);

-- Suggestions for the companies verified so far, from their verified descriptions and sectors.
-- Location is left for Dan; stage only where it's clearly established. Dan confirms or corrects each.
-- Slugs that don't exist (for example in a fresh test database) are simply not matched.
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'alchemy' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'bridge' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'browserbase' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = 'established', audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'circle' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = 'established', audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'cloudflare' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = 'established', audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'coinbase-developer-platform' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'composio' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'crewai' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'crossmint' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'dynamic' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'e2b' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'fireworks-ai' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = 'established', audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'github' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'langchain' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'letta' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'llamaindex' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'mem0' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'modal' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'moonpay' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'neon' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'netlify' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'openrouter' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'paxos' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'pinecone' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'postman' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'privy' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'railway' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'ramp-network' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'render' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'safe' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = 'established', audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'stripe' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'supabase' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'thirdweb' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'together-ai' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'transak' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = 'established', audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'twilio' AND profile_status = 'empty';
UPDATE companies SET org_type = 'platform_api', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'vercel' AND profile_status = 'empty';
UPDATE companies SET org_type = 'startup_product', stage = NULL, audiences_json = '["b2c","developers"]', profile_status = 'suggested' WHERE slug = 'bankr' AND profile_status = 'empty';
UPDATE companies SET org_type = 'startup_product', stage = NULL, audiences_json = '["b2b","developers"]', profile_status = 'suggested' WHERE slug = 'mintlify' AND profile_status = 'empty';
UPDATE companies SET org_type = 'startup_product', stage = NULL, audiences_json = '["b2c"]', profile_status = 'suggested' WHERE slug = 'rainbow' AND profile_status = 'empty';
UPDATE companies SET org_type = 'startup_product', stage = NULL, audiences_json = '["b2c"]', profile_status = 'suggested' WHERE slug = 'venice-ai' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'base' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'elizaos' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["b2c","developers"]', profile_status = 'suggested' WHERE slug = 'farcaster' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'hugging-face' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'nous-research' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["b2c","developers"]', profile_status = 'suggested' WHERE slug = 'uniswap' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["developers"]', profile_status = 'suggested' WHERE slug = 'virtuals-protocol' AND profile_status = 'empty';
UPDATE companies SET org_type = 'ecosystem', stage = NULL, audiences_json = '["b2c","developers"]', profile_status = 'suggested' WHERE slug = 'zora' AND profile_status = 'empty';
