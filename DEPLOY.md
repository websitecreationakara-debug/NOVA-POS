# Deploying NOVA-POS to Vercel

NOVA-POS is a Next.js 16 app (App Router, Supabase, Tailwind 4) hosted on **Vercel**.

## Current setup (as configured today)

| Thing | Value |
| --- | --- |
| Vercel team | `website-creation1` (Hobby plan) |
| Vercel project | `akara-pos` |
| GitHub repo | `websitecreationakara-debug/NOVA-POS` |
| Production branch | `master` |
| Production URL | `https://akara-pos.vercel.app` |
| Custom domain | **not configured yet** (see [Section 3](#3-deploy-to-production--real-domain)) |

The project is already created and linked, so day-to-day deploys just involve
pushing branches. This document covers the two targets:

- a **preview URL** (per branch / per pull request)
- the **production** deployment (`akara-pos.vercel.app`, plus a real domain once added)

---

## 0. TL;DR — commands to deploy an update

### Update the PREVIEW URL (safe, does not touch production)

```powershell
git checkout -b my-change          # new branch (or: git checkout my-change if it exists)
git add -A
git commit -m "What changed"
git push -u origin my-change       # first push of the branch
# later pushes on the same branch:  git push
```

Vercel auto-builds and the preview is at:
`https://akara-pos-git-my-change-website-creation1.vercel.app`

### Update PRODUCTION (`akara-pos.vercel.app`)

```powershell
git checkout master
git pull
git merge my-change                # bring your branch into master
git push                           # <-- this deploys production automatically
```

Or, if you work directly on `master`:

```powershell
git checkout master
git add -A
git commit -m "What changed"
git push                           # <-- deploys production automatically
```

### Deploy with the Vercel CLI instead of Git

```powershell
vercel                             # deploy a PREVIEW, prints the URL
vercel --prod                      # deploy straight to PRODUCTION
```

### Redeploy the current production build (e.g. after changing env vars)

```powershell
vercel --prod --force
```

(or Vercel dashboard → Deployments → ⋯ → **Redeploy**)

---

## 1. Prerequisites (one-time)

- You are a member of the `website-creation1` Vercel team.
- Environment variables are set in Vercel → `akara-pos` → Settings → Environment
  Variables (see [Section 4](#4-environment-variables)).

Optional local CLI:

```powershell
npm i -g vercel
vercel login
vercel link      # select team "website-creation1", project "akara-pos"
```

---

## 2. Deploy to a preview URL

### Option A — Git (recommended, automatic)

Every push to any branch **other than `master`** creates a preview deployment.
Opening a pull request adds a comment with the preview link.

```powershell
git checkout -b my-feature
# ...make changes...
git add -A
git commit -m "Describe the change"
git push -u origin my-feature
```

Vercel then builds and gives you:

| URL | Description |
| --- | --- |
| `akara-pos-git-my-feature-website-creation1.vercel.app` | Stable per-branch URL. Always points to the latest commit on that branch. |
| `akara-pos-<hash>-website-creation1.vercel.app` | Unique per-commit URL. Pinned to one deployment. |

Preview deploys use the **Preview** environment variables.

> This also ticks the "Preview Deployment" item on the Vercel Production Checklist.

### Option B — Vercel CLI (deploy without pushing)

```powershell
vercel            # builds current folder, deploys a PREVIEW, prints the URL
```

### Promote a preview to production (no rebuild)

Vercel → `akara-pos` → Deployments → pick the deployment → **Promote to Production**.

---

## 3. Deploy to production / real domain

### Deploying

**Option A — Git (recommended, automatic):** merging or pushing to `master`
triggers a production deployment, served on `akara-pos.vercel.app` (and any custom
domain once added).

```powershell
git checkout master
git pull
git merge my-feature      # or merge the PR on GitHub
git push
```

**Option B — Vercel CLI:**

```powershell
vercel --prod
```

### Adding a custom domain (one-time, not done yet)

1. Buy a domain (any registrar), e.g. `akara-pos.com`.
2. Vercel → `akara-pos` → **Settings → Domains** → enter the domain → **Add**.
3. Vercel shows the DNS records to create. At the registrar:
   - Apex `example.com`: **A** record → `76.76.21.21`
     (or ALIAS/ANAME → `cname.vercel-dns.com` if the registrar supports it).
   - `www.example.com`: **CNAME** → `cname.vercel-dns.com`.
   - Or change the domain's nameservers to Vercel's and let Vercel manage DNS.
4. Wait for DNS to propagate; Vercel issues the TLS certificate automatically.
5. Choose the primary domain and set the other as a redirect (commonly
   `www` → apex).

After this, every production deploy is automatically served on the custom domain
— no per-deploy domain step. `akara-pos.vercel.app` keeps working too.

---

## 4. Environment variables

Set these in Vercel → `akara-pos` → Settings → Environment Variables. Source of
truth for the list is [`.env.example`](./.env.example).

| Variable | Environments | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Production / Preview / Development | Production = the live URL (`https://akara-pos.vercel.app` or the custom domain). |
| `NEXT_PUBLIC_SUPABASE_URL` | all | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Production / Preview | Server-only secret. Never commit. |
| `SORA_SAKE_PRODUCTS_API_URL` / `SORA_SAKE_PRODUCTS_API_KEY` | as needed | Storefront product API |
| `BOSBA_DRINK_SNACK_PRODUCTS_API_URL` / `BOSBA_DRINK_SNACK_PRODUCTS_API_TOKEN` | as needed | Storefront product API |
| `BOSBA_PREMIUM_FOODS_PRODUCTS_API_URL` / `BOSBA_PREMIUM_FOODS_PRODUCTS_API_KEY` | as needed | Storefront product API |

Notes:

- **Do not** set `VERCEL_OIDC_TOKEN` in the dashboard — Vercel injects it
  automatically. It only appears in `.env.example` for local/server use.
- After changing an environment variable you must **redeploy** for it to take
  effect (Deployments → ⋯ → **Redeploy**, or push a new commit).
- Pull the current values locally with `vercel env pull .env.local`.

---

## 5. Post-deploy checklist

- **Supabase Auth redirect URLs** — in the Supabase dashboard →
  Authentication → URL Configuration, add:
  - `https://akara-pos.vercel.app/**` (and the custom domain once added)
  - `https://akara-pos-*-website-creation1.vercel.app/**` (preview wildcard)
  Without these, login and auth callbacks fail on deployed builds.
- Run `npm run build` locally once before pushing to catch type/lint errors
  early (`next build`).
- `next.config.ts` sets `serverActions.bodySizeLimit: "6mb"`. Vercel's default
  request body limit is 4.5 MB on the Hobby plan — large uploads may need Pro or
  a direct-to-Supabase-Storage upload path.

---

## 6. Quick reference

| Task | Git | CLI |
| --- | --- | --- |
| Preview deploy | push any non-`master` branch | `vercel` |
| Production deploy | push / merge to `master` | `vercel --prod` |
| Promote existing preview | — | Dashboard → Promote to Production |
| Roll back | — | Dashboard → **Instant Rollback**, or promote an older deployment |
| Sync env vars locally | — | `vercel env pull .env.local` |
