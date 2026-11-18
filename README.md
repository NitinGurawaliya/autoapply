# SwipeApply

Upload your resume once, swipe right on jobs, and a governed AI agent applies for you. Every answer is traceable to its source, every step is logged, and nothing is submitted without your swipe.

Built for the AgentForge hackathon (3 Oct 2026) with a production architecture from day 1, and developed since into a working product for software engineers applying to startups and global companies.

- Product requirements: [docs/PRD.md](docs/PRD.md)
- Architecture (source of truth): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Task log: [docs/TASKS.md](docs/TASKS.md)
- Deployment: [docs/DEPLOY.md](docs/DEPLOY.md)
- The worker's browser: [docs/STEALTHY-BROWSER.md](docs/STEALTHY-BROWSER.md)
- Design spec: [docs/DESIGN.md](docs/DESIGN.md) and the screens in `design/`

## How it works

1. **Sign in with Google.**
2. **Upload your resume (PDF).** The agent reads your name, contact details, links, experience, education, skills and years of experience. You check and edit what it found.
3. **Answer a few common questions** once (current and expected CTC, notice period, preferred countries, work authorization and sponsorship when a country outside your own is chosen). They go into your answer bank.
4. **Swipe the feed.** Jobs are ranked by match score and freshness, each card showing why it fits. Right means apply, left means skip (keyboard ← → too). Filter by board, country, experience and posting date.
5. **The agent applies.** A right swipe queues an application. A separate worker opens the real job form in a real Google Chrome window, maps every field, fills it from your profile and answers, uploads your resume and submits.
6. **It guesses rather than waits.** A required question nothing else answers gets the agent's best guess from your resume, profile, your other answers and the job, shown afterwards as "Best guess" with its reason. Only what must never be guessed (identity documents and numbers, date of birth, criminal record, signatures, EEO questions) pauses the run as "Needs you": you answer in the app (or from a push notification), the answer is saved, and the run continues from the job URL. A question is never asked twice, and a guess is never reused as your own answer.
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
                  │  Worker (Node + Playwright   │  apply, ingest, discovery, prescan,
                  │  on a SeleniumBase Chrome)   │  stale-run reaper, heartbeat
                  │  src/worker, Docker image    │
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
| Worker | A separate Node process (`src/worker/index.ts`). Each run gets a real Google Chrome started by SeleniumBase in CDP mode (Python), which Playwright drives over DevTools, so job boards see a person's browser; shipped as `Dockerfile.worker` |
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
    apply/        runner, value resolver, guesses, governance hooks, the browser (real-browser.ts), board adapters (Playwright lives only here)
    governance/   rules from config/rules.json, checked in code
    account/      account settings and deletion
  lib/            db, queue, llm, storage, push, auth
  worker/         queue handlers (apply, ingest, prescan), schedules, reaper
