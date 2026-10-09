# ARCHITECTURE — SwipeApply

Read PRD.md first. This doc is the source of truth for structure, data model and flows. Update it in the same change when a decision changes.

## 1. Principles

- Production shape from day 1: Postgres (Neon), a job queue, a separate worker process, a storage interface (files in Postgres now, S3-compatible later), stateless web. One repo. Runs on one laptop for the demo and deploys as two services later (web + worker).
- Modular monolith: every module lives in `src/modules/<name>` and is imported by both the web app and the worker. Modules never import from `app/`.
- Nothing lives in local files. Companies, jobs, profiles, answers, applications, events → Postgres (Neon). Resumes and screenshots → the storage interface (`FileBlob` table in Postgres for the MVP; any S3-compatible bucket later). Config that changes per environment → env vars. `config/rules.json` is the only checked-in config, and it is loaded into memory at startup.
- Deterministic first, LLM second. Standard fields are mapped by code. The LLM runs only for resume parsing, unknown field labels, free-text answers and (optionally) match reasons.
- Governance is code (`modules/governance`), never only prompts. Every agent decision is an `ApplicationEvent`.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 16 (App Router; `proxy.ts` instead of middleware), TypeScript strict | UI + API in one deployable |
| UI | Tailwind, shadcn/ui, Framer Motion, lucide-react | Fast, consistent |
| DB | Postgres on Neon via Prisma (any Postgres later) | Serverless Postgres, pooled + direct URLs |
| Queue | pg-boss (Postgres-backed job queue) | No Redis to run; same durability; swap to BullMQ later if needed |
| Worker | `src/worker/index.ts`, separate Node process (`npm run worker`) | Playwright never runs inside the web process |
| Browser | Playwright (Chromium), headed when `DEMO_HEADED=1` | Reliable fills, native file upload |
| Storage | `FileBlob` table in Postgres (`bytea`) behind `lib/storage.ts`; swap to S3/R2 later | No card, no extra vendor; same interface later |
| Auth | Auth.js (NextAuth v5) with Google provider + Prisma adapter | Users in our DB, no vendor lock-in |
| LLM | OpenAI Chat Completions, `gpt-4o-mini` (override with `OPENAI_MODEL`), JSON-only + Zod | The hackathon key on hand is OpenAI, not Anthropic |
| PDF text | `pdf-parse` | Simple |

## 3. Folder structure

```
swipeapply/
  CLAUDE.md
  docs/ (PRD.md, ARCHITECTURE.md, TASKS.md, DESIGN.md, DEPLOY.md, INGEST_CONTRACT.md, BLOCKERS.md)
  config/rules.json
  scripts/                       # ingest.ts, clear-queue.ts, ats-smoke.ts (live dry run), *-test.ts / *-smoke.ts checks
  prisma/schema.prisma
  prisma/seed.ts                 # seeds Company rows (source, slug, name)
  src/
    proxy.ts                     # Next.js 16 renamed middleware to proxy. Same redirects.
    app/
      (auth)/sign-in/page.tsx
      onboarding/resume|confirm|questions/page.tsx
      (app)/layout.tsx               # shell for signed-in pages: header, nav, account menu, input popup
      (app)/feed/page.tsx
      (app)/applications/page.tsx, (app)/applications/[id]/page.tsx
      (app)/answers/page.tsx         # saved answers (6.13)
      (app)/governance/page.tsx      # rules, counters, audit log (6.14)
      (app)/account/page.tsx         # export / delete my data (6.12)
      mock/greenhouse/page.tsx
      mock/submissions/page.tsx      # stored mock payloads, including resume file name
      api/
        auth/[...nextauth]/route.ts
        profile/resume/route.ts        # POST pdf → storage → parse → Profile
        profile/route.ts               # GET/PUT
        answers/route.ts               # GET/PUT/DELETE
        jobs/route.ts                  # GET with filters
        jobs/ingest/route.ts           # POST → enqueue ingest job (operators only)
        swipes/route.ts                # POST {jobId, direction} → lifecycle.swipeRight → enqueue apply
        applications/route.ts          # GET list
        applications/[id]/route.ts     # GET detail (status, fields, events)
        applications/[id]/answers/route.ts # POST → upsert answers → re-enqueue
        applications/[id]/cancel|retry/route.ts
        files/[...key]/route.ts        # owner-only file stream
        account/export|delete/route.ts
        mock/submit/route.ts
    worker/
      index.ts                   # pg-boss worker: handles 'apply' and 'ingest'
      handlers/apply.ts
      handlers/ingest.ts
      schedule.ts                # ingest cron (6.2)
      reaper.ts                  # fails runs of dead workers (6.8)
      single.ts                  # one worker per machine (6.16)
    lib/
      db.ts        # Prisma client
      queue.ts     # pg-boss client: enqueueApply(appId), enqueueIngest(days)
      storage.ts   # put(key, bytes) / get(key) / url(key) — Postgres FileBlob now, S3 later
      llm.ts       # callJson(schema, system, user, {cacheKey})
      auth.ts      # auth() helper, getCurrentUser()
      rate-limit.ts, notify.ts, explain.ts, rule-text.ts, mock-gate.ts, admin.ts   # see 6.10–6.14
    modules/
      profile/     parseResume.ts, profileSchema.ts, sampleProfile.ts
      answers/     keys.ts, answerBank.ts, questionKey.ts
      jobs/        fetchers/{greenhouse,lever,ashby}.ts, normalize.ts, tagging.ts, match.ts, ingest.ts,
                   listing.ts (is the job still listed), results.ts (per-company outcomes)
      apply/       adapter.ts, adapters/{common,greenhouse,lever,ashby,mock}.ts,
                   fieldMapper.ts, valueResolver.ts, runner.ts, browser.ts, pick.ts,
                   lifecycle.ts (swipe, cancel, retry), submitLock.ts, urls.ts (allowed hosts), acknowledgement.ts (6.18)
      governance/  rules.ts, audit.ts, history.ts (duplicate/company guards), overview.ts
      account/     export and delete a user's data
  tests/smoke.spec.ts
```

