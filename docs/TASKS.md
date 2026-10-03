# TASKS — SwipeApply

Rules:

- One task per Claude Code / Cursor session. Start with: `Read CLAUDE.md, docs/ARCHITECTURE.md, docs/TASKS.md. Do task Tn only. Run its "Done when" check, paste the output, stop.`
- Do tasks in order. T0–T7 tonight (2 Oct, ~5 h). T8–T17 on hackathon day. T18+ are stretch.
- If a task runs 2× over its time box: stop, write what blocks you in `docs/BLOCKERS.md`, move on.

Status: [ ] todo  [~] in progress  [x] done  [-] skipped

---

## Tonight (2 Oct) — infrastructure + backend, ~5 hours

### [x] T0 — Accounts + project setup (40 min, half manual)

Manual: create a Neon project (copy the pooled `-pooler` URL and the direct URL);  create a Google OAuth client (web app, redirect `http://localhost:3000/api/auth/callback/google`); get an Anthropic API key.
Do: `npx create-next-app@latest swipeapply --ts --tailwind --app --src-dir --eslint`; shadcn/ui init + button card input label select textarea dialog badge tabs progress toast; deps: `framer-motion lucide-react zod @anthropic-ai/sdk prisma @prisma/client pdf-parse playwright pg-boss next-auth@beta @auth/prisma-adapter tsx`; `npx playwright install chromium`; folders from ARCHITECTURE §3; `.env` from §11; scripts in package.json: `dev, worker (tsx watch src/worker/index.ts), ingest (tsx scripts/ingest.ts), typecheck, lint, seed`; `.gitignore .env`; git init + commit.
Done when: `npm run dev` serves a page; `npm run typecheck && npm run lint` pass.

### [x] T1 — Prisma schema on Postgres + seed (30 min)

Do: `prisma/schema.prisma` from ARCHITECTURE §4 (plus Auth.js adapter models); `lib/db.ts`; `npx prisma migrate dev --name init`; `prisma/seed.ts` reads a `COMPANIES` array (fill in T5) and upserts `Company`.
Done when: `npx prisma studio` shows all models; `npm run seed` upserts without error and re-running is idempotent.

### [x] T2 — Google auth (30 min)

Do: Auth.js v5 with Google provider + Prisma adapter; `lib/auth.ts` exports `auth()` and `getCurrentUser()`; sign-in page with a Google button; middleware: unauthenticated → `/sign-in`; authenticated without Profile → `/onboarding/resume`; else `/feed`.
Done when: Google sign-in creates a User row; refreshing keeps the session; sign-out works.

### [x] T3 — Storage + LLM gateway (30 min)

Do: `lib/storage.ts` (Postgres `FileBlob` driver, interface per ARCHITECTURE §9) + `GET /api/files/[...key]` streaming to the owner only; `lib/llm.ts` per §8.
Done when: `scripts/infra-smoke.ts` uploads a 1 KB file under `resumes/`, and `GET /api/files/resumes/...` returns it with the right content type, and `callJson` returns a Zod-validated `{city, country}` for "I live in Bengaluru"; a second call with the same cacheKey logs a cache hit.

### [x] T4 — Canonical keys + answer bank (30 min)

Do: `modules/answers/keys.ts` (every key in §5 with synonyms, type, default, policy); `answerBank.ts` (`getAll`, `get`, `upsert`); `questionKey.ts` (`matchKeyBySynonym`).
Done when: `scripts/keys-test.ts` maps: "Notice period (in days)" → notice_period; "Current CTC" → current_ctc; "LinkedIn Profile" → linkedin; "Are you legally authorized to work in the United States?" → work_authorization; "Do you now or will you in the future require sponsorship" → needs_sponsorship; "How did you hear about us?" → how_heard; "Gender" → gender. Prints PASS.

### [x] T5 — Company list (40 min, manual, do in parallel with T6)

Do: collect 25–30 companies on these boards that hire in India or remote. Slugs come from careers URLs: `boards.greenhouse.io/{slug}` or `job-boards.greenhouse.io/{slug}`, `jobs.lever.co/{slug}`, `jobs.ashbyhq.com/{slug}`. Verify each API URL (ARCHITECTURE §6.2) returns 200 with jobs. Target: 10 Greenhouse, 10 Lever, 8 Ashby. Put them in `prisma/seed.ts`; `npm run seed`.
Done when: `Company` has ≥ 25 active rows.

### [x] T6 — Queue + worker skeleton + ingest job (60 min)

Do: `lib/queue.ts` (pg-boss on `DIRECT_URL`; `enqueueApply`, `enqueueIngest`); `src/worker/index.ts` registers handlers `apply` (stub) and `ingest`; fetchers + `normalize.ts` + `tagging.ts` + `modules/jobs/ingest.ts` per §6.2; `scripts/ingest.ts --days N` enqueues and waits; `POST /api/jobs/ingest`.
Done when: with `npm run worker` running, `npm run ingest -- --days 30` logs `source | company | fetched | kept` for every company, and `Job` has ≥ 30 rows across all 3 sources with `postedAt`, `country`, `applyUrl` set.

### [x] T7 — Mock Greenhouse form (25 min)