prisma/           schema and migrations
config/rules.json governance limits
scripts/          backend checks (*-test.ts, *-smoke.ts), ingest, seed, reports, the Chrome launcher (seleniumbase_cdp_launcher.py)
tests/            Playwright end-to-end smoke test on the mock form
```

### The apply run

The runner is stateless and can be re-run from the job URL at any point. It never holds a browser open while waiting for you.

1. **Governance check** (`start`): profile present, daily and per-company limits, no duplicate role, test profiles only on the mock form.
2. **Inspect** the form through the board's adapter (`modules/apply/adapters/*`).
3. **Resolve every field.** Standard fields map by synonym rules, then a field-mapping cache, then the LLM (whose answer is cached). Each value carries its source: `resume`, `user`, `matched` (your answer to another wording, verified for this job), `derived` (proven by your profile, with the evidence shown), `ai_draft`, `default` or `guessed` (the agent's best guess, with its reason).
4. **Required answers nothing settles** are guessed and sent; only the questions that are never guessed end the run as `needs_input`, with the questions listed.
5. **Fill**, upload the resume, screenshot, run the `submit` governance check, then **submit** and confirm from the page. A board's own check (Workable's Turnstile, Ashby's spam check, Greenhouse's reCAPTCHA) does not fire in the SeleniumBase Chrome; one that still shows a puzzle or an image code is left to you in the window, never solved by the agent.
6. **Outcome:** `submitted` with a confirmation, `pending_verification` when it may have been sent but was not confirmed, `failed` or `blocked` with the reason. An error before Submit retries up to `max_attempts`; one after Submit is never retried blindly.

Concurrency is per worker (`APPLY_CONCURRENCY`), one Chrome per run, one submit at a time per user, and a reaper that recovers runs whose worker died. Every Chrome launch, attach and close is a line in `stealthy-browser.log` beside the worker.

## Governance (enforced in code)

- **Consent.** Submit only after your right swipe, only for a real profile (`isTest = false`), and only when `governance.check('submit')` passes. Test profiles run only against `/mock/greenhouse`.
- **Never invent a fact.** Only cover letters, free-text and essay questions may be AI-drafted, from your resume and the job only, at most `max_ai_drafts_per_application` per application; if you answered No to AI essays, you write them yourself.
- **Guess and send.** A guess is made only from your resume, profile, answers and the job, is labelled `guessed` with its reason, and is never reused as your answer. Identity documents and numbers, date of birth, criminal record, signatures, EEO questions, salutations and health are never guessed.
- **Sensitive answers are yours.** Pay and notice period come from your onboarding answers and are never AI-drafted. A per-job work authorization, sponsorship or relocation question nothing settles is guessed from your citizenship, the job's country and your answers.
- **EEO questions** default to "Decline to answer". Gender, race, veteran status and disability are never guessed.
- **Acknowledgements.** Privacy-notice, "my answers are true" and arbitration boxes are ticked only under your standing permission. Marketing opt-ins and certifications of fact are never auto-ticked.
- **Limits** in `config/rules.json`: minimum match score, daily cap, per-company per-week cap, applications in flight, AI drafts, attempts.
- **Audit.** Every rule check writes an `ApplicationEvent`; a blocked run ends `blocked` with the rule's name.
- **Personal data.** Resumes and screenshots are stored in Postgres behind `lib/storage.ts`, never in files on the server. Resume text, phone numbers and emails are never logged.

## Current features

**Jobs**
- Ingest from public, no-login job APIs: Greenhouse, Ashby, Lever, Workable, Keka, SmartRecruiters, Zoho Recruit and Workday (public CXS API), every few hours (`INGEST_CRON`).
- Daily discovery of new companies, from a crawl index, the boards' own search pages and hand-made board lists.
- Tagging by country (India, US, remote, other), remote type, experience, function, track and seniority; eligibility for candidates abroad.
- Match score (0–100) with a short "Why it fits", and semantic matching with embeddings. The feed shows only jobs in your experience band, level and field.
- Feed filters by board, country, experience and posting date; closed jobs drop out of the feed.

**Applying**
- Every form opens in a real Google Chrome started by SeleniumBase, so the board sees a person's browser; the worker presses Submit itself on every board below, and a check the board still shows (an image code, a bot check) waits in that window for you. The feed shows exactly these boards (one fixed list, `APPLY_BOARDS`); there are no per-board switches.
- Greenhouse: fully automatic, including its emailed security code (you enter it in an in-app popup).
- Ashby: fully automatic; a question that appears after an answer is filled too.
- Workable: fully automatic (its Turnstile stays silent in this Chrome).
- SmartRecruiters: automatic.
- Keka: automatic; an image code, when shown, is typed by you in the window.
- Not applied on (their jobs are still read): Zoho Recruit (one real submit so far), Lever (its hCaptcha shows a puzzle every time), Workday (no adapter).
- A mock Greenhouse form (`/mock/greenhouse`) for test profiles and the end-to-end test.
- Many swipes at once, with duplicate-role and per-company guards and one submit at a time per user.
- Cancel and retry from the UI; a cancel after Submit asks you instead of applying twice.

**Answers**
- Answer bank with canonical keys, so a question is asked once.
- Answer memory: retrieves your answer to a differently worded question and verifies it fits this job before reusing it.
- Standing answers for work abroad (sponsorship, relocation, citizenship), asked once.
- Multi-select ("Select all that apply") questions.
- Pre-scan of your feed for missing facts, so the gaps page asks before you swipe.
- Essay drafting from your resume and the job, within the per-application limit, unless you chose to write them yourself.
- Best guesses for the rest, each shown with its reason, so an application goes out instead of waiting on you.

**App**
- Mobile-first PWA in light and dark, matching the owner's design in `design/`.
- Live application status: segmented progress, then "Needs you", "Sent" or "Didn't go through" with the reason.
- Application detail with every field, its value, source badge and basis, screenshots and the event log.
- Governance page with the active rules and today's counters.
- Push notifications when an application needs you, and optional email through a webhook.
- `/api/health` reporting worker heartbeat, last ingest and last discovery.

**In progress** (see [docs/TASKS.md](docs/TASKS.md))
- A resume tailored to each job, in your own style (Phase L, designed in `docs/resume-tailoring/`).
- Naukri and LinkedIn through the user's own signed-in account (Phase K).

## Running it

Requirements: Node 20 or later, Python 3 with SeleniumBase (`pip install seleniumbase`) and Google Chrome for the worker, a Postgres database (Neon works), a Google OAuth client and an OpenAI key. Variables are listed in [docs/ARCHITECTURE.md §11](docs/ARCHITECTURE.md). Never commit `.env`.

```bash
npm install
pip install seleniumbase
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
| `npx tsx scripts/_stealthy-smoke.ts <form url>` | Opens the url in the worker's Chrome and prints PASS or FAIL |

The worker's Chrome is always a visible window. `STEALTHY_BROWSER=0` makes the worker use Playwright's own browser instead (headless); `STEALTHY_FALLBACK=1` allows that browser only when the SeleniumBase Chrome cannot start, otherwise such a run is retried later. The other variables are in [docs/STEALTHY-BROWSER.md](docs/STEALTHY-BROWSER.md).

### Deployment

- **Web:** Vercel, deployed on every push to `main`.
- **Worker:** the Docker image from `Dockerfile.worker`. A push to `main` that touches the worker builds it in GitHub Actions and publishes it to Docker Hub, and the home server pulls it within minutes. The image has no Python yet and no screen, so it reads jobs only; applications go to a worker on a desktop with a screen (`npm run worker:prod`), the only kind that takes the `apply` queue.
- **Details:** [docs/DEPLOY.md](docs/DEPLOY.md) has the full guide, including running the worker with a screen for boards that need a person.

## Testing

- `scripts/*-test.ts` are offline checks: adapters on recorded form markup, resolver, governance, matching, eligibility.
- `scripts/*-smoke.ts` exercise the database and queue. Some write to the database they point at, so run them against a test database.
- `scripts/_stealthy-smoke.ts` starts the worker's Chrome on a real form page and checks the page loads with no automation visible.
- An end-to-end Playwright test on the mock form (`tests/smoke.spec.ts`) is planned but not written yet.