## 4. Data model (Prisma, Postgres)

Auth.js adds `Account`, `Session`, `VerificationToken` via its Prisma adapter; keep them as generated.

```prisma
model User { id String @id @default(cuid()); email String @unique; emailVerified DateTime?; name String?; image String?
  createdAt DateTime @default(now())
  profile Profile?; answers Answer[]; swipes Swipe[]; applications Application[]
  accounts Account[]; sessions Session[] }

model Profile { id String @id @default(cuid()); userId String @unique
  isTest Boolean @default(false)      // true → runner only allowed on mock form
  resumeKey String                    // storage key, bucket resumes
  resumeText String
  fullName String; email String; phone String?; city String?; country String?
  linkedin String?; github String?; portfolio String?
  yearsExperience Float?; currentTitle String?; currentCompany String?
  skills Json; experience Json; education Json; rawJson Json
  updatedAt DateTime @updatedAt
  user User @relation(fields:[userId], references:[id]) }

model Answer { id String @id @default(cuid()); userId String
  key String; question String; answer String; source String   // resume | user | ai_draft | default
  updatedAt DateTime @updatedAt
  user User @relation(fields:[userId], references:[id]); @@unique([userId, key]) }

model Company { id String @id @default(cuid()); source String; slug String; name String
  active Boolean @default(true); lastFetchedAt DateTime?; lastFetchCount Int?
  jobs Job[]; @@unique([source, slug]) }

model Job { id String @id @default(cuid()); source String; externalId String
  companyId String; company Company @relation(fields:[companyId], references:[id])
  title String; location String
  country String       // IN | US | REMOTE | OTHER
  remoteType String    // remote | hybrid | onsite | unknown
  experienceMin Int?
  description String; applyUrl String; postedAt DateTime; fetchedAt DateTime
  raw Json
  closedAt DateTime?   // the company's board no longer lists it (6.16)
  @@unique([source, externalId]); @@index([postedAt]); @@index([country]); @@index([source, country, postedAt]) }

model Swipe { id String @id @default(cuid()); userId String; jobId String; direction String
  createdAt DateTime @default(now()); user User @relation(fields:[userId], references:[id])
  @@unique([userId, jobId]) }

model Application { id String @id @default(cuid()); userId String; jobId String
  status String        // queued | inspecting | needs_input | filling | submitted | failed | blocked | cancelled
  attempt Int @default(0)
  fields Json          // FilledField[] {key,label,value,source,selector}
  pendingQuestions Json // PendingQuestion[] {key,label,type,options?,required}
  screenshotKey String?; error String?; submittedAt DateTime?
  verificationCode String?   // one-time ATS email code from the user; cleared the moment the worker reads it, never logged
  heartbeatAt DateTime?      // refreshed every 30 s by the worker running it; stale → reaped (6.8)
  createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  user User @relation(fields:[userId], references:[id]); events ApplicationEvent[]
  @@index([userId, status]) }

model ApplicationEvent { id String @id @default(cuid()); applicationId String
  type String          // rule_check | inspect | resolve | ask_user | fill | screenshot | submit | block | error | retry | cancel | diagnostic
  message String; rule String?; data Json?
  createdAt DateTime @default(now())
  application Application @relation(fields:[applicationId], references:[id]); @@index([applicationId]); @@index([applicationId, type, createdAt]) }

model FileBlob { key String @id; bytes Bytes; contentType String; size Int; userId String?
  createdAt DateTime @default(now()); @@index([userId]) }

model FieldMappingCache { id String @id @default(cuid()); source String; labelHash String; key String
  createdAt DateTime @default(now()); @@unique([source, labelHash]) }

model MockSubmission { id String @id @default(cuid()); payload Json; createdAt DateTime @default(now()) }

model SubmitLock { userId String @id; holderId String; expiresAt DateTime }   // one submit per user at a time (6.8)

model RateEvent { id String @id @default(cuid()); key String; createdAt DateTime @default(now())
  @@index([key, createdAt]) }                    // counted-rows rate limiter (6.12)
```

## 5. Canonical answer keys (`modules/answers/keys.ts`)

