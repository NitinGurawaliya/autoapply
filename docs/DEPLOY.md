# DEPLOY — SwipeApply (web on Vercel, worker on a container host)

Two services, one database:

```
Browser ──> Vercel (Next.js web + API) ──> Neon Postgres <── Worker (Docker + Chromium)
                       enqueue (pg-boss) ─────────┘            polls queue, runs Playwright
```

The web app never runs a browser. The worker is the only place Playwright runs. They talk only through Neon (jobs, applications, answers, pg-boss queue). Nothing here has been deployed yet; treat the first deploy as a test.

The worker must run all the time: without it there is no job fetch (every 3 h), no discovery of new companies (daily), no new-match push and no applying. Every setting is listed in `.env.example`.

## 0. Before you start (changes to the repo)

1. **Prisma client on Vercel.** Done (11 Oct): `"postinstall": "prisma generate"` in `package.json`.
2. **Long resume parsing.** Done (11 Oct): `export const maxDuration = 60` in `src/app/api/profile/resume/route.ts`.
3. **Schedules.** Done: the worker registers them on start (`src/worker/schedule.ts`): ingest `INGEST_CRON` (default every 3 h, last `INGEST_DAYS` = 60 days) and discovery `DISCOVER_CRON` (default 01:30 UTC daily). Look for `ingest scheduled: ...; discovery ...` in the worker log after deploy.
5. **Rules file.** Done: `config/rules.json` ships with every route (`outputFileTracingIncludes` in `next.config.ts`).
6. **Browser push keys.** Generate one pair once: `npx web-push generate-vapid-keys`; set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` you) on web and worker, the same pair on both. A new pair later means every user turns notifications on again.
4. **Rotate secrets you pasted anywhere** (database password, API keys) before going live, and never commit `.env`.

## 1. Neon (database)

- Keep the project you have. Copy both URLs:
  - `DATABASE_URL` = **pooled** (`-pooler` host). Used by the web app.
  - `DIRECT_URL` = **direct** host. Used by migrations and pg-boss (web and worker).
- Apply migrations to production **once, from your laptop**, never from Vercel:
  ```bash
  npx prisma migrate deploy
  npm run seed
  ```
- pg-boss creates its own `pgboss` schema on first start. Both services connect with `DIRECT_URL`.
- Neon free tier suspends idle databases; the first request after a pause is slow and can time out. Expect occasional "can't reach database" and retry.

## 2. Google OAuth

In Google Cloud Console, edit your OAuth client:
- Authorized JavaScript origin: `https://<your-domain>`
- Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`
- Keep the localhost entries for development.
- If the consent screen is in "Testing" mode, only listed test users can sign in. Add yourself, or publish the app.

## 3. Web on Vercel

1. Push the repo to GitHub. Import it in Vercel (framework: Next.js, root: repo root).
2. Environment variables (Production):

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled URL |
   | `DIRECT_URL` | Neon direct URL |
   | `AUTH_SECRET` | `npx auth secret` output |
   | `AUTH_URL` | `https://<your-domain>` |
   | `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from Google |
   | `OPENAI_API_KEY` | your key |
   | `OPENAI_MODEL` | `gpt-4o-mini` (optional) |
   | `STORAGE_DRIVER` | `postgres` |
   | `ADMIN_EMAILS` | your own email, so only you can trigger a manual ingest |
   | `ENABLE_MOCK_FORM` | leave unset in production; `1` only on a staging deploy used for the end-to-end test |
   | `APP_URL` | `https://<your-domain>` (links in notification emails; worker too) |
   | `NOTIFY_WEBHOOK_URL`, `NOTIFY_WEBHOOK_SECRET` | optional, only if you want "needs you" emails (worker) |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | browser push (step 0.6); web and worker |

3. Deploy. Check: `/sign-in` loads, Google sign-in returns to `/onboarding/resume`, resume upload parses.
4. Do **not** set `DEMO_HEADED` on Vercel.
5. Resumes are stored in Postgres (`FileBlob`). Vercel limits request bodies to about 4.5 MB, which is fine for resumes.

## 4. Worker (Docker on Railway / Fly / a VM)

Use the official Playwright image so Chromium and its system libraries are present. **The image tag must match the installed Playwright version (1.63.0).**

`Dockerfile.worker` is in the repo (Playwright 1.63.0 image, `npm ci`, runs `node --import tsx src/worker/index.ts`, one process, so a stop signal reaches the worker once, browser profiles under `/data/browser-profiles`). Locally:

```bash
docker build -f Dockerfile.worker -t swipeapply-worker .
docker run --init --env-file .env -v swipeapply-profiles:/data/browser-profiles swipeapply-worker
```

