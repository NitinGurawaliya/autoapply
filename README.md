# SwipeApply

Upload your resume once, swipe right on jobs, and a governed AI agent applies for you. Every answer is traceable to its source, every step is logged, and nothing is submitted without your swipe.

Built for the AgentForge hackathon (3 Oct 2026) with a production architecture from day 1, and developed since into a working product for software engineers applying to startups and global companies.

- Product requirements: [docs/PRD.md](docs/PRD.md)
- Architecture (source of truth): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Task log: [docs/TASKS.md](docs/TASKS.md)
- Deployment: [docs/DEPLOY.md](docs/DEPLOY.md)
- Design spec: [docs/DESIGN.md](docs/DESIGN.md) and the screens in `design/`

## How it works

1. **Sign in with Google.**
2. **Upload your resume (PDF).** The agent reads your name, contact details, links, experience, education, skills and years of experience. You check and edit what it found.
3. **Answer a few common questions** once (current and expected CTC, notice period, preferred countries, work authorization and sponsorship when a country outside your own is chosen). They go into your answer bank.
4. **Swipe the feed.** Jobs are ranked by match score and freshness, each card showing why it fits. Right means apply, left means skip (keyboard ← → too). Filter by board, country, experience and posting date.
5. **The agent applies.** A right swipe queues an application. A separate worker opens the real job form in a browser, maps every field, fills it from your profile and answers, uploads your resume and submits.
6. **It asks only what it cannot know.** A required question it has no answer for pauses the run as "Needs you". You answer in the app (or from a push notification), the answer is saved, and the run continues from the job URL. A question is never asked twice.
7. **Track everything.** Each application shows live progress, then every filled field with its value and source, screenshots, and the full event log.

## Architecture

```
                  ┌──────────────────────────────┐
  Browser  ─────► │  Next.js 16 web app (Vercel) │  UI + API routes; never launches a browser
  (PWA, push)     │  src/app, src/proxy.ts       │
                  └──────────────┬───────────────┘
                                 │ Prisma (pooled)         enqueue (pg-boss)
                                 ▼                                │
                  ┌──────────────────────────────┐                │
                  │   Postgres (Neon)            │ ◄──────────────┘
                  │   users, profiles, answers,  │
                  │   companies, jobs, apps,     │
                  │   events, files (FileBlob),  │
                  │   pg-boss queue tables       │
                  └──────────────┬───────────────┘
                                 │ Prisma (direct) + pg-boss
                                 ▼
                  ┌──────────────────────────────┐
                  │  Worker (Node + Playwright)  │  apply, ingest, discovery, prescan,
                  │  src/worker, Docker image    │  stale-run reaper, heartbeat
                  └──────────────┬───────────────┘
                                 ▼
               Job boards' public APIs and application forms
```

A modular monolith in one repo, deployed as two services.

| Layer | Choice |
|---|---|
| Web | Next.js 16 App Router (`src/proxy.ts`, not middleware), TypeScript strict |
| UI | Tailwind, shadcn/ui, Framer Motion; mobile-first at 390 px, light and dark |
| Database | Postgres on Neon through Prisma (`DATABASE_URL` pooled for web, `DIRECT_URL` for migrations and the queue) |
| Queue | pg-boss, Postgres-backed, so there is no Redis to run |
| Worker | A separate Node process (`src/worker/index.ts`) running Playwright; shipped as `Dockerfile.worker` |
| Files | `lib/storage.ts` over a `FileBlob` table (resumes, screenshots, browser cookies); an S3 driver can replace it |
| Auth | Auth.js v5 with Google |
| LLM | OpenAI Chat Completions (`gpt-4o-mini`, override with `OPENAI_MODEL`), JSON only and validated with Zod, all calls through `lib/llm.ts` |
| Push | Web Push (VAPID) with a service worker |

### Code layout

```
src/
  app/            pages (feed, applications, answers, gaps, governance, account, onboarding) and API routes
  modules/        shared by the web app and the worker, each exporting through index.ts
    profile/      resume parsing and the candidate profile
    answers/      canonical answer keys, the answer bank, answer memory
    jobs/         board fetchers, ingest, discovery, tagging, matching, the feed
    apply/        runner, value resolver, governance hooks, Playwright adapters (Playwright lives only here)
    governance/   rules from config/rules.json, checked in code
    account/      account settings and deletion
  lib/            db, queue, llm, storage, push, auth
  worker/         queue handlers (apply, ingest, prescan), schedules, reaper
prisma/           schema and migrations
config/rules.json governance limits
scripts/          backend checks (*-test.ts, *-smoke.ts), ingest, seed, reports
tests/            Playwright end-to-end smoke test on the mock form
```

### The apply run

The runner is stateless and can be re-run from the job URL at any point. It never holds a browser open while waiting for you.

1. **Governance check** (`start`): profile present, daily and per-company limits, no duplicate role, test profiles only on the mock form.
2. **Inspect** the form through the board's adapter (`modules/apply/adapters/*`).
3. **Resolve every field.** Standard fields map by synonym rules, then a field-mapping cache, then the LLM (whose answer is cached). Each value carries its source: `resume`, `user`, `matched` (your answer to another wording, verified for this job), `derived` (proven by your profile, with the evidence shown), `ai_draft` or `default`.
4. **Missing required answers** end the run as `needs_input`, with the questions listed.
5. **Fill**, upload the resume, screenshot, run the `submit` governance check, then **submit** and confirm from the page.
6. **Outcome:** `submitted` with a confirmation, `pending_verification` when it may have been sent but was not confirmed, `failed` or `blocked` with the reason. An error before Submit retries up to `max_attempts`; one after Submit is never retried blindly.

Concurrency is per worker (`APPLY_CONCURRENCY`), one shared Chromium with a context per run, one submit at a time per user, and a reaper that recovers runs whose worker died.

