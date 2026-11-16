# Decisions

Short records of technical decisions, newest first. Product decisions live in `PLAN.md`.

## 2026-11-16: The engine runs every 10 minutes, one small job at a time (free plan)
- **Why:** on 15–16 November nothing new arrived overnight. The single hourly job did everything at once, and on the free plan a run gets very little CPU time, so it was most likely cut off without a trace.
- **Now:** the Cloudflare cron trigger fires every 10 minutes (`*/10 * * * *`, free). Each run does one small task, taking turns (`worker/db/engine.ts`):
  - find new teams (Hacker News, GitHub, Inbox), each source about once a day
  - read 2 new teams' websites
  - collect signals from 1 due source
  - AI-check 2 new teams
  - fill links for 2 companies
  - find contacts at 1 company
  - find 2 logos
  - housekeeping

  A task with nothing to do hands over to the next (at most 3 per run). Pages are read up to 300 KB. Grok still never runs on the schedule.
- **Every run is recorded** in `job_runs` (migration 0021): the task, a plain-words summary and any error. A run still marked "running" after 15 minutes is shown as "Started, didn't finish", meaning Cloudflare cut it short. Back office → Home → **Engine status** shows today's totals, what's waiting for Dan, the last 60 runs and "Run one step now".
- **Back office menu:** 5 sections (Home, To review, Companies, People, Research & AI), each with tabs. Each section shows a count of what's waiting.

