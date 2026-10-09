# DEPLOY — SwipeApply (web on Vercel, worker on a container host)

Two services, one database:

```
Browser ──> Vercel (Next.js web + API) ──> Neon Postgres <── Worker (Docker + Chromium)
                       enqueue (pg-boss) ─────────┘            polls queue, runs Playwright
```

The web app never runs a browser. The worker is the only place Playwright runs. They talk only through Neon (jobs, applications, answers, pg-boss queue). Nothing here has been deployed yet; treat the first deploy as a test.

## 0. Before you start (changes to the repo)

1. **Prisma client on Vercel.** Add to `package.json` scripts: `"postinstall": "prisma generate"`. Without it the Vercel build fails or uses a stale client.
2. **Long resume parsing.** In `src/app/api/profile/resume/route.ts` add `export const maxDuration = 60;` (Vercel's default is shorter than a parse plus LLM call).
3. **Ingest schedule.** Done: the worker registers it on start (`src/worker/schedule.ts`). Optional overrides: `INGEST_CRON`, `INGEST_DAYS`. Look for `ingest scheduled: ...` in the worker log after deploy.
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

3. Deploy. Check: `/sign-in` loads, Google sign-in returns to `/onboarding/resume`, resume upload parses.
4. Do **not** set `DEMO_HEADED` on Vercel.
5. Resumes are stored in Postgres (`FileBlob`). Vercel limits request bodies to about 4.5 MB, which is fine for resumes.

## 4. Worker (Docker on Railway / Fly / a VM)

Use the official Playwright image so Chromium and its system libraries are present. **The image tag must match the installed Playwright version (1.63.0).**

`Dockerfile.worker`:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.63.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/worker/index.ts"]
```

- Use `tsx` directly, not `npm run worker` (that one is `tsx watch`, for development).
- The worker needs the same variables as the web app except the `AUTH_*` ones: `DATABASE_URL`, `DIRECT_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `STORAGE_DRIVER`. Leave `DEMO_HEADED` unset (headless; there is no screen).
- Parallelism: set `APPLY_CONCURRENCY` (default 3, max 8). Budget about 0.5 GB RAM per concurrent run plus headroom, so 3 runs want roughly 2 GB. A run waiting for a security code holds a slot for up to 10 minutes. More simultaneous submissions from one cloud IP may raise how often the employer asks for a verification code.
- Several replicas are safe for the queue and the per-user submit lock (it lives in the database), and each runs the stale-run reaper. Still start with **one replica** until the first end-to-end test passes. Two workers are safe for the queue, but run them only after the first end-to-end test passes.
- Give it at least 1 GB RAM (Chromium) and keep it always on (no scale-to-zero): it holds a browser open while it waits for a security code.
- Railway: New Project → Deploy from GitHub → set the Dockerfile path to `Dockerfile.worker` → add the variables. Fly: `fly launch --dockerfile Dockerfile.worker`, `fly secrets set ...`, `fly scale count 1`.
- Check the logs for `worker listening for apply and ingest`.

## 5. End-to-end test (do this before trusting it)

1. Sign in on the production URL with a **test user** and upload a resume.
2. Run the mock path first: the mock form lives at `/mock/greenhouse` on the production URL. The worker must reach it, so a test profile (`isTest=true`) only works if the mock job's `applyUrl` points at your production domain, not `localhost:3000`. Update that Job row (or reseed with the production URL) before testing.
3. Right-swipe the mock job: status should go `queued → inspecting → filling → submitted`.
4. Then one real Greenhouse job you actually want, with a real profile. If a security-code screen appears, the popup should show on the production site; enter the code from the email.
5. Check the worker logs and the `ApplicationEvent` rows if anything stalls.

## 6. Known risks in production

- **Greenhouse verification.** A cloud IP and a headless browser are more likely to trigger the emailed security code than your laptop. This is likely, not confirmed. The manual code popup is the fallback.
- **Lever and Ashby** adapters are placeholders; those jobs are hidden from the feed.
- **Cold starts / Neon pauses** can fail the first queue call; retry.
- **No monitoring.** Watch worker logs; add Sentry later.
- **Real applications.** Production submits real applications. Keep `config/rules.json` limits (`max_applications_per_day`, `min_match_score`) on.

## 7. Updating

- Web: push to `main`; Vercel redeploys.
- Worker: redeploy the container after any change under `src/modules` or `src/worker`.
- Schema change: run `npx prisma migrate deploy` first, then deploy web and worker.
