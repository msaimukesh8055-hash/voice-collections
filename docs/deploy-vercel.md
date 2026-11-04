# Deploy the web app to Vercel (M8)

The dashboard (`/`, `/shopkeepers`, `/calls`) and the shopkeeper phone page (`/phone`) are one static
Vite build. Vercel serves it over https (the phone page needs https for the microphone). The API
stays on Supabase (calls-api); only its allowed origins and the bot's link address change.

## What `vercel.json` does

| Setting | Value | Why |
|---|---|---|
| Install | `npm ci` | npm workspaces: the one lockfile is at the repo root |
| Build | `npm run build` (= `npm run build -w web`) | builds only the web workspace |
| Output | `web/dist` | Vite's output for the web workspace |
| Rewrites | every path except `/assets/…` → `/index.html` | `/phone`, `/calls?id=…` etc. load the app; real files are always served first, and a missing asset 404s instead of loading HTML |
| Headers | `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`, `Permissions-Policy: microphone=(self)` | no page can be framed; no referrer leaks; only this site may use the mic |
| Cache | `/assets/*` immutable for a year; everything else `no-cache` | file names carry a hash; `index.html` is always revalidated so a new deploy shows at once |

**Root Directory = repo root**, not `web`: the lockfile is at the root, and `web/vite.config.ts`
imports `supabase/functions/_shared` and `voice-agents` from outside `web/`. With Root Directory
`web`, `npm ci` has no lockfile to install from.

**No full Content-Security-Policy.** The Sarvam SDK loads its audio worklet from `blob:`/`data:`
URLs and opens a WebSocket to an address Sarvam signs at call time (host not fixed), so a correct
`script-src`/`connect-src` list can't be written without risking a broken call in the demo. Only
`frame-ancestors` is set.

## Vercel project settings (dashboard → Settings)

- **General → Framework Preset:** Vite
- **General → Root Directory:** empty (repo root). Build, Output and Install: leave the defaults off
  (`vercel.json` sets them)
- **General → Node.js Version:** 22.x
- **Git → Production Branch:** `main`
- **Environment Variables (Production):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `VITE_SUPABASE_REGION` (same values as `.env`; all public). Nothing else: no server secret ever
  goes to Vercel.

`vercel.json` only takes effect once it is on the branch being deployed. Until `feature/M8-vercel`
is merged, deploy from that branch with the CLI (below).

## Laptop steps

Run these from the repo root on the `feature/M8-vercel` checkout (or `main` after merge):

```bash
npx vercel link
```

```bash
npx vercel env add VITE_SUPABASE_URL production
```

```bash
npx vercel env add VITE_SUPABASE_ANON_KEY production
```

```bash
npx vercel env add VITE_SUPABASE_REGION production
```

```bash
npx vercel --prod
```

Note the production address it prints, e.g. `https://<project>.vercel.app`. Then in `.env`:

- `CORS_ALLOWED_ORIGINS`: add `https://<project>.vercel.app` (comma-separated, exact origin: `https`,
  no trailing slash, no path). Keep the localhost entries for `npm run dev`.
- `DASHBOARD_URL=https://<project>.vercel.app`

Upload the secrets and redeploy the functions:

```bash
npm run functions:deploy
```

Only the stable production address works with calls-api. Preview deploys get a different address
each time; calls-api refuses them (CORS) unless that exact origin is added too.

## Verify

1. Open `https://<project>.vercel.app/phone` in a desktop browser: the phone page loads (not a 404).
2. WhatsApp the bot "dashboard". The link starts with the Vercel address; tap it on the mobile. The
   dashboard loads data and the address bar no longer shows `#t=…`. Open a shopkeeper and a call.
3. On the mobile, open `/phone` in **Chrome** (not the WhatsApp in-app browser, whose mic support
   varies), allow the microphone, send a one-person Remind for Ramesh, accept the call and talk.
4. Devtools → Network on any page: the response headers above are present; `/assets/*` shows
   `immutable`.

If the dashboard shows an error and the console says CORS: `CORS_ALLOWED_ORIGINS` doesn't contain
the exact origin, or `npm run functions:deploy` wasn't re-run.

If the Vercel build says `failed to resolve import "zod"`: the lockfile had marked `zod` as a peer
package, and Vercel's npm skips those. Fixed on this branch: `web/package.json` declares `zod` and
the lockfile was regenerated. Reproduce locally with `npm ci --omit=peer && npm run build`.