## 2026-11-15: Discover and company profiles (Explore, step 4)
- **Discover no longer hides open companies:** "Open to partners, outside your focus" lists up to 8 companies that share no sector or keyword with the founder (so they aren't a fit) but have readiness of 3 or more, such as a fresh partner program or a collaboration request. They're labelled "Open to partners", with no score. A link leads to Explore.
- **Possible partnership structures** on the company page: up to 3, chosen from verified signals and the confirmed company type and ordered by the founder's goals. Each has its reason (product integration, referral or reseller, joint launch or co-marketing, joining their ecosystem). Labelled as our suggestion.
- **Save → Pipeline:** once saved, the company page shows "Open in Pipeline →", and it reloads when a save happens anywhere.

## 2026-11-15: AI helpers through Dan's Bankr LLM gateway
- **Approved by Dan (about 300 USD of Bankr credit).** Back office only, and only public website text is sent: never founders' profiles, drafts, notes or pipeline. The privacy policy says public pages may be processed by AI services and that workspace data isn't.
- **The gateway:** OpenAI-compatible (`https://llm.bankr.bot/v1/chat/completions`, Bearer `BANKR_LLM_KEY`, a Cloudflare secret). Dan picks the model in Back office → AI helpers from Bankr's `/v1/models` list (`app_settings.ai_model`). It's off without both the key and a model.
- **Spend:**
  - every call is recorded in `ai_calls` (migration 0020), with tokens and an estimate based on `AI_PRICE_INPUT/OUTPUT_PER_M_USD` (defaults 3 and 15, cautious)
  - no call starts once `AI_MONTHLY_CAP_USD` (default 20) would be passed
- **What the AI helps with:**
  - **New companies:** is it a real company or product team (or a blog, portfolio, list or library), plus name, one-liner, type, sectors from our list only, stage and audience. Stored on the candidate as a suggestion; approving uses it, and Dan's edits win. 5 candidates per hour, plus a button.
  - **Contacts:** people who work at the company in useful roles, leaving out investors and advisors. **A name is kept only if it appears exactly in the page text,** so the AI can't invent anyone. Everything is still approved by Dan.
- **What it never does:** set a fit score, verify anything on its own, or see client data.

## 2026-11-15: Engine tuning after Dan's first run
- **Contacts:**
  - "Partner" on its own (as in "Partner at a fund") no longer counts as a partnerships role; it must be "Partnerships", "Partnership lead" and so on.
  - Investors, angels, advisors, board members, mentors, and roles at venture firms or funds are skipped.
  - People listed under an "Investors", "Backed by", "Advisors" or "Board" heading are skipped until a team or leadership heading.
  - A role naming another organisation ("Founder at OtherCo") is skipped.
  - Migration 0019 rejects existing waiting suggestions that look like investors, with a reason.
- **Grok, one place to see results:** the Grok page lists every post Grok found (search, date, text, link, state, 👍 / 👎). Run details now lead with the posts kept (`grok_runs.kept_json`) and put the counts after.

## 2026-11-15: Grok fix: match cited posts by number, and log every run
- **Bug:** Grok's answer names posts as `x.com/<account>/status/<id>`, while xAI often cites them as `x.com/i/status/<id>`. We compared whole links, so real posts were dropped as "not cited", and Dan's first searches found nothing. Posts are now matched on their status number. When the citation names the account, that name wins over Grok's. Handle and people evidence must still be a cited post by that same account (when the citation doesn't name the account, Grok's claim is used and Dan checks the link).
- **Run log (`grok_runs`, migration 0018):** every Grok call records:
  - the question, date range, model and max posts
  - posts read, listed, kept and dropped, with a reason for each drop
  - the start of Grok's answer
  - the cost

  Failures record xAI's own error message (never the key). Back office → Grok research → **Show details**.

## 2026-11-15: Points of contact (data engine, part C)
- **Where contacts are found:**
  - **The company's own pages:** the homepage plus up to 2 team, about or leadership pages it links to. Named people come from JSON-LD `Person` (with `jobTitle`), or a team grid where a name is followed by a role. Only roles worth contacting are kept (founder, CEO/CTO/COO, partnerships, BD, developer relations, ecosystem, alliances). A role title is never taken as a name. Confidence: high.
  - **Official channels:** the partner page and contact form the website reader already found.
  - **Grok company research:** up to 3 people per company, kept only when the evidence post is among xAI's citations **and** was posted by that same person. Confidence: medium; the source is their post.
- **Everything is a suggestion** (`company_contacts.status = needs_review`, `created_by` = website-reader or grok), never duplicated per company. Dan approves or rejects in batches on Back office → Contacts. Founders see only approved contacts. Never a guessed email.
- **When:** 3 companies are read per hour, re-read after 30 days (`company_enrichment.contacts_checked_at`, migration 0017). Newly approved companies are read straight away.
- **Explore cards** show the approved point of contact ("Contact: name · role"), choosing the highest confidence first.

## 2026-11-15: Finding early-stage teams (data engine, part B)
- **Sources, all free public APIs, each run about once a day by the hourly job (or "Find new teams now"):**
  - Hacker News "Show HN" posts from the last 7 days (hn.algolia.com search API), filtered by our sector words
  - GitHub repositories created in the last 30 days with at least 10 stars on our topics (mcp-server, ai-agents, x402, stablecoin, llm-tools) that list their own homepage
  - website domains already in the Inbox (MCP registry, Grok and other sources)
- **What counts:** only a product's own domain. Code hosts, social sites, app hosting (vercel.app, github.io…) and blogs are skipped. Domains that are already a company, or were proposed before, are skipped, so rejected teams never come back. At most 15 new candidates per run.
- **Each candidate's homepage is read** for its name (og:site_name or title), description (meta description) and links. Sectors come from our keyword list, and a type from simple word rules. All of these are suggestions.
- **Approving (Dan, up to 25 at a time):**
  - creates the company from its own homepage's details, verified against `https://<domain>`
  - sets an "Early stage" profile with the suggested type, confirmed by Dan's approval
  - keeps the place it was found as a source
  - fills in links and logo straight away
- Migration 0016: `company_candidates` and `discovery_state`.

## 2026-11-15: Details from the company's own website (data engine, part A)
- **Dan approved showing these without review,** because they come from the company's own homepage: X, GitHub, LinkedIn company page, docs, partner page, and a **published** partnerships email (partner, partnerships, bd, biz, business, alliances or integrations at the company's own domain) or contact form.
- **How they're read:** `shared/enrich.ts` reads only the homepage's `<a>` links. Social accounts are counted and the most-linked one wins (so the footer beats a one-off mention). Share, intent and status links, and reserved paths, are ignored. Nothing is guessed.
- **Where they're stored:** X and GitHub as aliases, docs and partner page as sources attached to the company, and LinkedIn, email and contact form in `company_web_links` (migration 0015).
- **Dan always wins:**
  - existing values are never overwritten
  - Dan's removals are recorded (`company_enrichment.blocked_json`) and never filled in again
  - setting a detail by hand lifts that block
  - removing docs or a partner page detaches the source but keeps it on record, because it may be evidence for a signal
- **Hourly:** 5 verified companies not read yet, or not for 30 days, plus "Fill links from websites now" (10 at a time) and "Read their website again" per company.

## 2026-11-15: Grok test (3 USD budget)
- **Manual only:**
  - The hourly schedule skips Grok sources unless `GROK_AUTO` is "on".
  - Every search starts from a button in Back office → Grok research, which shows a cautious estimate first. It assumes Grok reads three times as many posts as it returns, priced at the defaults in `shared/grok.ts`: 0.005 USD per post, and 1.25 / 2.50 USD per million input / output tokens (third-party listings, Nov 2026; to be confirmed against xAI's pricing page, which this session couldn't reach).