## Governance (enforced in code)

- **Consent.** Submit only after your right swipe, only for a real profile (`isTest = false`), and only when `governance.check('submit')` passes. Test profiles run only against `/mock/greenhouse`.
- **Never invent a fact.** Only cover letters, free-text and essay questions may be AI-drafted, from your resume and the job only, after your one-time permission, and at most `max_ai_drafts_per_application` per application.
- **Sensitive answers are yours.** CTC, salary, notice period, work authorization, sponsorship and relocation are never AI-drafted; missing means "Needs you".
- **EEO questions** default to "Decline to answer". Gender, race, veteran status and disability are never guessed.
- **Acknowledgements.** Privacy-notice, "my answers are true" and arbitration boxes are ticked only under your standing permission. Marketing opt-ins and certifications of fact are never auto-ticked.
- **Limits** in `config/rules.json`: minimum match score, daily cap, per-company per-week cap, applications in flight, AI drafts, attempts.
- **Audit.** Every rule check writes an `ApplicationEvent`; a blocked run ends `blocked` with the rule's name.
- **Personal data.** Resumes and screenshots are stored in Postgres behind `lib/storage.ts`, never in files on the server. Resume text, phone numbers and emails are never logged.
- **Anti-bot checks are respected.** CAPTCHAs and bot checks are never solved or bypassed. When a board wants a person, the run hands the form to you.

## Current features

**Jobs**
- Ingest from public, no-login job APIs: Greenhouse, Lever, Ashby, Workday (public CXS API) and Zoho Recruit, every few hours (`INGEST_CRON`).
- Daily discovery of new companies, from a crawl index and hand-made board lists.
- Tagging by country (India, US, remote, other), remote type, experience, function, track and seniority; eligibility for candidates abroad.
- Match score (0–100) with a short "Why it fits", and semantic matching with embeddings.
- Feed filters by board, country, experience and posting date; closed jobs drop out of the feed.

**Applying**
- Greenhouse: fully automatic in a real Chrome window, including its emailed security code (you enter it in an in-app popup).
- Ashby: the form is filled in a visible Google Chrome window. The worker can press Submit itself (`ASHBY_AUTO_SUBMIT=1`). When Ashby's reCAPTCHA or spam check stops it, the window is handed to you to finish.
- Lever: adapter in place and its jobs are fetched, but they stay out of the feed for now (the feed shows Greenhouse and Ashby, the boards it applies on).
- A mock Greenhouse form (`/mock/greenhouse`) for test profiles and the end-to-end test.
- Many swipes at once, with duplicate-role and per-company guards and one submit at a time per user.
- Cancel and retry from the UI; a cancel after Submit asks you instead of applying twice.

**Answers**
- Answer bank with canonical keys, so a question is asked once.
- Answer memory: retrieves your answer to a differently worded question and verifies it fits this job before reusing it.
- Standing answers for work abroad (sponsorship, relocation, citizenship), asked once.
- Multi-select ("Select all that apply") questions.
- Pre-scan of your feed for missing facts, so the gaps page asks before you swipe.
- Essay drafting from your resume and the job, under your one-time permission and the per-application limit.

**App**
- Mobile-first PWA in light and dark, matching the owner's design in `design/`.
- Live application status: segmented progress, then "Needs you", "Sent" or "Didn't go through" with the reason.
- Application detail with every field, its value, source badge and basis, screenshots and the event log.
- Governance page with the active rules and today's counters.
- Push notifications when an application needs you, and optional email through a webhook.
- `/api/health` reporting worker heartbeat, last ingest and last discovery.

**In progress** (see [docs/TASKS.md](docs/TASKS.md))
- Ashby by protection level: each company's reCAPTCHA level (`none`, `low`, `medium`, `high`) is read from Ashby's public posting API. `none` goes to any worker, including headless Docker. Protected companies go to a worker with a screen, where a person finishes any check.
- Naukri and LinkedIn through the user's own signed-in account (Phase K).

## Running it

Requirements: Node 20 or later, a Postgres database (Neon works), a Google OAuth client and an OpenAI key. Variables are listed in [docs/ARCHITECTURE.md §11](docs/ARCHITECTURE.md). Never commit `.env`.

```bash
npm install
npx prisma migrate deploy
npm run seed
npm run dev
```

In a second terminal:

```bash
npm run worker
```

The worker must be running for swipes to do anything.

| Command | What it does |
|---|---|
| `npm run dev` | Web app at http://localhost:3000 |
| `npm run worker` | Queue worker (apply, ingest, discovery, prescan), restarting on change |
| `npm run worker:prod` | The same without watching |
| `npm run ingest -- --days 7` | Fetch jobs from the last 7 days now |
| `npm run seed` | Upsert the company list |
| `npm run typecheck && npm run lint` | Type and lint checks |
| `npx tsx scripts/<name>-test.ts` | A backend check; each prints PASS or FAIL |

`DEMO_HEADED=1` runs the worker's browser in a visible window.

### Deployment

- **Web:** Vercel, deployed on every push to `main`.
- **Worker:** the Docker image from `Dockerfile.worker`. A push to `main` that touches the worker builds it in GitHub Actions and publishes it to Docker Hub, and the home server pulls it within minutes.
- **Details:** [docs/DEPLOY.md](docs/DEPLOY.md) has the full guide, including running the worker with a screen for boards that need a person.

## Testing

- `scripts/*-test.ts` are offline checks: adapters on recorded form markup, resolver, governance, matching, eligibility.
- `scripts/*-smoke.ts` exercise the database and queue. Some write to the database they point at, so run them against a test database.
- An end-to-end Playwright test on the mock form (`tests/smoke.spec.ts`) is planned but not written yet.