Do: `app/mock/greenhouse/page.tsx` per §10; `api/mock/submit` stores payload (table `MockSubmission` or in `Application.fields` of a mock Job); add one `Company {source:'mock'}` + one mock `Job` with `applyUrl=http://localhost:3000/mock/greenhouse` in seed.
Done when: manual submit shows the payload on `/mock/submissions`, including the file name.

Commit: "infra + backend foundations".

---

## Hackathon day (3 Oct)

### [x] T8 — Resume upload + parse + confirm (50 min) — 10:00

Do: upload page; `POST /api/profile/resume` → storage → pdf-parse → `callJson(profileSchema)` → Profile upsert → seed Answer rows (`source=resume`); confirm page edits everything (`PUT /api/profile`, `PUT /api/answers`). Keep `src/modules/profile/sampleProfile.ts` as fallback if the LLM fails.
Done when: a real resume shows name, email, phone, city, links, years, skills, experience within 15 s; edits persist; the PDF is in `FileBlob` under `resumes/`.

### [x] T9 — 5 common questions (25 min) — 10:50

Do: questions page → answers `source=user`: current_ctc, expected_ctc, notice_period, employment_type (select), preferred_location (multi); show work_authorization + needs_sponsorship if US/Other selected; save → `/feed`.
Done when: `GET /api/answers` returns the keys; revisiting shows saved values.

### [x] T10 — Feed with filters (45 min) — 11:15

Do: `match.ts` (§6.3); `GET /api/jobs?boards&country&expMax&days` → scored, sorted, excludes swiped; feed page with filter chips + cards. UI per CLAUDE.md.
Done when: filters change the list; cards show title, company, location, "x days ago", match %, reason; swiped jobs never reappear.

### [x] T11 — Swipe (30 min) — 12:00

Do: Framer Motion card stack; right → `POST /api/swipes {direction:'right'}`; left → 'left'; toast; keyboard ← → for demo reliability.
Done when: right-swipe creates Application `queued` and a pg-boss `apply` job; left-swipe creates only a Swipe.

Lunch 12:30–13:00

### [x] T12 — Governance + apply runner + mock adapter (75 min) — 13:00

Do: `governance/rules.ts` + `audit.ts` (§7); `apply/browser.ts`; `adapter.ts`; `adapters/common.ts`; `adapters/mock.ts`; `fieldMapper.ts`; `valueResolver.ts`; `runner.ts` (§6.5); `worker/handlers/apply.ts` calls the runner; `api/applications` list + detail.
Done when: a test profile (`isTest=true`) right-swiping the mock job → worker fills every field, uploads the resume, submits, stores the screenshot in `FileBlob` under `screenshots/`, Application `submitted` with ≥ 10 events incl. `rule_check fill screenshot submit`. Same test profile on a real job → `blocked` with rule `test_profile_mock_only`.

### [x] T13 — Needs-input loop (40 min) — 14:15

Do: pending questions from `valueResolver`; runner → `needs_input`; modal on feed + application page (text / select); `POST /api/applications/:id/answers` → upsert → `enqueueApply`.
Done when: with `notice_period` deleted, the mock run pauses, the modal asks, the user answers, the run completes; a second run doesn't ask.

### [~] T14 — Greenhouse adapter, real submit (50 min) — 14:55

Do: `adapters/greenhouse.ts`: inspect inputs/selects/textareas/comboboxes/file inputs on both `boards.greenhouse.io` and `job-boards.greenhouse.io` forms; fill via common helpers; submit + `waitForConfirmation`.
Done when: with the presenter's real profile (`isTest=false`), right-swipe on a pre-tested Greenhouse job → worker fills live (headed), submits, confirmation detected, `submitted` with screenshot and the fields list with sources.
Night-before prep: pick 3 Greenhouse jobs you genuinely want, open each form by hand, note any unusual fields.

### [ ] T15 — Applications list + detail + governance page (40 min) — 15:45

Do: list with status badges (polls while running); detail: fields table (label, value, source badge), screenshot via signed URL, event timeline; governance page: rules + today's counters + last 20 events.
Done when: both pages show T12–T14 data; temporarily setting `min_match_score=95` produces a `blocked` application showing the rule name.

### [ ] T16 — Retry + failure UX (20 min) — 16:25

Do: runner retry (`max_attempts`), `failed` status with readable error, "Open form" link on failed/needs-input cards.
Done when: forcing an error (bad selector) in the mock adapter → one `retry` event, then `failed` with the message visible in the UI.

### [ ] T17 — Full run + backup video + pitch (45 min) — 16:45

Do: fresh Google account or reset user; run the full demo on the mock job and one real Greenhouse job; record screen; write `docs/PITCH.md` from PRD §11.
Done when: video saved; demo passes twice in a row without manual fixes.

---

## Stretch

### [ ] T18 — Lever adapter (40 min) — Done when: a real Lever form reaches `submitted`.

### [ ] T19 — Ashby adapter (40 min) — Done when: a real Ashby form reaches `submitted`.

### [ ] T20 — Scheduled ingest (pg-boss cron every 6 h) (15 min) — Done when: cron registered and visible in worker logs.

### [ ] T21 — LLM match reasons for top 30, cached (20 min).

### [ ] T22 — `tests/smoke.spec.ts` (30 min) — sign-in (test profile) → upload → questions → feed → right-swipe mock job → `submitted`.

### [ ] T23 — SSE for live application status instead of polling (30 min).