- **No search starts if it could pass the cap** (spent plus estimate). For the test, the cap is `GROK_MONTHLY_CAP_USD = 2.5`, and the xAI console limit of 3 USD is the hard stop.
- **Company research:** one search per company covering the last 30 days and up to 8 posts. Grok also names the official X account, but that becomes a suggestion only if its evidence post is among xAI's citations **and** was posted by that same account. Dan accepts or dismisses it; accepting replaces the company's X handle.
- **Three focused test searches** (AI and dev tools, payments and stablecoins, Base and onchain), each covering the last 7 days and up to 8 posts. They're added by a button and never run on their own.
- **Measuring value:**
  - Dan rates Grok results in the Inbox (👍 / 👎, stored on `collected_items.useful`).
  - The report shows searches run, cost, cited results, ratings, signals made, cost per useful result and cost per signal.
- Migration 0014: `collected_items.useful` and `rated_at`, plus `x_handle_suggestions`.

## 2026-11-15: Company logos and links
- **Logos are read once from the company's own site and served from ours:**
  - The server looks at the homepage's apple-touch-icon and icon links (on the company's own domain only), then `/apple-touch-icon.png` and `/favicon.ico`.
  - It keeps a raster image (PNG, JPEG, WebP, GIF or ICO, checked by its first bytes, at most 100 KB) in `company_logos` (migration 0013) and serves it at `/api/public/logos/:slug` with a versioned URL.
  - Founders' browsers never contact other sites, and no logo service is used.