- `npm run worker:prod` runs `tsx` without watching (`npm run worker` is `tsx watch`, for development).
- The worker needs the same variables as the web app except the `AUTH_*` ones, plus `VAPID_*` and `APP_URL`. Leave `DEMO_HEADED` unset (headless; there is no screen).
- No volume is needed: since T100 users' browser cookies are kept in the database (`browser-state/` files), so any worker replica can run any user. `/data/browser-profiles` holds only the pid lock.
- A restart is safe: an application cut off before Submit is picked up again by the next worker (up to twice); one cut off after Submit is marked "may have been sent, check your email", never sent twice.
- Parallelism: set `APPLY_CONCURRENCY` (default 3, max 24 per worker). Budget about 0.5 GB RAM per concurrent run plus headroom, so 3 runs want roughly 2 GB. A run waiting for a security code holds a slot for up to 10 minutes. More simultaneous submissions from one cloud IP may raise how often the employer asks for a verification code.
- Several replicas are safe for the queue and the per-user submit lock (it lives in the database), and each runs the stale-run reaper. Still start with **one replica** until the first end-to-end test passes. Two workers are safe for the queue, but run them only after the first end-to-end test passes.
- Give it at least 1 GB RAM (Chromium) and keep it always on (no scale-to-zero): it holds a browser open while it waits for a security code.
- Railway: New Project → Deploy from GitHub → set the Dockerfile path to `Dockerfile.worker` → add the variables. Fly: `fly launch --dockerfile Dockerfile.worker`, `fly secrets set ...`, `fly scale count 1`.
- Check the logs for `worker listening for apply and ingest`, then `<your-domain>/api/health`: `"worker": "up"` (the worker beats every minute), `lastIngest` within 3 hours, `lastDiscovery` within a day. It answers 503 when no worker has beaten for 5 minutes: point an uptime monitor at it.

## 5. End-to-end test (do this before trusting it)

1. Sign in on the production URL with a **test user** and upload a resume.
2. Run the mock path first: the mock form lives at `/mock/greenhouse` on the production URL. The worker must reach it, so a test profile (`isTest=true`) only works if the mock job's `applyUrl` points at your production domain, not `localhost:3000`. Update that Job row (or reseed with the production URL) before testing.
3. Right-swipe the mock job: status should go `queued → inspecting → filling → submitted`.
4. Then one real Greenhouse job you actually want, with a real profile. If a security-code screen appears, the popup should show on the production site; enter the code from the email.
5. Check the worker logs and the `ApplicationEvent` rows if anything stalls.

## 6. Known risks in production

- **Greenhouse verification.** A cloud IP and a headless browser are more likely to trigger the emailed security code than your laptop. This is likely, not confirmed. The manual code popup is the fallback.
- **Lever and Ashby** adapters are switched off (captcha and spam checks); their jobs are fetched but hidden from the feed.
- **Cold starts / Neon pauses** can fail the first queue call; retry.
- **Monitoring.** `/api/health` for uptime (worker heartbeat, last ingest and discovery); `npx tsx scripts/feed-report.ts` for daily freshness (new India jobs, failing companies, each profile's new matches). Add Sentry later.
- **Discovery yield.** Daily discovery re-checks Greenhouse companies that had too few India jobs (every 14 days) and asks the model for new names; by 11 Oct the model knew few names not already checked (0-2 a day). Most new companies will come with the Lever and Ashby boards.
- **Real applications.** Production submits real applications. Keep `config/rules.json` limits (`max_applications_per_day`, `min_match_score`) on.

## 7. Updating

- Web: push to `main`; Vercel redeploys.
- Worker: a push to `main` that touches the worker builds the image in GitHub Actions and pushes it to Docker Hub (`.github/workflows/worker-image.yml`); the home server picks it up within 5 minutes (section 8). Elsewhere, redeploy the container after any change under `src/modules` or `src/worker`.
- Schema change: run `npx prisma migrate deploy` first, then deploy web and worker.

## 8. Home server (a spare computer instead of a VPS)

The workers run on a computer that stays on, from the image GitHub Actions builds on every push to `main` and pushes to Docker Hub as `<DOCKERHUB_USERNAME>/swipeapply-worker:latest` (and `:<commit>`). The full setup is in the "SwipeApply home server" guide; the files are in `deploy/`.

- `deploy/docker-compose.yml`: two workers (`home-1`, `home-2`, 4 runs each), `restart: unless-stopped`, `init: true`, `stop_grace_period: 16m` so a restart or update lets the runs in progress finish (the worker stops taking jobs on SIGTERM and waits for them). Secrets in `deploy/.env.worker` and the image owner in `deploy/.env`, both gitignored (examples: `env.worker.example`, `env.example`).
- Updates: `deploy/update.sh` (`docker compose pull` then `up -d`) every 5 minutes from a systemd timer (`swipeapply-update.service` and `.timer`). An unchanged image leaves the workers alone.
- These workers have no screen, so they never take the `apply-handoff` queue (Ashby). Ashby applications wait there for a worker on a computer where a person presses Submit (`npm run worker:prod` on your own machine).
- GitHub repository secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (write). The home server logs in with a separate read-only token. Keep the Docker Hub repository private: the image holds the code (never the secrets).
- Uptime: point a monitor at `/api/health` (503 when no worker has beaten for 5 minutes).
