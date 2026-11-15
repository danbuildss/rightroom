# Deploying Rightroom (Cloudflare free tier)

Dan does these steps in the Cloudflare dashboard. Claude never needs the account login or any key. Nothing here should cost money; check Cloudflare's current free-tier limits before starting and stop if anything asks for payment.

## Once: set up

1. **Cloudflare account.** Create one (free). No card is needed for Workers or D1.
2. **Database.** Storage & Databases → D1 → Create. Send Claude the **Database ID** (it isn't secret); it goes in `wrangler.jsonc`. ✅ Done (2026-11-14).
3. **Connect GitHub.** Workers & Pages → Create → Import a repository → `danbuildss/rightroom`. The Worker must be named `rightroom` (the name in `wrangler.jsonc`).
   - Build command: `npm run build` (or leave empty)
   - Deploy command: `npm run deploy` (creates or updates the database tables, then deploys)
4. **Admin key (the login, Option B, no card needed).** On a computer with the repo: `npm run admin:key`. It prints a long random key once.
   - Cloudflare: Workers & Pages → rightroom → Settings → Variables and Secrets → **Add → Secret**, name `ADMIN_TOKEN`, value = the key.
   - The type must be **Secret** (shown as hidden dots). If Cloudflare shows the value or suggests adding it to `wrangler.jsonc`, it was saved as Text: delete it, make a new key and add it again as Secret. Never put a secret in `wrangler.jsonc` (the repo is public).
   - `ADMIN_NAME` (recorded on reviews) is set in `wrangler.jsonc`, because plain settings added only in the dashboard are reset on each deploy.
   - Keep the key in a password manager. Never paste it in chat or commit it, and don't screenshot its value. If it leaks, make a new one and replace the secret.
5. **Tables.** If the deploy command above didn't create them: `npx wrangler d1 migrations apply DB --remote` from a computer with the repo.

Cloudflare Access (Zero Trust) can replace or sit alongside the admin key later; it asks for a card on file even on its free plan. The Worker supports both.

## Check it works

- `https://rightroom.<your-subdomain>.workers.dev/api/health` → `{"ok":true}` (public, no data).
- `curl -H "Authorization: Bearer $TALO_ADMIN_TOKEN" https://rightroom.<your-subdomain>.workers.dev/api/me` → `{"email":"dan"}`.
- Without the key, `/api/me` must answer 401 and return no data.

If no sign-in is configured, the API answers "Sign-in is not configured yet" (503) and returns no data. It fails closed.

## The marketing site and access requests

- `https://rightroom.<your-subdomain>.workers.dev/` shows the marketing site (files in `site/`, deployed with the Worker).
- Founders who fill in **Request access** are stored privately. See them (newest first):
  `curl -H "Authorization: Bearer $TALO_ADMIN_TOKEN" "$TALO_URL/api/admin/access-requests?status=new"`
- Record your decision after you've contacted someone yourself (`invited` or `declined`, optional note):
  `curl -X PATCH -H "Authorization: Bearer $TALO_ADMIN_TOKEN" -H "content-type: application/json" -d '{"status":"invited"}' "$TALO_URL/api/admin/access-requests/<id>"`
- Rightroom never emails anyone. The back office (next step) will show these in a page.

## The collector

- The hourly schedule is in `wrangler.jsonc` and starts when the Worker is deployed.
- Load the approved sources once: `npm run sources:seed` (with `TALO_URL` and `TALO_ADMIN_TOKEN` set as below). Sources marked "to confirm" start paused.
- Optional: a free GitHub token (no special permissions needed for public repositories) raises GitHub's limit from 60 to 5,000 requests an hour. Add it as a Secret named `GITHUB_TOKEN` in the Worker's settings. Never paste it in chat or commit it.
- Check health at `/api/admin/watched-sources` and `/api/admin/runs`; new finds wait at `/api/admin/inbox`.

## Pilot A: Grok signal search (optional, paid, capped)

Approved by Dan on 2026-11-14 with a **50 USD monthly cap**. Without a key, the Grok searches are skipped and nothing is spent.

1. Go to **console.x.ai** (xAI's developer console). A Grok app or X Premium subscription is **not** the same thing: the API needs its own credits.
2. Add a small amount of credit, and **set a monthly spending limit there** (the hard stop). Suggested: 50 USD.
3. Create an API key. In Cloudflare: Workers & Pages → talo → Settings → Variables and Secrets → add a **Secret** named `XAI_API_KEY`. Never paste it in chat or commit it.
4. Optional settings (plain variables): `GROK_MONTHLY_CAP_USD` (default 50), `GROK_MODEL` (default `grok-4.3`).
5. `npm run sources:seed` adds the 7 Grok searches with the other sources.

**The 3 USD test (Nov 2026):** set the console limit to 3 USD and add the plain variable `GROK_MONTHLY_CAP_USD = 2.5`. Leave `GROK_AUTO` unset, so Grok never runs on the hourly schedule; every search starts from Back office → Grok research, which shows its cost estimate first. Set `GROK_AUTO = on` only if Dan later approves scheduled searches.

Talo also stops itself: it estimates each search's cost, records it, and skips Grok searches for the rest of the month once the cap is reached. Check `/api/admin/spend`. Results go to the inbox only; every post is checked by a person before it becomes a signal.

## Curating data in production

Reviews happen through the admin API (screens come later). From a computer with the repo:

1. `export TALO_URL=https://rightroom.<your-subdomain>.workers.dev`
2. `export TALO_ADMIN_TOKEN=<your admin key>` (from your password manager)
3. `npm run registry:import -- file.json --dry-run`, then without `--dry-run`; `npm run data:audit`; `npm run sources:seed`.
4. **Review the queue:** `npm run review`. It shows one company or signal at a time and opens its source in your browser. Press **a** to approve (you'll say which page you checked; for signals, paste the page's exact sentence), **r** to reject with a reason, **s** to skip, **q** to stop. The server still enforces every rule.

Never paste the key into chat or commit it.

## Backups

- `npx wrangler d1 export DB --remote --output backup-YYYY-MM-DD.sql` (keep the file private; never commit it).

## The website on Vercel (main host)

The website is served from Vercel (Somehow Internet team); Cloudflare runs the API, the founder app back end and the database. `vercel.json` does the setup:
it serves the `site/` folder as it is and forwards every `/api/...` request to the Cloudflare Worker,
so the Request access form saves to the same database. Cloudflare stays the only back end.

When importing the repo in Vercel:
- **Application Preset:** choose **Other** (not Vite). `vercel.json` overrides it anyway.
- **Root Directory:** `./`. Leave Build and Output Settings and Environment Variables alone.
- Never add secrets (admin key, API keys) to Vercel: it doesn't need any.

If the Worker URL ever changes, update the `rewrites` destination in `vercel.json`.

## The back office (`/admin`)

Open `https://rightroom.<your-subdomain>.workers.dev/admin` and paste your admin key (the same `ADMIN_TOKEN`
you use with the scripts). The key stays in that browser tab only and is forgotten when you close it or press Lock.

- **Overview:** what needs you, collector health and spend.
- **Review:** each item arrives with its checks done (site loads, page names the company; the best matching
  sentence for signals). Approve, reject with a reason, or tick several and approve them together. Undo is offered after each action.
- **Inbox:** turn a collected item into a signal for review, or dismiss it.
- **Requests:** mark founders invited or declined after you've contacted them yourself.
- **Sources** (pause, resume, check now) and **Spend**.

The terminal tools (`npm run review` and the rest) still work the same way.

## Founder sign-in (Privy)

Founders sign in at `/app` with X, Google or an email code, through Privy. The Privy app ID is public and set in
`wrangler.jsonc` and `app/src/main.tsx`. No Privy secret is used anywhere.

Set up once in the Privy dashboard (dashboard.privy.io → the Rightroom app):
1. **Login methods:** turn on **Email**, **Google** and **X (Twitter)**. Turn off wallet login and any other method.
2. **Embedded wallets:** leave automatic creation **off**.
3. **Identity tokens:** turn on **"Return user data in an identity token"** (sometimes called identity tokens). Rightroom
   needs it to read the signed-in email or X handle; without it, sign-in stops at "Checking your invite…".
4. **Allowed domains:** add `https://rightroom.danewurum01.workers.dev` (and the Vercel address if you use it).
5. Later, optional: your own X and Google app credentials, so the sign-in screens say Rightroom instead of Privy.

Who can get in: people you mark **Invited** in `/admin` → Requests, or add with **Invite someone directly** (email or
X handle). Everyone else sees "You're not on the pilot list yet" and can request access. `/admin` → Founders lists who
has signed up. Deleting an account in the app removes everything Rightroom stores; their login record at Privy can be
removed in the Privy dashboard (Users).

For founder sign-in on the Vercel address, add that address (for example `https://<project>.vercel.app`, or the custom domain later) to **Allowed domains** in the Privy dashboard. If the founder API ever rejects changes from Vercel with "Requests must come from Rightroom", add the host to `APP_ORIGIN_HOSTS` in `wrangler.jsonc` (comma-separated).