- **No SVG,** because an SVG served from our domain could run script. API responses now also carry `sandbox` in their CSP.
- **Hourly:** up to 5 verified companies without a checked logo, or not checked for 30 days. A failed recheck or a bad replacement link never removes a logo that's showing.
- **Dan can** look again, give an image link (any https host, same checks), or hide a logo. Hidden logos stay hidden until Dan sets one.
- **Links on cards and company pages:**
  - website (the verified domain)
  - X and GitHub (the company's aliases)
  - partner page and docs (sources attached to the company, with its own site first)

  Dan adds or removes them in the back office; partner page and docs must be on the company's own domain. Shown only when we have them.
- **Brand rule:** a company's logo may appear next to its own name in the app to identify it; never on the marketing site or in a way that implies endorsement.

## 2026-11-15: Navigation, Home and the bell (Explore, step 3)
- **`GET /api/app/home`**:
  - counts (follow-ups due, saved, verified signals in the last 7 days)
  - the follow-ups due, oldest first
  - the top 3 Strong/Potential fits
  - the latest verified signals (by event date, or the day found when there's none), each with its primary source
  - the 4 most recently added verified companies

  It's all built from the founder's pipeline and verified records. An empty section says so.
- **`GET /api/app/updates` (the bell):** follow-ups due, plus verified signals from the last 14 days on companies the founder saved. The blue dot shows only when there's at least one item.
- **Navigation:**
  - Home (the landing tab), Explore (Core), Discover, Saved and Pipeline, each with a one-line description
  - Your company and Account & settings at the bottom
  - On phones, a top bar with a menu button opens the sidebar as a drawer. While closed, the drawer is `inert` so it can't be tabbed into; Escape closes it and returns focus to the menu button.
- **Account & settings** now holds sign-out, links to the privacy policy and terms, and account deletion (moved from Your company).
- **Sidebar icons:** `lucide-react` (ISC licence, pinned 1.65.0, tree-shaken so only the icons used are bundled), all 20px with a 1.75 stroke. Active item: blue-tint background, blue icon and label, and a blue edge bar. Hover: a warm background with the icon darkening.
- **Collapsible sidebar:** an icon rail of 76px with tooltips and the Saved count as a badge. The choice is remembered per browser (`localStorage`, with blocked storage handled). Phones always use the drawer.
- **Profile menu at the bottom:** initials, name and email; it opens Your company, Account & settings, Privacy and Sign out. Editing your answers now happens inside the sidebar layout; only first-time sign-up stays full-screen.

## 2026-11-15: Explore (Explore, step 2)
- **`GET /api/app/explore`** lists every verified, non-sample company for a signed-in founder, with search (all words must match the name, domain, description or category labels), filters (type, sector, country, partner goal, stage, audience), four sorts (newest signal, best fit, name, recently added) and pages of 24. It reuses Discover's loader, so fit, signals and saved state match everywhere.
- **Counts:** the category tiles count the search result; the other filters count within the chosen category. A tile or filter with nothing in it is not shown.
- **Only confirmed profiles count.** Type, country, stage and audience appear on cards and in filters only when `profile_status = 'confirmed'`.
- **Partnership types** come from fresh verified signals (the same goal-to-signal map Discover uses for mutual value), never from guesses. The **possible angle** is `suggest().for_you` from the company page, labelled "our suggestion"; with no verified signal, the card says there isn't enough to suggest one.
- **Fit on cards:** shown only for Strong or Potential fit. Explore never hides a company because of its fit.
- **Initials, not logos,** so we never show another company's mark. Explore is the landing tab until Home arrives; Explore and Discover stay mounted while a company page is open, so filters survive "← Explore".

## 2026-11-15: Company profile and the overlap rule (Explore, step 1)
- **Profile = Rightroom's labels, not verified claims:** `org_type`, `hq_country` (ISO two-letter code), `stage` and `audiences` on `companies` (migration 0012). Like categories, editing them never reopens review. They're shown to founders only when `profile_status = 'confirmed'`.
- **Suggestions are never shown as fact.** A profile in an import file, or the pre-filled one for the 49 companies verified so far (in migration 0012, from their verified descriptions and sectors), is stored as `suggested`. Dan confirms in the back office (one by one, by editing, or in a batch). Location is left empty, and stage is filled in only where a company is clearly established. Who confirmed and when is recorded.
- **No overlap, no fit:** `scoreCompany` returns `overlap` (shares a target or own sector, a keyword in the description, or a technology/ecosystem). Without it the label is `below`, so readiness and contact alone can't make a match. This was the "59/100, no shared sector" case: 1/3/5/5/2 = 60, labelled Potential fit before. The formula and weights are unchanged.

## 2026-11-15: Motion (audit batch 4: M1–M8, F4)
- **CSS animations, no motion library.** Everything is CSS keyframes and transitions plus a little React state (`app/src/motion.tsx`) and plain JavaScript on the site; no new dependencies. Each animation is listed in `brand/BRAND.md` and switched off under `prefers-reduced-motion`, where the finished state shows at once.
- **Toasts (`ToastProvider`, `useToast`)** confirm Save, Move, Remove, Copy, Draft saved and Notes saved, in one polite live region. Undo is offered for Save (removes the new pipeline entry) and Move (moves back). Remove keeps its confirm and has no Undo, because restoring would lose the timeline.
- **Pipeline moves are optimistic:** the card moves at once, then saves, then the list reloads from the server. Drag and drop uses native HTML drag events and is only offered on devices with a fine pointer and hover; the Move menu stays for phones and keyboards.
- **Hover card** on pipeline company names reuses the company page's API (`GET /api/app/companies/:slug`), fetched once per company after a 350ms hover and cached for the session. Mouse only and `aria-hidden`; the same facts are on the company page.
- **Weighted fit meter** draws the fixed formula's weights (30/25/20/15/10) as segment widths, each filled to its 0–5 score. It only displays the factor scores; the overall number still comes from the formula.
- **The homepage demo** keeps its HTML as the finished state, so without JavaScript or with reduced motion it is shown as is; it plays once when 40% of it is in view. The logo's door swing plays once per browser (`localStorage`), and not at all if storage is blocked.
- **Sign-in message:** if Privy signs someone in but no identity token arrives within 4 seconds, the screen says it's a setup issue rather than asking them to refresh.

## 2026-11-15: Quality fixes (audit batch 3: F2, F3, F5, F8)
- **Accessibility:** admin Requests tabs are a pressed-button group (not a half-built tablist); action columns have hidden header text; the admin sign-in is a `main` landmark; side panels are `div role="dialog"`; heading levels no longer skip (Discover card names are `h2`, detail headings `h3`). The browser scan now passes on all 24 screens.
- **Automated scan in the tests (`tests/a11y.test.ts`):** axe runs in jsdom over the static pages and server-rendered app screens (a Discover card with details open, the sign-in screen). Colour contrast needs real layout, so it stays in the browser audit. A self-check makes sure the scanner really flags problems.
- **Focus trap (`useFocusTrap`):** panels take focus on open, keep Tab and Shift+Tab inside, and return focus to the opener on close.
- **Short sector names:** `categories.short_label` (migration 0011) for founder-facing chips, cards and the pipeline; full names stay in the back office and as chip tooltips. The public API is unchanged.
- **Deleting an account also deletes the founder's access request** (matched by email or X handle); the privacy policy says so.

## 2026-11-15: Faster founder app (audit B4)
- **Privy loads only for sign-in.** The workspace (`App.tsx`, Discover, Company, Pipeline, drafts) has no Privy import; `Auth.tsx` (PrivyProvider and the sign-in screens) is loaded with `React.lazy` only when there's no Rightroom session. Signed-in founders load about 259 KB of JavaScript instead of 1.9 MB. A test keeps Privy out of the workspace files.
- **The sign-in screen appears instantly** as a placeholder with disabled buttons, and becomes live when Privy has loaded.
- **Signing out or deleting an account also ends Privy's session** the next time the sign-in part loads (a `localStorage` flag plus a prop), so Privy can't sign the founder straight back in.

## 2026-11-15: Brand assets and launch basics (audit batch 1)
- **Dan's logo** (`brand/assets/rightroom-icon.svg`) replaces the earlier redraw everywhere. The wordmark lockups are Geist 800 converted to outlines: made from a fixed-weight instance (fontTools) because opentype.js broke on variable outlines.
- **Web icons** (SVG plus 32/48 px PNG favicons, 180 px Apple touch icon, 192/512 px and maskable app icons) and a web manifest are linked on every page.
- **Link previews:** `/og.png` (1200×630) with Open Graph and X card tags on the public pages. Image URLs are absolute and use the workers.dev address until there's a custom domain (both Vercel and Cloudflare serve the same file).
- **Clean addresses:** links go to `/privacy` and `/terms` (Cloudflare serves them; Vercel has `cleanUrls`). Our own `robots.txt` hides /app, /admin and /api, and a sitemap lists the public pages.
- **Old name:** the collector now identifies itself as `RightroomCollector`, and user-visible messages say Rightroom.

## 2026-11-15: Privacy policy, terms, retention and the Vercel host
- **`/privacy.html` and `/terms.html`** describe only what the product does today. They say plainly that Somehow Internet isn't registered yet and that the legal entity, a contact email and the governing law come before public launch. Linked from the site footer, the access form and the sign-in screen. A lawyer should review them before launch.
- **Access requests are deleted 12 months after the decision** (hourly Cron, `purgeOldAccessRequests`). New, undecided requests are kept.
- **Vercel is the main website host;** Cloudflare runs the API and database. The founder API now accepts changes from the Vercel address: the host Vercel forwards from (`x-forwarded-host`) or hosts listed in `APP_ORIGIN_HOSTS`. JSON-only bodies and no CORS still block other sites.

## 2026-11-15: Saved and Pipeline
- **`founder_saved` + `founder_pipeline_events` (migration 0010)**, private per workspace. Stages: Shortlisted → Contacted → In discussion → Partnered. Saving is idempotent; a company can be saved once per founder.
- **"I sent it" updates the pipeline:** it saves the company if needed, moves it from Shortlisted to Contacted (never backwards), and suggests a follow-up 7 days later only if none is set. Every change goes in the timeline.
- **Follow-ups are reminders inside the app only.** "Due" means today or earlier, and Partnered companies don't count. Nothing is emailed.
- **API:** `POST /api/app/companies/:slug/save`, `GET /api/app/pipeline` (items + due count), `PATCH/DELETE /api/app/pipeline/:id`, `GET /api/app/pipeline/:id/timeline`, all workspace-scoped (another founder's items answer 404). Discover results and the company page include the saved stage.
- Cards don't show the fit label, to keep the board fast; the company page has it.

## 2026-11-15: Draft introduction
- **Drafts come from templates, not AI** (`shared/draft.ts`): first message, shorter and follow-up. They use only the company's latest verified signal, a verified named contact (else "the {company} team") and the founder's own answers.
- **The one sentence about fit is left in [brackets] for the founder to write**, because we can't verify what they offer. Copy and "I sent it" warn while brackets remain.
- **`founder_drafts` (migration 0009)** is private to the workspace. "Sent" only records that the founder said they sent it, and when. Rightroom sends nothing.
- **API:** `GET /api/app/companies/:slug/draft` (generate, not saved; `variant`, `to`, `via`), `GET/POST /api/app/companies/:slug/drafts`, `PATCH/DELETE /api/app/drafts/:id`, all workspace-scoped (another founder's draft answers 404).

## 2026-11-15: Company intelligence
- **`GET /api/app/companies/:slug`** (founder session): one verified company, scored for that founder, with verified signals, **verified** contacts only and Rightroom's suggestions.
- **Suggestions are rules, not AI** (`shared/intel.ts`): "for you", "for them" (from the founder's own one-liner), suggested role (by goal, plus "whoever runs the partner program" when there is one) and best approach (partner program, then a verified channel, then the website). Always labelled "Our suggestion", with what they were built from.
- **Contacts (`company_contacts`, migration 0008)** follow decision C: a named person needs a name, role and public source page; channels are links (no email addresses). Dan adds them in `/admin` → Companies; they start as needs_review and founders see them only once approved, with the date checked and a confidence label. Approved contacts also raise the contact-access factor.
- Save and Draft introduction show as disabled with *Soon* / *Next step* until those steps are built.

## 2026-11-15: Discover (rule-based, no AI)
- **`GET /api/app/discover`** (founder session) ranks verified, non-sample companies only. Searches are read with word lists (`shared/discover.ts`): sectors and technologies map to category slugs, partnership words to goals. Places are recognised but not filtered ("location filter coming soon"), because we don't store where companies operate yet. "US"/"UK" only count in capitals, so "help us" isn't a place.
- **Scores use the fixed formula** (weights 30/25/20/15/10) with factor scores worked out from data we hold:
  - Alignment: shared categories and description words.
  - Mutual value: the founder's goals matched to fresh signal types.
  - Readiness: explicit or implied intent signals and their freshness.
  - Contact: 5 with a verified named contact at high confidence, 4 at lower confidence, 3 with a verified official channel or partner page, otherwise 2 (from step 5, contacts Dan approves count).
  - Feasibility: shared technology or ecosystem.
  - Every factor carries a one-line reason.
- **Labels:** Strong ≥ 75, Potential 55–74; lower scores aren't listed. With no verified signal, evidence is Low and the card says "Needs verification" instead of a score (shown only when the company clearly matches the search).
- **The founder can correct what was read** (remove tokens; `cats` and `goals` override the parse) and filter by a sector chip. With no search, Discover ranks for the founder's onboarding answers.

## 2026-11-15: Founder sign-in and onboarding (Privy)
- **Privy for sign-in (X, Google, email), wallets off.** The founder app (`app/`, React + Vite) is built into `site/app/` at build and deploy time (`npm run build:app`; the output is git-ignored). Privy's React library is the supported route; its vanilla library says it isn't for general use.
- **The Worker checks Privy's identity token itself** (ES256, issuer `privy.io`, audience = app ID, Privy's published keys) and never trusts identity sent by the browser. No Privy secret is needed.
- **Rightroom's own session:** a random cookie (`__Host-rr_session`, HttpOnly, Secure, SameSite=Lax, 30 days); only its SHA-256 is stored. Changes must come from this site's pages as JSON (Origin check), which blocks cross-site form posts.
- **Invite-only:** a session is created only for identities on the invited list (email or X handle) or founders who already signed up. Access requests now accept an X handle; email became optional (migration 0007 rebuilds the table).
- **Each founder gets a private workspace** (`founders`, `founder_sessions`, `founder_profiles` all carry `workspace_id`); deleting the account deletes the workspace and everything in it.
- **`/app` has its own Content Security Policy** allowing Privy (`auth.privy.io`) and Cloudflare Turnstile, which Privy uses for bot checks. Privy's wallet list request to WalletConnect stays blocked; it isn't needed with wallets off.
- **Dependencies pinned exactly, at versions at least two weeks old.** `npm audit` flags issues in wallet libraries bundled inside Privy (ws, old zod, uuid, decode-uri-component); they're denial-of-service class and in wallet code we don't use. Revisit when Privy updates.

## 2026-11-15: Back office
- **Static pages at `/admin`** (plain JavaScript, no build, same strict CSP), calling the existing admin API with the admin key as a Bearer token. The key is kept in `sessionStorage` (this tab only), never in `localStorage` or a cookie. Admin pages send `noindex` and `no-store`. Google sign-in replaces the key later.
- **`POST /api/admin/review/batch`** applies up to 50 reviews, each under the same rules as a single review; failures are reported per item and don't stop the rest. Undo uses the existing `reopen` action, so the review log keeps everything.
- **The server now refuses to verify a signal whose excerpt is still a search summary** (`needsExactExcerpt`, moved to `shared/signals.ts`). Before, only the terminal review tool checked this.
- **`GET /api/admin/overview`** returns the counts the Overview page needs in one call. `waiting` matches the review queue (sample records included); `public_companies` counts verified, non-sample companies.
- **Batch approval only for items whose checks passed** (company: site loads and names it; signal: company verified, excerpt is the page's words, page loads). That's a page rule to save clicks; the server rules are unchanged and still apply to every item.
- Evidence is loaded three items at a time and 15 cards per page, so opening the queue doesn't flood outside sites.

## 2026-11-15: Optional Vercel copy of the site
- **Vercel serves only the static `site/` folder** (`vercel.json`: no install, no build). `/api/*` is rewritten to the Cloudflare Worker, so the form keeps one database and the Worker stays the single back end. No secrets on Vercel.
- **Same security headers** as `site/_headers`, checked by a test so the two copies can't drift.

## 2026-11-15: Marketing site and Request access
- **The site is static files in `site/`, served by the same Worker** with Workers Static Assets (free). `/api/*` always runs the Worker first; any other unknown path gets `site/404.html`.
- **No third-party requests:** Geist fonts are self-hosted (OFL licence in `site/fonts/OFL.txt`), no analytics, no CDN scripts. A strict Content Security Policy in `site/_headers` allows only the site's own files, so the HTML has no inline scripts or style attributes (a test checks this).
- **Request access is real:** `POST /api/public/access-requests` (no login) stores name, email, website and goal in `access_requests` (migration 0006). Same email again updates a still-new request and gets the same answer, so the form never reveals who applied. A hidden honeypot field drops bots silently; a site-wide limit of 30 an hour and a 16 KB body cap blunt spam. Works without JavaScript (redirects to `/thanks.html`).
- **Dan reviews requests** with `GET /api/admin/access-requests` and records a decision with `PATCH /api/admin/access-requests/:id` (`new` / `invited` / `declined`). Nothing is emailed automatically. The table is admin-only and listed as shared in the isolation test (it exists before any workspace).
- **Sign in** points to Request access until Google sign-in is built (step 3); its tooltip and the form note say sign-in opens for invited founders.

## 2026-11-14: Public Discover API and evidence helpers
- **Public API (`/api/public/…`) is read-only and needs no login**, registered before the admin check. It returns only verified companies and verified signals of verified companies; stale signals appear with status `stale`. Sample records and internal fields (reviewers, rejection reasons, internal ids) are never returned. Responses may be cached for 60 seconds; everything else stays `no-store`.
- **Evidence helpers for reviewers** (`POST /api/admin/{companies,signals}/:id/evidence`): the Worker reads the source page and suggests the sentences that best match the claim (shared keyword overlap, `shared/evidence.ts`), or checks a company homepage loads and names the company. Suggestions only; approving is still a person's decision. Page reads are capped (10 s, 2 MB), http(s) only, and failures are reported plainly instead of erroring.

## 2026-11-14: Admin key login (Option B)
- **Why:** Cloudflare Zero Trust asks for a card on file even on its free plan; Dan chose not to. The admin API is protected by one long random key instead (`ADMIN_TOKEN`, a Cloudflare secret, 32+ characters; `npm run admin:key` makes a 48-character one).
- **How it's checked:** `Authorization: Bearer <key>`, compared in constant time (both sides hashed, then `timingSafeEqual`). A key shorter than 32 characters is ignored and the API fails closed. Reviews are recorded under `ADMIN_NAME`.
- **Cloudflare Access still works** if configured later; the Worker accepts either.
- **Trade-off:** anyone holding the key is admin, so it lives only in the Cloudflare secret and Dan's password manager, and is replaced if it leaks. Fine for a single admin; Access is better once there are several.
- **Worker renamed to `rightroom`** to match the Cloudflare dashboard; database commands use the binding name `DB`.

## 2026-11-14: Pilot A, Grok signal search
- **Why Grok, not follow-graph tracking first:** partnership signals are posts ("partner program", "looking for integration partners", "now live on Base"), and xAI's `x_search` finds posts at about 5 USD per 1,000 posts plus tokens. Tracking who accounts follow costs about 0.01 USD per account returned, too expensive for full lists; a small follow-watch pilot (B) needs a 5 USD test first.
- **Grok can't invent results:** a post is kept only if its link is an X post URL **and** xAI cited it in the search results. Links that appear only in Grok's own answer are dropped.
- **Two spending stops:** the xAI console's monthly limit (hard), and Talo's own ledger, which estimates each search conservatively and skips Grok searches for the rest of the month at the cap (default 50 USD). No key means skipped, not failed.
- **Same rules as every source:** results go to the inbox; a person verifies the post before it becomes a signal. Requests ask xAI not to store them (`store: false`). Official API only, no resellers.
- `watched_sources` was rebuilt to allow the new adapter (SQLite can't change a CHECK in place); data is copied unchanged.

## 2026-11-14: Collector (Talo Data, step 4)
- **The collector fills an inbox, never the feed.** New items from watched sources land in `collected_items`; a person turns one into a signal (writing the factual claim) or dismisses it. The collector never creates or verifies signals, and no AI runs in the Worker.
- **Four readers:** RSS/Atom, GitHub releases (REST API, optional free token), page change detection (stores only a fingerprint; the first visit is a baseline), and registry listings (the MCP Registry, and key maps like the elizaOS plugin index, where only new keys count; the first visit is a baseline).
- **Polite and inside free limits:** an hourly Cron checks at most 5 due sources; conditional requests (ETag / Last-Modified); 10-second timeout; 25 items per run; a clear User-Agent pointing to this repo.
- **Failures are visible, not fatal:** every run is logged; failures back off (interval doubled per failure, max 7 days) and a source pauses after 5 failures in a row. One broken source never stops the others; an unreadable response is logged as a failed run rather than stored.
- **Every watched source records why Talo may read it** (`terms_note`); sources whose address or access isn't confirmed start paused.
- **Suggested signal types are keyword hints only**; funding is never suggested.

## 2026-11-14: Admin curation API (Talo Data, step 3)
- **Imports are all-or-nothing and checked first.** A `talo.registry.v1` file is checked in full (clashes with the database and within the file, signals for unknown companies, unknown categories, repeated events) before anything is written; any problem rejects the whole file with row-by-row reasons. `?dry_run=1` checks only.
- **Editing verified facts reopens review.** Changing a verified company's name or description, or any field of a verified signal, sends it back to needs_review with a logged reason. Categories are Talo's own labels and don't reopen.
- **Command-line scripts call the API** (`registry:import`, `data:audit`), locally by default; in production they use the admin's own short-lived Cloudflare Access token.

## 2026-11-14: Signals and verification (Talo Data, step 2)
- **"Stale" is calculated, not stored.** A verified signal is shown as stale when its last check is older than its type's freshness window, so it can never be out of date. Stored statuses are needs_review, verified and rejected.
- **Verifying needs proof of where you looked.** A signal is verified only against one of its own sources; a company only against a page on its own domain. Rejecting needs a reason.
- **Every status change writes a review in the same database batch.** The review log is append-only (database triggers refuse edits and deletes), and the database refuses a verified record without a verification date or a rejected one without a reason.
- **Public = verified signal of a verified company.** A verified signal on an unverified company stays hidden and is listed in the audit.
- **Funding is not a signal type**, by design: it doesn't show partnership intent.
- **The audit is a function now** (`worker/db/audit.ts`); it becomes `npm run data:audit` / an admin endpoint with the curation API.

## 2026-11-14: Company registry (Talo Data, step 1)
- **Duplicates are stopped by aliases.** Every company has normalized aliases (name, domain, GitHub org, X handle) with `UNIQUE(kind, value)`. A new company that shares any alias is refused, naming the existing company. Names ignore case, punctuation and legal suffixes (Inc, Ltd…) but keep meaningful words (Labs, AI).
- **Near-duplicates are flagged, not blocked:** the same domain name on different endings (acme.ai / acme.com) or names one letter apart go to a person to decide; `mergeCompanies` combines them.
- **One URL, one source:** URLs are normalized (no www, fragment, tracking parameters or trailing slash; sorted query) before storing.
- **Shared tables are listed explicitly** in the isolation test, so every new table has to be classed as shared or private on purpose.
- New companies always start as `needs_review`; verification arrives with signals in the next step.

## 2026-11-12: Back-end foundation (Phase 3a)
- **One Cloudflare Worker** with Hono for routing and Zod for validation; D1 for data. Free tier.
- **Login = Cloudflare Access + a server-side check.** The Worker verifies the Access token (signature, issuer, audience, expiry) and an email allowlist on every `/api` request, and fails closed if not configured. A local-only shortcut exists for development (localhost + `ENVIRONMENT=development`).
- **Workspace isolation:** every table except `workspaces` has `workspace_id`; every query filters by it; a test checks the schema and that one workspace can't read another's data. Deleting a workspace deletes all its data (foreign keys with cascade).
- **Evaluations are stored, not just computed:** each scoring is saved with the calculated score, confidence and status, so history is kept when scores change.
- **Tests run in the real Workers runtime** with `@cloudflare/vitest-plugin` (the renamed `vitest-pool-workers`), against a real local D1.
- **Compatibility date 2026-08-22:** the newest date the local Workers runtime supports; production accepts it. Bump when tooling catches up.
- **`.npmrc` sets `legacy-peer-deps`:** npm 10 crashed resolving an optional Vitest peer; this keeps `npm install` working.

## 2026-11-12: Research formats (Phase 1)
- Three JSON formats (`talo.company.v1`, `talo.candidates.v1`, `talo.outreach.v1`) defined once in Zod, with generated JSON Schemas.
- Overall scores are calculated by code, never accepted from research files.
