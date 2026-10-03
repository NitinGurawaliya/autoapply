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
| Web | Next.js 15 (App Router), TypeScript strict | UI + API in one deployable |
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
  docs/ (PRD.md, ARCHITECTURE.md, TASKS.md, BLOCKERS.md)
  config/rules.json
  prisma/schema.prisma
  prisma/seed.ts                 # seeds Company rows (source, slug, name)
  src/
    proxy.ts                     # Next.js 16 renamed middleware to proxy. Same redirects.
    app/
      (auth)/sign-in/page.tsx
      onboarding/resume|confirm|questions/page.tsx
      feed/page.tsx
      applications/page.tsx, applications/[id]/page.tsx
      governance/page.tsx
      mock/greenhouse/page.tsx
      mock/submissions/page.tsx      # stored mock payloads, including resume file name
      api/
        auth/[...nextauth]/route.ts
        profile/resume/route.ts        # POST pdf → storage → parse → Profile
        profile/route.ts               # GET/PUT
        answers/route.ts               # GET/PUT
        jobs/route.ts                  # GET with filters
        jobs/ingest/route.ts           # POST → enqueue ingest job (dev button)
        swipes/route.ts                # POST {jobId, direction} → enqueue apply
        applications/route.ts          # GET list
        applications/[id]/route.ts     # GET detail (status, fields, events)
        applications/[id]/answers/route.ts # POST → upsert answers → re-enqueue
        mock/submit/route.ts
    worker/
      index.ts                   # pg-boss worker: handles 'apply' and 'ingest'
      handlers/apply.ts
      handlers/ingest.ts
    lib/
      db.ts        # Prisma client
      queue.ts     # pg-boss client: enqueueApply(appId), enqueueIngest(days)
      storage.ts   # put(key, bytes) / get(key) / url(key) — Postgres FileBlob now, S3 later
      llm.ts       # callJson(schema, system, user, {cacheKey})
      auth.ts      # auth() helper, getCurrentUser()
    modules/
      profile/     parseResume.ts, profileSchema.ts
      answers/     keys.ts, answerBank.ts, questionKey.ts
      jobs/        fetchers/{greenhouse,lever,ashby}.ts, normalize.ts, tagging.ts, match.ts, ingest.ts
      apply/       adapter.ts, adapters/{common,greenhouse,lever,ashby,mock}.ts,
                   fieldMapper.ts, valueResolver.ts, runner.ts, browser.ts
      governance/  rules.ts, audit.ts
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
  @@unique([source, externalId]); @@index([postedAt]); @@index([country]) }

model Swipe { id String @id @default(cuid()); userId String; jobId String; direction String
  createdAt DateTime @default(now()); user User @relation(fields:[userId], references:[id])
  @@unique([userId, jobId]) }

model Application { id String @id @default(cuid()); userId String; jobId String
  status String        // queued | inspecting | needs_input | filling | submitted | failed | blocked
  attempt Int @default(0)
  fields Json          // FilledField[] {key,label,value,source,selector}
  pendingQuestions Json // PendingQuestion[] {key,label,type,options?,required}
  screenshotKey String?; error String?; submittedAt DateTime?
  verificationCode String?   // one-time ATS email code from the user; cleared the moment the worker reads it, never logged
  createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  user User @relation(fields:[userId], references:[id]); events ApplicationEvent[]
  @@index([userId, status]) }

model ApplicationEvent { id String @id @default(cuid()); applicationId String
  type String          // rule_check | inspect | resolve | ask_user | fill | screenshot | submit | block | error | retry
  message String; rule String?; data Json?
  createdAt DateTime @default(now())
  application Application @relation(fields:[applicationId], references:[id]); @@index([applicationId]) }

model FileBlob { key String @id; bytes Bytes; contentType String; size Int; userId String?
  createdAt DateTime @default(now()); @@index([userId]) }

model FieldMappingCache { id String @id @default(cuid()); source String; labelHash String; key String
  createdAt DateTime @default(now()); @@unique([source, labelHash]) }

model MockSubmission { id String @id @default(cuid()); payload Json; createdAt DateTime @default(now()) }
```

## 5. Canonical answer keys (`modules/answers/keys.ts`)

Identity: `first_name last_name full_name email phone city country linkedin github portfolio resume`
Work: `years_experience current_title current_company employment_type start_date preferred_location`
Sensitive (never AI-drafted; answer bank or ask user): `current_ctc expected_ctc salary_expectation notice_period work_authorization needs_sponsorship willing_to_relocate`
EEO (default "Decline to answer"): `gender race ethnicity veteran_status disability pronouns`
Misc: `how_heard` (default "Job board") · `cover_letter`, `free_text` (ai_draft allowed)
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
5. Scheduled: pg-boss cron every 6 h. Manual: `POST /api/jobs/ingest` and `npm run ingest -- --days 7`.

### 6.3 Matching (`modules/jobs/match.ts`)
Feed and right-swipes are limited to `APPLY_BOARDS` (`modules/jobs/match.ts`): boards with a working apply adapter, currently `greenhouse` (plus `mock` for test profiles). Lever and Ashby jobs are still ingested but hidden until their adapters exist; a right-swipe on one returns 403 `board_not_supported`.
Deterministic 0–100: title overlap with current title/skills (40), skills overlap with description (30), experience fit (20), country/remote preference fit (10). Reason templated from the top overlaps. Feed: filters → exclude swiped → sort `score desc, postedAt desc`. Optional stretch: batched LLM reasons for the top 30, cached.

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
   # order per field: user's answer to this exact label (q_ key) → answer bank → profile → key default → ask
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

Greenhouse (`adapters/greenhouse.ts`): always opens the hosted form `https://job-boards[.eu].greenhouse.io/embed/job_app?for={slug}&token={externalId}`, which works for boards.greenhouse.io, job-boards.greenhouse.io and company careers sites alike. Inspects text/tel/textarea/select/checkbox/file inputs and react-select comboboxes; combobox options are read from the input's own `aria-controls` listbox (the phone widget keeps a second country listbox). Comboboxes with no options or more than 50 (location, school) are search fields: the answer is typed and matched against live results. Waits for `networkidle` before uploading (the uploader script loads late), attaches the resume through the "Attach" file chooser and waits for the file-name chip. Confirmation: `/confirmation` URL or "thank you for applying" text. A visible reCAPTCHA challenge fails the run with "open the form and submit it yourself" — never solved or bypassed.

## 7. Governance (`config/rules.json` + `modules/governance/rules.ts`)

```json
{
  "require_user_approval": true,
  "allow_submit_on_real_sites": true,
  "test_profile_mock_only": true,
  "no_fabrication": true,
  "sensitive_keys_never_ai": ["current_ctc","expected_ctc","salary_expectation","notice_period","work_authorization","needs_sponsorship","willing_to_relocate"],
  "eeo_default": "Decline to answer",
  "min_match_score": 40,
  "max_applications_per_day": 20,
  "max_ai_drafts_per_application": 3,
  "max_attempts": 2
}
```
`rules.check(stage, ctx)` → `{ok, rule?, message?}`; every call writes an event (`rule_check` or `block`). Governance page reads the rules and today's counters from `ApplicationEvent`.

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
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
DEMO_HEADED=1
```

## 12. Deployment shape (after the hackathon)

Web → Vercel. Worker → Docker image with Chromium on Railway/Fly/a VM, scaled by replica count; pg-boss concurrency per replica = 3–5 browsers. Neon stays until size forces a move; files move to S3/R2 when the FileBlob table passes a few GB. Add SSE for live status, Sentry, and a per-ATS success-rate dashboard.