Identity: `first_name last_name full_name email phone city country linkedin github portfolio resume`
Work: `years_experience current_title current_company employment_type start_date preferred_location`
Sensitive (never AI-drafted; answer bank or ask user): `current_ctc expected_ctc salary_expectation notice_period work_authorization needs_sponsorship willing_to_relocate`
EEO (default "Decline to answer"): `gender race ethnicity veteran_status disability pronouns`
Misc: `how_heard` (default "Job board") · `cover_letter`, `free_text` (ai_draft allowed)
Permission: `accept_acknowledgements` (Yes/No, asked once; see 6.18)
Custom: `q_<12 hex>` = sha256 of the normalised label, for job-specific questions no canonical key covers (and for canonical fields whose value does not fit the form's options). Policy `bank_or_ask`, never AI-drafted; the answer is reused whenever the same label appears again.

Each key: `{key, type, synonyms: RegExp[], default?, policy: deterministic | bank_or_ask | ai_draft_ok | default_only}`.

## 6. Flows

### 6.1 Onboarding
1. `POST /api/profile/resume`: upload → `storage.put(`resumes/${userId}/resume.pdf`)` → `pdf-parse` → `llm.callJson(profileSchema)` → upsert Profile → seed Answer rows (identity/work keys, `source=resume`).
2. Confirm screen edits Profile and seeded answers (`PUT /api/profile`, `PUT /api/answers`). `/` and `/sign-in` still go to `/feed` once a Profile exists. `/onboarding/confirm` and `/onboarding/questions` stay reachable after that, so the candidate can correct the parse before the feed.
3. Questions screen writes `current_ctc expected_ctc notice_period employment_type preferred_location` (`source=user`), plus `work_authorization needs_sponsorship` if a non-India country is chosen.

### 6.2 Job ingest (worker job `ingest`, payload `{days}`)
1. Load `Company where active`.
2. Per company, call its fetcher:
   - Greenhouse `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` (date: `first_published` else `updated_at`)
   - Lever `GET https://api.lever.co/v0/postings/{slug}?mode=json` (date: `createdAt` ms)
   - Ashby `GET https://api.ashbyhq.com/posting-api/job-board/{slug}` (date: `publishedAt`)
3. `normalize.ts` → Job; `tagging.ts` → `country`, `remoteType`, `experienceMin` (regex + city tables; LLM only with `llmTag=true`).
4. Keep `postedAt >= now - days`; upsert by `(source, externalId)`; update `Company.lastFetchedAt/lastFetchCount`.
5. Scheduled: the worker registers a pg-boss cron on start (`src/worker/schedule.ts`): `INGEST_CRON` (default `0 */6 * * *`, UTC) with `{days: INGEST_DAYS}` (default 7), stored in the database so several workers registering it is harmless, with `missed: "once"` so a run that came due while every worker was down happens once when one returns. The worker logs `ingest scheduled: ...` on start. Check: `scripts/schedule-smoke.ts`. Manual: `POST /api/jobs/ingest` and `npm run ingest -- --days 7`.

### 6.3 Matching (`modules/jobs/match.ts`)
Feed and right-swipes are limited to `APPLY_BOARDS` (`modules/jobs/match.ts`): boards with a working apply adapter, currently `greenhouse` only (plus `mock` for test profiles). Lever and Ashby were switched off on 9 Oct 2026 until their adapters submit reliably. A board left out of the list is still ingested but hidden from the feed and its filters; a right-swipe or retry on one of its jobs returns 403 `board_not_supported`, and the runner blocks any application for it with the same rule, including ones queued or answered before it was switched off.
Deterministic 0–100: title overlap with current title/skills (40), skills overlap with description (30), experience fit (20), country/remote preference fit (10). Reason templated from the top overlaps. Feed: filters → exclude swiped → sort `score desc, postedAt desc`. Optional stretch: batched LLM reasons for the top 30, cached.
Experience (updated): the job's required years come from `requiredYears(title, description)` in `modules/jobs/tagging.ts` (title seniority such as Senior ≈ 5, Staff ≈ 8, Engineer II ≈ 2, intern/graduate = 0, plus "N+ years of experience" phrases; the stored `Job.experienceMin` is not used for scoring). The gap to the candidate's years sets the 20 experience points (≤0 → 20, 1 → 16, 2 → 8, 3 → 2, ≥4 → 0; unknown → 14) and caps the total (gap 2 → 50, 3 → 35, ≥4 → 25), so a seniority mismatch cannot be offset by a matching title or skills. The feed hides jobs under `min_match_score` and jobs above the `expMax` filter. Check: `scripts/match-test.ts`.
Feed card and filters: see docs/DESIGN.md ("Feed card"); `FeedJob` also carries `remoteType`, `requiredYears` and the matched `skillHits`.
Feed page: the header and filters render from the URL alone; the cards are a separate async component behind `Suspense` (keyed on the filters), so the page shows at once and the scored cards stream in. Feed UX: `swipe-deck.tsx` is optimistic. The card advances at once and the swipe POST runs in the background; a failed save puts the card back, a blocked one shows the rule. When 5 or fewer cards remain it fetches more from `/api/jobs` and de-duplicates against swipes made this session.
Applications UI: `/applications` (list with filters, polls while runs are active) and `/applications/[id]` (company, role, status, every filled field with its source badge, the pre-submit screenshot, and a timeline that includes the confirmation evidence). The needs-input popup names the company and role and says how many others are waiting. Check: `scripts/ui-smoke.ts`.

### 6.4 Swipe → queue
1. `POST /api/swipes {jobId, direction}`. Left → Swipe row. Right → `governance.check('swipe_right')` (daily cap, min score, profile exists) → Application `queued` → `queue.enqueueApply(applicationId)`.
2. Client polls `GET /api/applications/:id` every 1.5 s (SSE later).

### 6.5 Apply runner (worker handler, stateless, re-runnable)
```
load application, job, profile, answers, rules
governance.check('start')                       → block → status blocked (+ event)
if profile.isTest and adapter.source != 'mock'  → block (rule test_profile_mock_only)
browser.open(job.applyUrl)                      (headed if DEMO_HEADED=1)
adapter = pickAdapter(job.applyUrl, job.source)   # source wins: Greenhouse listings often link to company careers sites
browser.open(adapter.formUrl?(job) ?? job.applyUrl)
fields  = adapter.inspect(page)                 → FormField[] {selector,label,type,required,options}
keys    = fieldMapper.map(fields)               → synonyms → FieldMappingCache → LLM → cache
values, pending = valueResolver.resolve(fields, keys, profile, answers, rules)
   # order per field: user's answer to this exact label (q_ key) → acknowledgement (6.18) → answer bank → profile → key default → ask
   # option fields: value must match one of the form's options (exact, unique prefix, or a single numeric range);
   # EEO keys pick the form's own "decline" option; otherwise → ask
if pending.length: save pendingQuestions, status needs_input (attempt unchanged), event ask_user, close, return
adapter.fill(page, values)                      → event per field
adapter.uploadFile?(page, resume, bytes) ?? setInputFiles   (temp file deleted in finally)
screenshot → storage.put(`screenshots/${appId}/${attempt}.png`)
governance.check('submit')                      → block if fails
adapter.submit(page, {requestCode}); wait for confirmation (URL change / "thank you" text / form gone)
   # requestCode: when the ATS emails a one-time code mid-submit (Greenhouse "security code"), the runner sets
   # needs_input with pending [{key:"security_code"}] and KEEPS THE BROWSER OPEN, polling Application.verificationCode
   # every 2 s for up to 10 min. This is the one exception to "never hold a browser while waiting": the code is
   # bound to that browser session, so a re-run would trigger a new code. Up to 3 tries; timeout → failed (no retry).
status submitted, submittedAt, event submit
on error: attempt < 2 and not NoRetryError → event retry, re-enqueue; else status failed, error, event error
   # NoRetryError: thrown after the submit click (no confirmation, form rejected, CAPTCHA). Retrying could send a duplicate application.
finally: close browser
```
Needs-input resume: `POST /api/applications/:id/answers` upserts Answer rows (`source=user`) → `enqueueApply(id)`; the run starts again from the URL.
Security code: the same route, for key `security_code`, writes `verificationCode` and sets `filling` (the waiting worker picks it up); it is never stored in the answer bank. If the application has been waiting longer than 10 min (worker gone), it is re-queued instead.

### 6.6 Adapter interface (`modules/apply/adapter.ts`)
```ts
export interface AtsAdapter {
  source: 'greenhouse' | 'lever' | 'ashby' | 'mock';
  matches(url: string): boolean;
  formUrl?(job: { applyUrl; externalId; companySlug }): string;   // the real form when the listing is not the form
  inspect(page: Page): Promise<FormField[]>;
  uploadFile?(page: Page, value: ResolvedValue, bytes: Uint8Array): Promise<() => Promise<void>>;
  fill(page: Page, values: ResolvedValue[]): Promise<FilledField[]>;
  submit(page: Page): Promise<SubmitResult>;   // {confirmed: boolean, evidence: string}
}
```
`adapters/common.ts`: `fillText`, `selectOption`, `pickComboboxOption(labelText)`, `uploadFile(bytes, name)`, `waitForConfirmation`.

Ashby (`adapters/ashby.ts`): form address is the posting's `/application` page. Every question is an outermost `[data-field-path]` block (checkbox groups, which include most acknowledgements, do not carry the `.ashby-application-form-field-entry` class, so the class is never used to find questions); option text comes from the box's `label[for]`; a Yes/No pair counts as answered when a button is pressed (its hidden checkbox stays unticked for No); the adapter reads each block's one control (text, textarea, Yes/No button pair, radios, checkbox group, select, location type-ahead, date picker, file) and gives the mapper a `hintKey` for name, email, location and resume. Attaching a resume does not auto-fill (that is a separate button we never press). Date pickers need a real date: a value that is not one (for example "Immediate") becomes a question for the user, and a plain number is read as days from now. Submit is the "Submit Application" button; the form uses reCAPTCHA, and a visible challenge, a spam refusal or field errors end the run with a readable message (never retried, never solved). Ashby is switched off (not in `APPLY_BOARDS`) for now; real forms have reached `submitted`. Its most common failure is the spam refusal, which is reCAPTCHA scoring the automated browser and is handed back to the user, never worked around.

All adapters share `adapters/common.ts`: `assertJobOpen` turns a missing form on a closed posting into "This job is no longer open" (job feeds keep listing taken-down jobs), and `toDatePickerText` parses dates. Check: `scripts/adapters-test.ts` (offline) and `scripts/ats-smoke.ts` (live dry run).

Lever (`adapters/lever.ts`): form URL is the posting's `/apply` page. Fields are found by name (`name`, `email`, `phone`, `org`, `location`, `urls[...]`, `cards[...]`), and the adapter gives the mapper a `hintKey` for the fixed ones. `uploadFirst: true`: Lever reads the resume on upload and pre-fills fields ("Analyzing resume..." then "Success!"), so the runner uploads, waits for that, then fills so our values win. Location is a type-ahead whose suggestion is clicked (an optional location with no match is skipped; a required one asks the user for another search word). The optional demographic survey is left blank. Submit is `#hcaptchaSubmitBtn`; every Lever form has hCaptcha, and a visible challenge ends the run with "submit it yourself" (never solved or bypassed). Lever is switched off (not in `APPLY_BOARDS`); no real Lever form has reached `submitted` yet (TASKS T18). Check: `scripts/ats-smoke.ts --user <id suffix> <jobId>` (dry run for any adapter; `--user` is required so it never runs as the wrong profile).

Greenhouse (`adapters/greenhouse.ts`): always opens the hosted form `https://job-boards[.eu].greenhouse.io/embed/job_app?for={slug}&token={externalId}`, which works for boards.greenhouse.io, job-boards.greenhouse.io and company careers sites alike. Inspects text/tel/number/textarea/select/checkbox/radio/file inputs and react-select comboboxes. Checkboxes and radios are read per `name`: a fieldset with several boxes is one `checkbox-group` question (legend = question, box labels = options), a one-box fieldset (an "Acknowledge" consent) is one `checkbox` named by its legend and is always asked, never ticked for the candidate; groups are filled by ticking the box whose label fits the answer. A `number` input takes only a number (`valueResolver`: "30 days" → 30; "Immediate" → asked if required, skipped if not). Before Submit, `missingRequired` lists required questions still empty (text, select, react-select still on its placeholder, groups with nothing ticked; hidden ones ignored) and stops the run with their names, so nothing is sent with holes. Check: `scripts/greenhouse-form-test.ts`. Combobox options are read from the input's own `aria-controls` listbox (the phone widget keeps a second country listbox). Comboboxes with no options or more than 50 (location, school) are search fields: the answer is typed and matched against live results. Waits for `networkidle` before uploading (the uploader script loads late), attaches the resume through the "Attach" file chooser and waits for the file-name chip. Confirmation: `/confirmation` URL or "thank you for applying" text. A visible reCAPTCHA challenge fails the run with "open the form and submit it yourself" — never solved or bypassed.

### 6.7 Concurrency

`worker/index.ts` registers `apply` with pg-boss `localConcurrency = APPLY_CONCURRENCY` (default 3, clamped 1–8). Each run owns one Chromium, so the limit is RAM (~0.5 GB per run) and how many simultaneous submissions one IP tolerates. `browser.ts` launches a persistent profile per run: `./.browser-profiles/<userId>/slot-N`, so cookies and storage are never shared between users; runs of one user take separate slots (Chromium allows one process per profile folder; the root can be moved with `BROWSER_PROFILE_ROOT`). A locked slot is skipped and the pool sweeps again after a pause. A run waiting for a security code holds its slot (and profile) for up to 10 minutes. Profile folders are local cookies/cache, not application data; they are git-ignored and are lost when a container restarts.

### 6.8 Cancel and one submit at a time

`Application.status = cancelled` stops a run: every runner status write goes through `setApp`, which refuses to overwrite `cancelled` and throws `CancelledError`; the code-wait loop checks it every 2 s, and a cancelled application that reaches the worker again returns at once. `npx tsx scripts/clear-queue.ts` cancels every in-flight application and every `created/retry/active` apply job (history is kept). Submit and code entry run one application per user at a time (`withSubmitLock` in `modules/apply/submitLock.ts`: one `SubmitLock` row per user, taken with one atomic upsert, a 2-minute lease renewed every 20 s while the holder works, so it holds across several worker processes and a dead holder is taken over when its lease runs out; waiters poll every 2 s, so it is mutual exclusion, not first-come-first-served): two forms waiting on codes at once put two emails in one inbox with no way to tell which is which. Filling and uploading stay parallel. Apply jobs are sent with `expireInSeconds: 3600` and `retryLimit: 0`: a form can legitimately wait behind another application's code, and a blind pg-boss re-run of a form that may already have been submitted could apply twice. The runner refreshes `Application.heartbeatAt` every 30 s while it works. Every worker runs `reapStaleRuns` (`src/worker/reaper.ts`) each minute: an application whose apply job is still `active` in pg-boss but whose heartbeat is older than 3 minutes belongs to a dead worker, so it is marked `failed` ("The worker stopped while running this application. Retry it."), its queue job is cancelled and its submit lock freed. Applications waiting for answers have no active job and are never reaped. Check: `scripts/queue-smoke.ts` (includes a second real process).

### 6.9 Duplicate and company guards

`modules/governance/history.ts` holds the swipe-time history: a role is `roleKey(companyId, normalised title)`, so the same role listed under two ids is one role. Rules in `config/rules.json`: `no_duplicate_role` (an application that was submitted or is in flight blocks a second one; failed, blocked and cancelled ones do not count) and `max_per_company_per_week` (default 3, counted over 7 days). Both run in the `swipe_right` check before the score and daily-cap rules, so a blocked swipe ends `blocked` with the rule name. The feed hides roles already applied to, and the feed and applications pages show today's count against `max_applications_per_day`. Check: `scripts/guards-test.ts`.

### 6.10 Cancel and retry from the UI

`POST /api/applications/:id/cancel` (owner only; allowed while queued, inspecting, filling or needs_input) marks the application cancelled, cancels its queue job, frees its submit lock and writes a `cancel` event. `POST /api/applications/:id/retry` (owner only; allowed from failed or cancelled) re-runs the same swipe-time rules as a new swipe (`no_duplicate_role`, `max_per_company_per_week`, `min_match_score`, daily cap, supported board), then resets the attempt count and queues it again; a blocked retry returns 403 with the rule name and leaves the application unchanged. Both live in `modules/apply/lifecycle.ts`, which web routes import directly (importing the `apply` index would pull Playwright into the web bundle). The buttons are `components/application-actions.tsx`, on the list rows and the detail page; cancelling an application that has a browser open asks first. The live status endpoints are `no-store` and clients fetch with `cache: "no-store"`. Check: `scripts/lifecycle-smoke.ts` (works with or without a worker running).

### 6.11 Notifying the user

The shell has ONE poller, `components/applications-summary.tsx` (a provider in `(app)/layout.tsx`): every 5 s, and never while the tab is hidden (it polls at once when the tab comes back), it reads `GET /api/applications/summary`, which returns only the applications waiting for the user with `waitingFor` (`answers` or `code`) and `promptId` (the id of the latest `ask_user` event, so a new prompt such as a rejected security code is a new prompt). The nav badge, `components/needs-input-notifier.tsx` and the input popup all read it; the popup loads an application's questions only when the first waiting application or its prompt changes. The tab title always shows `(N) SwipeApply` while N applications wait. After the user turns the bell on (and the browser grants permission), one Notification per prompt names the company; seen prompts are remembered in localStorage so polling and reloads never repeat it, and clicking one opens the application. Optional email: `lib/notify.ts` POSTs `{to, subject, text}` to `NOTIFY_WEBHOOK_URL` (bearer `NOTIFY_WEBHOOK_SECRET`) from the runner at each of its three pause points; unset means off, and a failing webhook never affects the run. The text carries company, role and what is needed, never answers or codes. Check: `scripts/notify-smoke.ts`.

### 6.12 Multi-user safety

Every API route resolves the signed-in user and scopes its queries by `userId`; another user's application, file or answer is answered with 404, and signed-out calls get 401. Limits: free-text inputs are length-bounded (answers 2000; question text up to 5000, stored shortened to 1000 because real form labels can run past 700 characters; profile fields per `profileSchema`; resume text is cut, not rejected); batches are capped; `/api/jobs/ingest` is operator-only (`ADMIN_EMAILS`, 1 to 60 days, 3 per hour); resume uploads are 10 per user per hour (`lib/rate-limit.ts`, a counted-rows limiter in Postgres, atomic and shared by every web instance, pruned by the worker). The mock form and its endpoint return 404 in production unless `ENABLE_MOCK_FORM=1`. The worker opens only allow-listed hosts for the job's ATS (`modules/apply/urls.ts`, https only, no userinfo or odd ports; the mock form only on this app's own host), otherwise the application is blocked with `unsafe_form_url`. Fairness: `max_in_flight_per_user` (default 25) caps one user's queued and running applications so they cannot fill the shared worker. All responses carry nosniff, frame-deny, referrer and permissions headers; `/api/files` responses are private, no-store and sandboxed. A user can download their data (`GET /api/account/export`) and erase everything (`POST /api/account/delete`, exact phrase required): the user row cascades profile, answers, swipes, applications and events, and `modules/account` also removes stored files, locks, rate counters and queue jobs and stops anything running; the worker deletes the browser-profile folders of users that no longer exist. Not yet: a strict Content-Security-Policy. Check: `scripts/security-test.ts`.

### 6.13 Saved answers

`/answers` lists every saved answer grouped like the application detail (Contact, Experience, Your answers, Equal opportunity), with plain names for canonical keys, the question text for per-question answers, a source badge, and a note on sensitive ones. Edit saves through `PUT /api/answers` (and makes the answer the user's own); Delete (with a confirmation step) calls `DELETE /api/answers?key=`, after which the next form that needs it asks again; "Add an answer" offers only keys that are not identity details or the resume. Check: `scripts/answers-smoke.ts`.

### 6.14 Governance page

`/governance` (a tab) is the user's window on the rules. `governanceOverview(userId)` (`modules/governance/overview.ts`) returns today's counters in UTC (applications started against the daily cap, submitted, blocked, times it asked, rule checks run, where a block counts as a check), the last 10 blocks with their rule, and the last 20 events (filled-field events left out). Everything is scoped to the signed-in user. `lib/rule-text.ts` turns `config/rules.json` into plain sentences with the live values, so changing a rule changes the page. Check: `scripts/governance-smoke.ts`.

### 6.15 Learning from results

`modules/jobs/results.ts` counts, per company and board and across every user, how applications ended (submitted, failed) and how many asked for an emailed security code (from the `ask_user` events); cancelled runs and the mock form are ignored, and only counts leave the module. After 3 finished runs `judge` gives a hint and a ranking nudge: failing 60% or more is "Often fails to submit" (-4); asking for a code half the time or more is "Usually needs an emailed code" (-2); 2 or more clean submits with low failure and code rates is +3. The nudge only reorders the feed; the match score the user sees is unchanged, and the hint appears as a tag on the card. Numbers are cached for a minute. Check: `scripts/results-test.ts`.

### 6.16 Closed jobs, browser slots and one worker per machine

- A run that ends "no longer open" is checked against the company's own public board (`modules/jobs/listing.ts listingState`). Listed means the page failed to load, so it is retried and worded "The form did not load". Gone sets `Job.closedAt`. Unknown (board unreachable) keeps the old behaviour. Page text alone never closes a job.
- A browser profile that dies while opening ("has been closed", Singleton lock) moves on to the next slot instead of failing the run.
- A second worker on the same machine refuses to start (`worker/single.ts`, pid file in `BROWSER_PROFILE_ROOT`): two workers share profile folders and knock each other's browsers over.

### 6.17 Adapter hardening and many swipes at once

- **One swipe path.** `lifecycle.swipeRight` is the only place a right swipe is handled (the API route and the tests call it). Inside one transaction it takes a per-user advisory lock, recounts running and queued applications, and records the swipe and application, so a burst of swipes cannot overshoot `max_in_flight_per_user` (25). A swipe refused for a full queue is not recorded at all (HTTP 429, the deck puts the card back); it is not a refusal of the job.
- **Place in line.** `/api/applications` returns `ahead` for queued applications (queued applications created earlier, over all users) and the list shows it.
- **Adapters share `adapters/common.ts`.** `dismissOverlays` declines cookie banners before filling and before Submit; `inField` names the field in any fill error; `friendlyError` turns Playwright timeouts into sentences; `firstVisible` finds the Submit button under any of its names. Greenhouse, Lever and Ashby all use them.
- **Before Submit.** Lever reads the browser's own `:invalid` fields; Ashby reads required questions that are still empty. Either stops the run with the question names, so a half-empty form is never sent.
- **Unsupported questions.** A required Ashby question of a kind the agent cannot answer stops the run before anything is filled, naming the question; an optional one is skipped.
- **Failures leave evidence.** A failed run saves a full-page screenshot and the site's own error lines (`screenshots/<id>/fail-<n>.png`, event `diagnostic`).
- **Retries wait.** A retry starts 20 seconds times the attempt number after the failure.
- `rateLimit` takes a per-key advisory lock, so parallel calls cannot slip past the limit.

### 6.18 Acknowledgements (privacy, truthfulness, arbitration)

Most forms require a box such as "I have read the privacy notice", "my answers are true and complete" or "I acknowledge the arbitration agreement" and reject the application without it. `modules/apply/acknowledgement.ts` `acknowledgementValue(field)` recognises a **required** field as one (a single checkbox, a group with exactly one box, or a choice with exactly one affirmative option) by its wording, and never counts marketing opt-ins or certifications of facts (work authorization, sponsorship, age, record, past employment). These are a legal choice, not a fact, so the agent does not decide alone: the resolver asks once for the standing permission `accept_acknowledgements` (one question per run, however many boxes). With Yes, every adapter ticks them from then on, recorded as the user's answer under that key; with No, each acknowledgement is asked on its own; an earlier answer to the exact question always wins. The user can change it on `/answers`. Check: `scripts/acknowledgement-test.ts`.

### 6.19 Answer memory (retrieve, then verify)

Every saved answer's question is embedded so a new wording can find the user's past questions that mean the same (Phase F, T49-T57). Built so far (T51): pgvector in the same Neon database (`CREATE EXTENSION vector`, migration `answer_memory`); `Answer.embedding vector(1536)` plus `Answer.embeddedHash` (md5 of the wording it was computed for) and `Answer.context` (the job an answer was given for: company, title, location, country; set by `POST /api/applications/:id/answers`, null for onboarding and the answers page); `LabelEmbedding` caches one embedding per distinct wording for all users (wordings are not personal). `modules/answers/memory.ts` (raw SQL, the vector column is invisible to Prisma): `labelVectors` (cache first, then `lib/llm.ts embed()`, `text-embedding-3-small`), `ensureEmbeddings(userId)` (re-embeds answers whose wording is new or changed, so a save stays one query), and `recall(userId, labels)` (the user's 5 closest past questions per label with cosine score >= 0.54). Recall only proposes candidates: in the T49 experiment on 197 real wordings, true paraphrases scored as low as 0.599 while look-alike traps scored as high as 0.834 ("work from our US office" vs "London office"), so no threshold is safe and a verify step decides (T52). Answers saved before T51 have no context and are never reused for company-, city- or country-specific questions. Checks: `scripts/embedding-experiment.ts`, `scripts/memory-smoke.ts`, `scripts/backfill-embeddings.ts`, and the replay scoreboard `scripts/replay-questions.ts`.

Retrieve, then verify (T52): when the resolver leaves questions pending, `modules/apply/recall.ts` `answerFromMemory` recalls candidates and makes ONE verify call per form (`callJson`; model `OPENAI_VERIFY_MODEL`, default the normal model: `gpt-4o` was measured and reused less without fewer mistakes). The model proposes; code decides: the candidate must be one it was offered; the detectors in `modules/answers/concepts.ts` (residence, work authorization, sponsorship, relocation, office attendance, worked-at, company relationship, compensation, notice period, EEO) cannot be overridden to "general" and both questions must be the same kind; these risky kinds reuse only the user's own answers; kinds with a parameter need the same country / place / company on both sides, written in the question or in the job / answer context (`grounded`); different parts of one thing never share an answer (day/month/year, start/end, degree/major, address/city/state/zip, first/last name); a yes/no answer never fills an open question and an open answer never fills a yes/no one. Accepted answers enter `resolveValues` with source `matched` and a `basis` ("your answer to …"), kept on the filled field and its fill event. In the resolver, a risky question with a parameter is never answered from a global saved answer, nor from the same wording when that wording points at the job ("this role", "our office", "the country where the job is located"): only a verified memory answer counts, otherwise it asks. Replay over 237 real questions: before, 26 % answered without asking with 7 wrong sensitive answers; now 34 % with 0. Most remaining disagreements are the user's own conflicting answers (different addresses on different forms, "enrolled" vs "not returning"), to be settled on the Answers page (T56). Checks: `scripts/recall-test.ts`, `scripts/recall-smoke.ts` (mock form end to end).

Option mapping (T53): the resolver reports answers it had but could not place on a field's options (`unfit`); the runner sends the still-pending ones to `modules/apply/optionMap.ts` `mapToOptions` (one call per form, cached) and resolves again. The model may only pick one of the options shown, or none; sensitive and EEO answers may only be re-worded, never changed ("30 days" → "1 month", "Yes, I am authorized" → "Authorized", "12 LPA" → "10-15 LPA"; "60 days" with no such option stays asked). The resolver uses a mapping only when the option is really on the form; the field keeps its source and gets the basis `your answer "…", as this form's option`. Checks: `scripts/option-map-test.ts`, `scripts/option-map-smoke.ts` (mock form end to end).

Derivation (T54): after memory, `modules/apply/derive.ts` `deriveAnswers` works out what the profile and resume prove, source `derived` with the evidence as basis: residence ("Do you reside in the US or Canada?") from the profile's country (not when the question mixes in relocation, or asks about a smaller place in the user's own country); "worked at <company>?" from the resume's employers (not for "any government entity"); "N years of experience in X?" is No when total experience is under N and Yes only when the resume's dated roles involving X add up to N (dates normalised in code; the model may only say which existing roles involve X, the arithmetic is code). It never touches pay, notice period, work authorization, sponsorship, citizenship, relocation, office or EEO questions. Citizenship ("U.S. person", green card) is its own risky kind, never matched to work authorization. Replay: 46 % answered without asking, 0 wrong sensitive answers, 0 derivations on a forbidden kind; the 12 derived answers that contradict a saved answer are listed for review (profiles in India with saved "Yes, I live in the UK / worked at Snowflake"). Checks: `scripts/derive-test.ts`.

Essay drafts (T55, product decision): `modules/apply/essay.ts`. Open questions ("why this role / why us", "best project you've built", "tell us about…") are drafted after the one-time permission `accept_ai_essays` (asked once for all essays), from the resume and the job only; a draft that names an organisation, school or product absent from both is dropped and the question asked. "Best project" is drafted once and saved as `essay_best_project` (`ai_draft`, editable on the Answers page) and reused; "why this company" is drafted per application and only an answer given for the same company is ever reused (never the global free-text answer). At most `max_ai_drafts_per_application` (3) drafts per application, now enforced; the rest are asked. Checks: `scripts/essay-test.ts`, `scripts/essay-smoke.ts` (mock end to end).

Decisions (10 Oct): conflicting saved answers are not reviewed; the newest wins (the verify step prefers the most recently saved candidate). Years-of-experience questions are always derived when the resume settles them (no switch). Essay drafts must also be numerically grounded: every number in a draft must appear in the resume or the job, otherwise the draft is dropped and the question asked.

Ask before the run (T56): `modules/apply/resolveForm.ts` is the one answering chain (exact / canonical → memory → derived → essays → option mapping), used by the live run, the check before the run and the feed pre-scan. `modules/apply/questions.ts` reads a job's questions without a browser: Greenhouse's public `…/jobs/{id}?questions=true` (labels match the hosted form; cached on `Job.questions` for a day) and a fixed list for the mock form; other boards return null. Before opening a browser the runner resolves those questions; anything genuinely missing (essays it will draft do not count) is asked at once (`ask_user` "Need N answers before opening the form"), so no form is left half-filled; once answered, the run fills straight through. Forms whose questions cannot be read ask mid-run as before. `POST /api/applications/:id/answers` also re-queues every other application of the user waiting on any of the same questions (one answer releases them all; one waiting for an emailed code is left alone). "Fill your gaps": the `prescan` queue job (`modules/apply/prescan.ts`, at most once per user per 10 minutes, started from the feed when the last scan is over 30 minutes old and after answers are saved) resolves the questions of the user's top 20 feed jobs and stores `FeedScan` (jobs answerable in full) and `FeedGap` (each missing fact and how many jobs it blocks). Questions about the job's country are grouped by country under one plain wording ("Are you legally authorized to work in the United States?") and saved with that country (`FeedGap.context` → `Answer.context`), so one answer serves every job there in any wording. `/gaps` shows coverage and the gaps; `POST /api/gaps` saves an answer with the gap's context. Checks: `scripts/precheck-smoke.ts` (mock end to end), `scripts/gaps-test.ts` (real Greenhouse question lists, read only).

Visibility (T57): `components/status-badge.tsx` shows `matched` as "You · reused" and `derived` as "Worked out"; the application page shows each such field's basis ("Why: your answer to …", "Why: derived from your location: …", "Why: AI draft from your resume and the job"); `governanceOverview` counts today's fields answered from the user's data (fill events with source matched / derived / ai_draft) as "Answered from your data" next to "Questions asked". Checks: `scripts/applications-smoke.ts`, `scripts/governance-smoke.ts`.

## 7. Governance (`config/rules.json` + `modules/governance/rules.ts`)

```json
{
  "require_user_approval": true,
  "allow_submit_on_real_sites": true,
  "test_profile_mock_only": true,
  "no_fabrication": true,
  "sensitive_keys_never_ai": ["current_ctc", "expected_ctc", "salary_expectation", "notice_period", "work_authorization", "needs_sponsorship", "willing_to_relocate"],
  "eeo_default": "Decline to answer",
  "min_match_score": 40,
  "max_applications_per_day": 120,
  "max_per_company_per_week": 3,
  "max_in_flight_per_user": 25,
  "no_duplicate_role": true,
  "max_ai_drafts_per_application": 3,
  "max_attempts": 2
}
```
This is the checked-in file as it is now. The daily cap is 120 here; PRD §9 names 20 as the default for real users, so lower it before opening the app to others. `rules.check(stage, ctx)` → `{ok, rule?, message?}`; every call writes an event (`rule_check` or `block`). Governance page reads the rules and today's counters from `ApplicationEvent`.

## 8. LLM gateway (`lib/llm.ts`)

`callJson<T>(schema, system, user, {cacheKey?})`: JSON-only system prompt, strip fences, parse, Zod-validate, one retry. Calls OpenAI `POST /v1/chat/completions` with `response_format: json_object`. Cache: in-memory per process + `FieldMappingCache` for field labels. Logs tokens/latency. One model for the MVP (`gpt-4o-mini`). Switched off Anthropic because that key was never issued; `OPENAI_API_KEY` is the one in `.env`.

## 9. Storage (`lib/storage.ts`)

Interface: `put(key, bytes, contentType, userId?)`, `get(key)`, `url(key)`. MVP implementation: `FileBlob` table in Postgres. Keys: `resumes/{userId}/resume.pdf`, `screenshots/{appId}/{attempt}.png`. `url(key)` points at `GET /api/files/{key}`, which streams the bytes only to the owning user. The worker writes the resume bytes to a temp file for Playwright upload and deletes it in `finally`. Later: an `S3Storage` class with the same interface (R2/S3) selected by env; callers never change.

## 10. Mock Greenhouse form (`/mock/greenhouse`)

Same ids as Greenhouse where easy (`#first_name #last_name #email #phone #resume`), plus a custom combobox (`#how_heard`), a notice-period text (`#notice_period`), a work-authorization select (`#work_authorization`), a free-text question (`#free_text`) and an EEO section (`#gender #race #veteran_status #disability`, default "Decline to answer"). `POST /api/mock/submit` stores the payload in `MockSubmission` (resume file name only, not the bytes). `/mock/submissions` lists those payloads. `/mock` is outside the auth proxy: the worker browser has no session. Seed adds `Company {source:'mock', active:false}` so ingest skips it, plus one `Job` with `applyUrl=http://localhost:3000/mock/greenhouse`. Used by test profiles and `tests/smoke.spec.ts`.

## 11. Env

```
DATABASE_URL=postgresql://...   # Neon pooled URL (-pooler) for web
DIRECT_URL=postgresql://...     # Neon direct URL for migrations + pg-boss
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
STORAGE_DRIVER=postgres          # postgres | s3 (later)
ADMIN_EMAILS=                    # operators allowed to trigger ingest by hand (comma separated); empty means nobody
ENABLE_MOCK_FORM=                # 1 only on a staging deploy that runs the end-to-end test; the mock form is off in production otherwise
NOTIFY_WEBHOOK_URL=              # optional: email webhook for "needs you" (off when empty)
NOTIFY_WEBHOOK_SECRET=
APP_URL=http://localhost:3000    # used in links inside notification emails
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=          # optional, default text-embedding-3-small (answer memory, 6.19)
OPENAI_VERIFY_MODEL=             # optional model for the answer-memory verify step (6.19); default OPENAI_MODEL
DEMO_HEADED=1
APPLY_CONCURRENCY=3              # browsers per worker, clamped 1–8 (6.7)
BROWSER_PROFILE_ROOT=            # where per-user browser profiles live; default ./.browser-profiles (6.7)
INGEST_CRON=0 */6 * * *          # scheduled ingest, UTC (6.2)
INGEST_DAYS=7
```
`ANTHROPIC_API_KEY` is no longer read by the code (the LLM is OpenAI, §8) and can be removed from `.env`.

## 12. Deployment shape (after the hackathon)

Web → Vercel. Worker → Docker image with Chromium on Railway/Fly/a VM, scaled by replica count; pg-boss concurrency per replica = 3–5 browsers. Neon stays until size forces a move; files move to S3/R2 when the FileBlob table passes a few GB. Add SSE for live status, Sentry, and a per-ATS success-rate dashboard.
