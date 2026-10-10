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

### [x] T14 — Greenhouse adapter, real submit (50 min) — 14:55

Do: `adapters/greenhouse.ts`: inspect inputs/selects/textareas/comboboxes/file inputs on both `boards.greenhouse.io` and `job-boards.greenhouse.io` forms; fill via common helpers; submit + `waitForConfirmation`.
Done when: with the presenter's real profile (`isTest=false`), right-swipe on a pre-tested Greenhouse job → worker fills live (headed), submits, confirmation detected, `submitted` with screenshot and the fields list with sources.
Night-before prep: pick 3 Greenhouse jobs you genuinely want, open each form by hand, note any unusual fields.

### [x] T15 — Applications list + detail + governance page (40 min) — 15:45

Status: list, detail and the governance page (T42) are done.

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

### [ ] T21 — LLM match reasons for top 30, cached (20 min).

### [ ] T22 — `tests/smoke.spec.ts` (30 min) — sign-in (test profile) → upload → questions → feed → right-swipe mock job → `submitted`.

### [ ] T23 — SSE for live application status instead of polling (30 min).

---

## Next phase — polished MVP

Order matters: safety first, then friction, then coverage, then the UI pass, then shipping. One task per session. Each task ends with its check run and the output pasted, then `npm run typecheck && npm run lint`.

### Phase A — Safe for more than one user

### [x] T24 — Browser profile isolation per user (30 min)

Do: `browser.ts` must never share cookies or storage between users. Profile folders are keyed by user id (`.greenhouse-profile/<userId>/slot-N`); runs of the same user still get their own slot; a run for user B can never open user A's folder. Clean temp folders of finished test users.
Done when: `scripts/profile-isolation-smoke.ts` sets a cookie in a run for user A and shows user B's run cannot see it, and two runs of the same user still run in parallel.

### [x] T25 — Duplicate and mismatch guards (30 min)

Do: governance rules `no_duplicate_role` (same company and normalised title already submitted or in flight for this user) and `max_per_company_per_week` (config, default 3). A right-swipe that would break one is blocked with the rule name, and the feed hides jobs that are already applied to. Show today's count against the daily cap on the feed and applications pages.
Done when: swiping the same role twice, or a fourth role at one company within a week, ends `blocked` with the rule name; counters match the database.

### [x] T26 — Database-backed submit lock and stale-job reaper (40 min)

Do: replace the in-memory per-user submit lock with a database lock (a `SubmitLock` table with expiry), so it holds across several worker processes. Add a reaper in the worker: apply jobs `active` for longer than the expiry with no live worker are cancelled and their applications marked `failed` with a readable reason.
Done when: `scripts/queue-smoke.ts` passes with two worker processes running; a killed worker's active job is reaped within the expiry and shows as failed.

### [x] T44 — Multi-user safety hardening (new, from the endpoint audit)

Do: (a) ingest endpoint admin-only and size-limited; (b) mock form and its endpoint disabled in production; (c) database rate limiter, used on resume uploads; (d) length limits on every free-text input; (e) the worker opens only allow-listed ATS hosts; (f) per-user cap on in-flight applications so one user cannot fill the shared queue; (g) security headers; (h) "delete my account and data".
Done when: `scripts/security-test.ts` shows two users cannot read or change each other's data through any route, signed-out calls get 401, each limit above is enforced, and the headers are present.

### Phase B — Remove friction

### [x] T27 — Notify when the user is needed (40 min)

Do: when an application goes to `needs_input` (questions or security code), notify with a browser Notification and a tab-title badge while the app is open, plus an optional email through a configured provider (off by default). The text names the company. One notification per application per state.
Done when: forcing a `needs_input` application shows a notification and a title badge without a page refresh, and no duplicate appears on the next poll.

### [x] T28 — Cancel and retry buttons (30 min)

Do: `POST /api/applications/:id/cancel` and `POST /api/applications/:id/retry` (owner only; retry only from failed or cancelled, and it re-checks governance and duplicate rules). Buttons on the list rows and the detail page, with a confirm step for cancelling a running application.
Done when: cancelling a run waiting for a code stops it within 3 s and shows Cancelled; retrying a failed application re-queues it and it completes on the mock form.

### [x] T29 — Saved answers page (40 min)

Do: `/answers` lists every saved answer (canonical and per-question) with its question text, value and source badge; edit, delete and add; sensitive keys marked. Deleting a stale answer makes the next run ask again.
Done when: editing and deleting an answer is reflected in the next mock run (it asks again after a delete and uses the new value after an edit).

### [x] T30 — Per-company results (30 min)

Do: record per run whether a security code was asked and the final outcome; a small stats query by company and board; the feed ranks code-free, previously successful companies slightly higher and shows a "usually needs an emailed code" hint on the card.
Done when: after a few runs the stats query returns correct counts, and a company with a recorded code request shows the hint.

### Phase C — Coverage

### [~] T18 — Lever adapter (40 min) — Done when: a real Lever form reaches `submitted`. Un-hide Lever in `APPLY_BOARDS` only after this passes.

Status: adapter built and dry-run verified on 8 live Lever forms (fills every field, reads each back, resume attached, nothing submitted). Switched off on 9 Oct (`lever` removed from `APPLY_BOARDS` in `src/modules/jobs/match.ts`): 0 real submissions, 1 failure on the hCaptcha Submit button. Add it back once a real Lever form reaches `submitted`.

### [x] T19 — Ashby adapter (40 min) — Done when: a real Ashby form reaches `submitted`. Un-hide Ashby in `APPLY_BOARDS` only after this passes.

Status: adapter built and dry-run verified on 6 live Ashby forms (fills every field including Yes/No buttons, radios, checkbox groups and the date picker, reads each back, resume attached; a closed job is reported as closed). Done: real Ashby applications reached `submitted` (3 by 9 Oct). Switched off again on 9 Oct (`ashby` removed from `APPLY_BOARDS`) because most runs end in Ashby's spam refusal; improve, then add it back. Most Ashby failures are its spam refusal (reCAPTCHA scoring), handed back to the user as "submit it yourself".

### [x] T20 — Scheduled ingest (pg-boss cron every 6 h) (15 min) — Done when: the cron is registered and visible in the worker logs.

### [x] T31 — Ingest module boundary and cross-source dedupe (40 min)

Do: the ingest code in `modules/jobs` (fetchers, normalise, tagging) imports nothing from `app/` or `apply`. Write `docs/INGEST_CONTRACT.md` (Job row fields, unique key, required tags). Dedupe the same role across sources by company, title and location, keeping the direct ATS apply link.
Done when: `scripts/ingest-contract-test.ts` passes, and two sources carrying the same role give one feed card.

### [ ] T32 — More public ATS fetchers (40 min)

Do: Workable, SmartRecruiters and Recruitee fetchers behind the same interface (public APIs only), with companies added to the seed.
Done when: `npm run ingest` logs rows for each new source with valid `postedAt`, `country` and `applyUrl`.

### Phase D — UI polish

**Superseded by Phase G** (the owner's design arrived 10 Oct). T37–T39 are folded into T61–T66; T40 stays for the final accessibility pass.

Rules from CLAUDE.md stay: mobile first at 390 px, centred at 480 px on desktop, shadcn/ui, tokens in `globals.css`, one brand accent plus the fixed status colours, no gradients, no emoji. The goal is to replace the black and white look with a clear brand colour, hierarchy and depth.

### [x] T33 — Design tokens and theme (40 min)

Do: pick one brand accent and a soft neutral background; set colour, radius, shadow, spacing and type-scale tokens in `globals.css` (light and dark); replace the default black primary; document the tokens in `docs/DESIGN.md`.
Done when: screenshots of feed, applications and sign-in at 390 px show the brand accent in buttons, active chips and links, and a script confirms text contrast of at least 4.5:1.

### [x] T34 — App shell and navigation (30 min)

Do: a shared header with the logo and wordmark, a bottom tab bar on mobile (Feed and Applications now; T29 adds Answers to `TABS` in `nav-tabs.tsx`), top nav on desktop, a user menu with sign out, and a pending-count badge on Applications. Replace the per-page nav and sign-out blocks.
Done when: every signed-in page uses the shell, the active tab is highlighted, and the badge shows the number of applications needing input.

### [x] T35 — Feed card and filter redesign (60 min)

Do: a card with a company-initials avatar, role, location, "x days ago", a match ring or bar coloured by score, tags (remote, experience asked) and skill chips. Colour overlays fade in while dragging (green for apply, grey for skip). Filters move into a bottom sheet with an active-filter summary. Better empty state with next steps.
Done when: `scripts/ui-smoke.ts` still passes; screenshots at 390 px show the new card; dragging shows the overlay; filters open and apply from the sheet.

### [x] T36 — Applications list and detail polish (40 min)

Do: a summary strip (submitted, in progress, needs you, failed), richer rows with company avatars and status colours, a vertical step timeline on the detail page, a grouped field list with source badges, the screenshot in an expandable section, and a clear failure explanation with the next action.
Done when: screenshots of list and detail at 390 px are reviewed and `ui-smoke.ts` passes.

### [ ] T37 — Onboarding polish (40 min)

Do: a step indicator across upload, confirm and questions; drag-and-drop upload with parse progress; a clearer confirm form grouped by section; helpful validation messages; loading and error states on every step.
Done when: a fresh test user completes onboarding in the browser test with the step indicator updating on each page.

### [ ] T38 — Popups and live status (40 min)

Do: redesign the needs-input and security-code dialogs (company header, per-question help, a list when several applications wait, a clear "this code is for X" line), and add a live progress strip on the feed showing running applications.
Done when: with two applications waiting, the dialog lists both and answering one moves to the next; screenshots are reviewed.

### [ ] T39 — Sign-in and landing page (30 min)

Do: a short landing page (what it does, how governance protects the user, Google sign-in) in plain language, with accessible contrast.
Done when: signed-out visitors see the landing page and sign-in works.

### [ ] T40 — Accessibility, empty/loading/error states, responsive pass (40 min)

Do: a keyboard and screen-reader pass (focus rings, labels, dialog focus trap, aria on tabs and chips), skeleton loaders, error and empty states on every screen, and checks at 390 px, 768 px and desktop.
Done when: an automated axe check via Playwright reports no serious violations on the main pages, and every screen has loading, empty and error states.

### Phase E — Ship

### [ ] T41 — Deploy (60 min)

Do: follow `docs/DEPLOY.md`: add `postinstall: prisma generate`, `maxDuration` on the resume route, `Dockerfile.worker`, the ingest schedule (T20) and production env vars; deploy the web app to Vercel and the worker to a container host; point the mock job at the production URL.
Done when: on the production URL a test user completes onboarding and a mock application reaches `submitted`, and a real Greenhouse job reaches `submitted` with a recorded confirmation.

### [x] T42 — Governance page (30 min)

Do: `/governance` shows the rules, today's counters (applications, blocks, AI drafts) and the last 20 events across the user's applications.
Done when: setting `min_match_score` high produces a blocked application and the page shows the rule and the event.

### [ ] T43 — End-to-end test and CI (40 min)

Do: `tests/smoke.spec.ts` (T22): sign in as a test user, onboard, open the feed, swipe the mock job and reach `submitted`; run typecheck, lint and the backend smoke scripts in CI.
Done when: the Playwright test and the smoke scripts pass in one command locally and in CI.

### [x] T45 — Adapter hardening and many swipes at once
Shared failure handling for the Greenhouse, Lever and Ashby adapters (cookie banners, named field errors, required-field checks before Submit, unsupported-question stop, Submit button fallbacks, failure screenshots), board-confirmed "closed" detection, one-worker-per-machine lock, retry delay, and a single race-safe swipe path with a queue cap that does not lose swipes. See ARCHITECTURE.md 6.16 and 6.17.
**Done when:** `scripts/adapters-robust-test.ts`, `scripts/swipe-batch-test.ts`, `scripts/closed-test.ts` print PASS and live dry runs pass on 3 Ashby forms and 1 Lever form.

### [x] T46 — Greenhouse form gaps (from the 9 Oct failure review)
Checkbox fieldsets read as one question (no more unticking every box of a required group), one-box acknowledgements asked by their legend, radio groups, number inputs that only take a number, and a required-field check before Submit. See ARCHITECTURE.md 6.6 (Greenhouse).
**Done when:** `scripts/greenhouse-form-test.ts` prints PASS. Live check still to do: one dry run (`scripts/ats-smoke.ts`) on the Stripe, Twilio and SingleStore forms that failed before.

### [x] T47 — Acknowledgements on every adapter, and the invisible Ashby questions
Ashby checkbox groups (OpenAI's arbitration and "I certify" boxes, Snowflake's privacy notice) were never found: they lack the field-entry class the adapter searched for, so runs ended "Missing entry for required field". Fixed by finding questions by `data-field-path`; Yes/No answered "No" no longer counts as empty. Required privacy, truthfulness and arbitration acknowledgements are ticked under a one-time standing permission (`accept_acknowledgements`). See ARCHITECTURE.md 6.18.
**Done when:** `scripts/acknowledgement-test.ts` prints PASS. Live check still to do: retry the failed OpenAI and Snowflake Ashby applications.

### [x] T48 — Performance quick wins (from the 9 Oct audit)
One shared, visibility-aware poller on a small `/api/applications/summary` endpoint instead of four timers on the full list (about 7x fewer requests, none while the tab is hidden); loading and error screens on Governance and Account; `getCurrentUser` cached per request; independent queries in parallel and joins instead of two reads (`history.ts`, `/api/applications`, `listFeed`, governance overview); indexes on `Job(source, country, postedAt)` and `ApplicationEvent(applicationId, type, createdAt)`; feed header streams before the cards. Measured (dev, test account): Applications tab 20 s to 1.8 s, Governance first feedback 11 s to 1.3 s, feed header 14-27 s to about 2 s. Not done here: feed scoring and cookie sessions (decisions 1 and 5 in the performance audit doc).
**Done when:** the regression smokes pass and the timings above are re-measured. Done 9 Oct.

### [x] T70 — Feed without descriptions (audit decision 1)
Do: `Job.terms` (distinct words, kept by a trigger) and `feedRows` in `modules/jobs/match.ts`: Postgres finds which of the candidate's skills each job mentions, so `listFeed` reads small columns only; `scoreFeatures` shares the scoring with `scoreJob`; `Job.experienceMin` backfilled to `requiredYears` (`scripts/backfill-job-features.ts`).
**Done when:** `scripts/feed-sql-test.ts` PASS (same 40 cards, order, scores and reasons as the old feed for every real profile), the feed smokes pass, and the feed load is re-measured.
Done 10 Oct: `feed-sql-test` PASS for all 5 real profiles (identical cards; feed 0.9–2 s, was 8–27 s; under 0.5 MB per load, was 24 MB). `match-test`, `guards-test`, `results-test` (its test jobs now use a title no real job has), `ingest-contract-test`, `lifecycle-smoke`, `gaps-test` and `swipe-batch-test` PASS. `feed-smoke` fails at the Filters sheet, which Phase G is rebuilding (T62, uncommitted at the time); the cards themselves render. Found on the way and fixed: swipe-time counts were read before the per-user lock, so a burst passed the daily cap (24 of 20); `swipe-batch-test` now checks whichever of the queue and daily caps is lower.

### [x] T71 — One query to sign in (audit decision 5, light option)
Do: `getSessionAndUser` in `lib/auth.ts` as one SQL join returning the session, the user and whether a profile exists; the proxy and `getCurrentUser` read that instead of querying again. Database sessions kept (the owner's choice: the test scripts sign in with them).
**Done when:** sign-in costs one query per request, pages are re-measured, and `security-test`, `onboarding-smoke`, `answers-smoke`, `infra-smoke` pass.
Done 10 Oct: query log shows one session query per request (was four); `/answers` and `/account` 1.6–2.2 s → 0.8–1.1 s warm on the dev server. All four checks PASS.

### [x] T72 — Sponsorship asked once for every country abroad
Do: `modules/apply/sponsorship.ts` and the needs-sponsorship branch of `valueResolver.ts`: one standing answer (`sponsorship_outside_home`) for jobs outside the home country, asked instead of the per-country question; the pre-scan keeps it as one gap.
**Done when:** `scripts/sponsorship-test.ts` PASS and the answering chain checks still pass.
Done 10 Oct: `sponsorship-test` PASS (14 checks); `resolver-test`, `acknowledgement-test`, `keys-test`, `recall-test`, `derive-test`, `essay-test`, `gaps-test`, `precheck-smoke` PASS. `option-map-test` fails 2 live model cases ("12 LPA" → "10-15 LPA", an unlisted event → "Other"): the model now leaves them unmapped. Fixed the same day: numbers in ranges are placed by code (`numericRange` with units), and the prompt's "Other" rule is stated plainly; `option-map-test` PASS three runs in a row (14 checks).

### [x] T73 — Applications list in pages; detail page re-renders only on a change (audit decisions 3 and 4)
Do: page `GET /api/applications` (active always, finished 25 at a time, counts per status) and `applications-list.tsx` (Show more, pages kept on poll); `AutoRefresh` polls `?only=version` and refreshes only on a change, slower while waiting for the user, never while hidden.
**Done when:** `scripts/applications-pages-smoke.ts` PASS and `applications-smoke`, `security-test`, `notify-smoke`, `shell-smoke` pass.
Done 10 Oct: `applications-pages-smoke` PASS (10 checks: counts over all 51, first page 26 rows, Show more to 51, kept after a poll, Sent tab paged; detail: 2 version checks and 0 page renders while unchanged, 1 render on a change, checks stop once sent). `applications-smoke` (its All check now expects the first page), `security-test`, `notify-smoke`, `shell-smoke` PASS; typecheck and lint pass.

### [x] T74 — Pages kept between tabs; the feed kept on the server for a minute
Do: `experimental.staleTimes.dynamic = 60`; `lib/forget-pages.ts` (server function) after every save; the deck remembers jobs swiped this visit; the applications list shows its last result while it reloads; `lib/feed-cache.ts` (per-user feed, a minute, cleared by swipes, profile and resume changes, preferred locations).
**Done when:** `scripts/navigation-cache-smoke.ts` PASS on a production build and the feed, list and answer checks still pass.
Done 10 Oct: `navigation-cache-smoke` PASS against `next start` (6 checks: coming back to the feed 15 ms with no server render, a swiped card never returns, a save makes the next visit fresh); on the dev server, which never keeps pages, a return costs about 300 ms thanks to the server copy (was 1–2 s). `next build` passes. Typecheck, lint and 18 checks PASS (`lifecycle-smoke` on a rerun: its retry step races the running worker).

## Phase F — Smarter answers (ask only what we cannot know)

Plan (v2, agreed 9 Oct): retrieve, then verify. Every answered question is stored with its embedding (pgvector in the same Neon database) and the job it was answered for. For each form question: exact/canonical answer → recall the user's 5 closest past questions → one AI verify per form ("same question, same company/city/country/skill?") → hard parameter checks in code for risky questions (work authorization and sponsorship per country, worked-at per company, office per city, sensitive, EEO) → derive with evidence → essay draft (one-time permission) → fit to the form's options → ask, preferably before the run. Similarity alone never fills an answer. Reused/derived answers on by default, each with a badge and its reason. Every step re-runs the replay scoreboard (auto-answer rate up, wrong sensitive answers = 0).

### [x] T49 — Embedding experiment (decision gate)
`embed()` in `src/lib/llm.ts`; `scripts/embedding-experiment.ts` prints nearest neighbours and scores for the real users' saved questions, true paraphrases vs look-alike traps. **Done when:** a retrieval cut-off is chosen from the numbers and the traps are shown to need the verify step.
Result (9 Oct, 197 real wordings, `text-embedding-3-small`): true paraphrases score as low as 0.599 ("How did you hear about us?" ~ "How did you learn about this job?"; zip-code wordings 0.718) while traps score as high as 0.834 ("work from our US office" ~ "…London office"). No threshold separates them, so the verify step is required. Retrieval: top 5 candidates with score ≥ 0.54 go to verify.

### [x] T50 — Replay scoreboard
`scripts/replay-questions.ts`: leave-one-out replay of every saved wording; % answered without asking, % agreeing with the user (yes/no compared by meaning), wrong sensitive answers. **Done when:** the baseline prints for the real profiles.
Baseline (9 Oct, today's resolver, 3 real users): 237 questions; 62 answered without asking (26 %), of which 25 agree with what the user said (40 %); 175 still asked (74 %); **7 wrong sensitive answers**, all one global `willing_to_relocate` / `work_authorization` answer reused for a different place (Bangalore, Austin, a US-person check). That is the parameter problem T52 fixes; the target is 0.

### [x] T51 — pgvector storage and backfill
Extension, `Answer.context`, `Answer.embedding`, `LabelEmbedding` cache; `modules/answers/memory.ts` `remember` / `recall`; answer writes record the job context; `scripts/backfill-embeddings.ts`. **Done when:** recall returns the right neighbours for sample wordings and the backfill ran.
Done 10 Oct: migration `answer_memory` (pgvector on Neon), `modules/answers/memory.ts`; `memory-smoke` PASS (paraphrases recalled first, London office recalls the US-office answer at 0.834 as expected, context kept, changed wording re-embedded); backfill embedded all 343 saved answers. ARCHITECTURE 6.19.

### [x] T52 — Retrieve-then-verify in the run
`modules/answers/concepts.ts` (small risky catalog with parameters), `modules/apply/recall.ts` (async pre-pass in the runner, one batched verify per form, code-side checks) feeding `resolveValues`; source `matched`. **Done when:** replay answers the duplicate clusters, trap pairs are not reused, wrong sensitive answers = 0.
Done 10 Oct: replay 26 % → 34 % answered without asking, wrong sensitive answers 7 → 0 (risky questions with a country/company/place now need a verified answer about the same one; the old global answers caused all 7). recall-test PASS (paraphrases reused; US vs London office, UK vs US work authorization, MongoDB vs Thoughtworks, month vs year, yes/no vs open questions refused); recall-smoke PASS (mock form: notice period filled from another wording, `matched` with its basis, submitted without asking). Remaining disagreements are mostly the user's own conflicting answers, for T56.

### [x] T53 — AI option mapping
Map a value onto the form's own options when `fitOption` fails; one option or none; sensitive/EEO values never changed. **Done when:** fixture cases pass and "does not fit" prompts drop in replay.
Done 10 Oct: `option-map-test` PASS (10 cases incl. refusals: an unlisted event without "Other", "60 days" with no such option), `option-map-smoke` PASS (mock: "Yes, I am authorized to work" filled as "Authorized", submitted without asking). The replay cannot measure this step (old forms' options were not stored); the mapping is exercised end to end instead.

### [x] T54 — Derivation with evidence
Resume dates normalised and per-role skills; residence, previous employers and skill years derived with verified evidence; source `derived`. **Done when:** replay answers those questions with the right basis and zero sensitive/EEO derivations.
Done 10 Oct: replay 34 % → 46 % answered without asking; 0 wrong sensitive answers, 0 derivations on a forbidden kind; 12 derived answers contradict a saved answer and are listed for review (India-based profiles with saved "Yes, I live in the UK / worked at Snowflake"). `derive-test` PASS (18). Simplification: dates are normalised in code and role summaries are matched (model fallback picks existing roles only) instead of re-parsing every resume. Citizenship ("U.S. person") split from work authorization.

### [x] T55 — Essay drafts
One-time permission `accept_ai_essays`; `modules/apply/essay.ts` drafts from resume + job only; "best project" saved once and editable; enforce `max_ai_drafts_per_application`. **Done when:** mock run fills an essay as `ai_draft`; a 4th draft is asked; drafts name no employer or school absent from the resume.
Done 10 Oct: `essay-test` PASS (15: detection, grounding check rejects an invented school, one permission question for all essays, "why us" never reused across companies, saved best project reused, the 4th essay asked, live drafts grounded); `essay-smoke` PASS (mock: permission asked once, then "Why this role?" drafted as `ai_draft` and submitted).

Decisions (10 Oct): conflicting saved answers are not reviewed, the newest wins; years-of-experience questions are always derived; essay drafts must also be numerically grounded (done, `essay-test` PASS).

### [x] T56 — Ask before the run, fill in one go
Pre-scan Greenhouse `…/jobs/{id}?questions=true` for feed jobs (new `prescan` queue); ask never-seen facts at swipe time; "fill your gaps" screen; mid-run popup only as a de-duplicated fallback. **Done when:** a swiped Greenhouse job with a missing fact asks at swipe time and the run completes with no pause; feed coverage % shows.
Done 10 Oct: `precheck-smoke` PASS (mock: asked before opening the form, no browser; one answer released the other waiting application through the real route; the run then filled straight through; the pre-scan reported the gap, then full coverage). `gaps-test` PASS (two real US Greenhouse jobs' differently worded work-authorization questions → one gap "Are you legally authorized to work in the United States?"; answered via /api/gaps with the country; reused for a third US job, refused for a UK job). Live: the worker's pre-scan of the test account's 20 feed jobs ran end to end. Asked-at-swipe-time means seconds after the swipe, when the worker picks the job up, before any browser opens.

### [x] T57 — Badges, basis and audit
`matched` / `derived` badges with their reason on the application page; governance counts answered-from-your-data vs asked. **Done when:** extended applications and governance smokes pass.
Done 10 Oct: "You · reused" and "Worked out" badges; the application page shows "Why: …" under every reused, worked-out or drafted answer; the governance page counts "Answered from your data" today next to "Questions asked". `applications-smoke` and `governance-smoke` extended and PASS.

## Phase G — Design system rebuild (the owner's design, 10 Oct)

The owner's design lives in `design/` (five source components exported from Claude Design: `start`, `onboarding`, `feed`, `applications`, `detail`). It replaces the Phase D look and un-holds T37–T40, which are folded in below. Build in layers, each using only the one below: tokens → primitives (`components/ui`) → patterns (`components/patterns`) → screens. Screens never style from scratch; a missing look means a missing primitive or pattern. See `docs/DESIGN.md`.

### [x] T58 — Tokens, fonts and motion
Do: the design's colours, radii, shadows and type scale as tokens in `globals.css` (light and dark); Bricolage Grotesque (display) and Geist (body) through `next/font`; `lib/motion.ts` with the design's easings, durations and swipe constants; `docs/DESIGN.md` rewritten for the new system. Links stop using the accent as text colour (lime is a fill only).
Done when: `scripts/contrast-check.ts` PASS on the new tokens, typecheck and lint pass, and a 390 px screenshot shows the new background, ink, lime primary and fonts.
Done 10 Oct: `contrast-check` PASS (42 pairs; the owner chose the design exactly, so its grey on the quiet fill is held at its own 4.41:1; every design colour is a token, including the per-screen greys); `theme-smoke` PASS with screenshots (page #f6f6f7, lime #c6f432 primary, dark #0e0f11); in the browser Bricolage Grotesque loads and `type-display-*`, `type-eyebrow`, `rounded-card`, `shadow-hard` and `ease-pop` compute to the design's values. Typecheck and lint pass. The ten links that used the accent as text colour are now ink and underlined.

Owner decisions (10 Oct): tabs are Discover and Applications only (Saved answers, Fill your gaps, Governance, Account and data and Sign out live in the profile menu); the design's wording wherever it draws a screen; onboarding shows the design's 5 screens on the existing 3 URLs with the same saves; the after-swipe toast follows the real application status. Behaviour is frozen: same API calls, polling, redirects, popup triggers and dismissal. `docs/DESIGN_SPEC.md` is the behaviour checklist. Each task updates the smoke scripts it affects (class selectors become `data-*` hooks, old wording becomes the design's) and is checked against the matching design board at 390 px, light and dark.

### [x] T59 — Icons, primitives and the /dev/ui gallery
Do: `components/ui/icons.tsx` (the design's own SVG paths); primitives Button, IconButton, Chip, Field, CheckRow, OtpInput, Surface, CompanyMark, MatchBadge, Stamp, SegmentedProgress, ProgressBar, Eyebrow, SourceBadge (6 sources), StatusMark, Sheet, Skeleton, Avatar; `lib/status-meta.ts`; a `/dev/ui` gallery (404 in production); `scripts/ui-lint.ts` (no hex colours or `style={{` in `src/app`).
Done when: gallery screenshots light and dark at 390 px compared with the design boards; `ui-lint`, typecheck and lint pass.
Done 10 Oct: primitives in `components/ui` (icons, chip, field, check-row, otp-input, surface, marks, source-badge, segmented-progress, eyebrow, sheet; Button gained the design variants `primary line strong plain quiet underline` and sizes `xl lg md row text`, legacy variants kept until T69). `lib/status-meta.ts`. `/dev/ui` renders all of them in a light and a dark panel; `scripts/design-shots.ts` captures the 36 design boards and app pages (light and dark, `SHOT_STEPS=1` for full-size slices) and the gallery was compared slice by slice with the boards. `ui-lint` PASS (2 legacy files not checked yet), typecheck and lint pass. The code input takes a length: Greenhouse codes are 8 characters, letters and digits, so the code screen uses 8 boxes where the design draws 6.

### [x] T60 — Patterns
Do: TopBar, TabBar, ProfileMenu, StepHeader, PageIntro, StickyFooter, ChipGroup, SectionCard and Row, InfoNote, TrustPanel, EmptyState, JobCard, SwipeDeck, AgentToast, FilterSheet, QuestionPrompt, CodePrompt, ApplicationRow, Timeline, FieldList, ScreenshotFrame, FailureCard and the drawings, all in the gallery.
Done when: every pattern renders in the gallery with real-shaped data, light and dark.
Done 10 Oct: shared patterns in `components/patterns` (shell-context, top-bar with Feed/Title/Back bars and UsagePill, tab-bar, profile-menu, layout with Screen/StepHeader/PageIntro/ScreenBody/StickyFooter, chip-group, content with SectionCard/Row/InfoNote/Callout/TrustPanel/EmptyState, drawings, job-card, agent-toast); the notifier is split into `components/notifications.tsx` (always-mounted notifier plus the menu switch, one shared opt-in store). All render in `/dev/ui` light and dark and were compared with boards 02–12, 16–17. Patterns used by one screen only (deck gestures, needs-you prompts, application rows, timeline, field list, screenshot frame, failure card) are built in that screen's task against real data. Typecheck and lint pass.

### [x] T61 — App shell and theme
Do: the signed-in layout uses TopBar, TabBar (2 tabs) and ProfileMenu (with the notifications toggle moved in unchanged); next-themes ThemeProvider so dark mode follows the system.
Done when: `shell-smoke`, `notify-smoke` and the nav checks in `answers-smoke` and `governance-smoke` pass; screenshots light and dark.
Done 10 Oct: `(app)/layout.tsx` mounts the TabBar (Discover, Applications), the notifier and the input popup once, inside a 480 px column at every width; each page draws its own top bar (Discover bar, title bar, or back bar) with the profile menu, which holds Saved answers, Fill your gaps, Governance, Account and data, the notifications switch and Sign out. next-themes follows the phone's light or dark setting. `nav-tabs`, `user-menu`, `needs-input-notifier` and `logo` removed. `shell-smoke` PASS (rewritten for two tabs, the lime badge, the menu links and the centred desktop column), `notify-smoke` PASS (switch now in the menu), `answers-smoke` PASS, `governance-smoke` PASS (both now profile-menu pages). Dark screenshot of /applications checked.

### [x] T62 — Discover (boards 08–12)
Do: deck, card, filter sheet, empty states; usage pill; gaps line; the after-swipe toast following the real status; error toasts restyled with the same triggers.
Done when: `feed-smoke`, `ui-smoke` and `theme-smoke` pass; screenshots match the boards.
Done 10 Oct: Discover rebuilt from patterns: FeedTopBar (profile, usage pill, filters with a lime count), the job card with the tilted match badge and "Why it fits", `patterns/swipe-stage.tsx` (drag, tilt, stamps, the next card rising, buttons growing, the card thrown off screen; physics from `lib/motion.ts`), the filter sheet (same reload-on-choose chip links; Reset in the header), "You're all caught up" with today's counts and "No jobs match these filters" with one removable chip per filter. Swipe behaviour unchanged (optimistic pop, 429/403/409 handling, refill at 5, arrow keys). The after-swipe card follows the real status through `GET /api/applications/{id}` (checked with a scripted run: Waiting in line → Reading the form → Filling it in → Submitted, then hides). Error toasts keep their triggers, restyled as the design's dark card; a blocked swipe now names the reason ("Match too low") with the rule underneath. Kept beyond the design because they are features today: the gaps line under the top bar and "View job" on the card. The sheet button reads "Show jobs" (the count is not known before the feed is scored). `feed-smoke` PASS (updated for the design's wording and hooks), `ui-smoke` PASS, `theme-smoke` PASS; /feed light and dark compared with boards 08–12.

### [x] T63 — Needs-you sheet (boards 13–14)
Do: the design's sheet with the same triggers and no dismissal; code questions use the 6-box code input.
Done when: `ui-smoke` and `_t13-check` pass; screenshots match the boards.
Done 10 Oct: `needs-input-dialog.tsx` is the design's bottom sheet: lime "Needs you · 1 of N", the company tile and role, the question large, up to four options as big answer buttons (more use a native picker), text answers in the design's input box, and for `security_code` the code boxes with Paste code. Same triggers, same fetches, same POST and the same error handling; it still opens by itself and cannot be dismissed (no "Later", no "Remember", no "All sorted" step, by decision). Inputs keep `id=answer-<key>`. `ui-smoke` PASS. A scripted check with fixtures (light and dark) PASSED: cannot be dismissed by Escape or a tap outside, an empty answer is refused, a Yes/No answer and an 8-character code are sent exactly as before and the sheet closes. `_t13-check` needs the worker running and was not run. Code boxes: 8, because Greenhouse codes are 8 characters.

### [x] T64 — Applications list (board 16)
Do: filter chips with counts, grouped sections, the four row kinds, live progress, actions.
Done when: `applications-smoke`, `lifecycle-smoke`, `ui-smoke` and `theme-smoke` pass; screenshots match.
Done 10 Oct: title bar with "N sent today · N left · Your agent is working on N"; filter chips with counts (All, Needs you, In progress, Sent, Didn't go through) replace the tiles; grouped sections with the four row kinds in `patterns/application-row.tsx` (needs you: raised card with Answer or Enter code; in progress: four segments and the stage in words with "· N ahead"; sent: ink check; didn't go through: dashed with the reason and Retry or "Nothing to do"). `ApplicationActions` has an inline look (rows) and a panel look (detail), same calls, confirm and toasts. Same 3 s poll. Needs-you rows say "Their form asked something only you can answer" because the list API does not carry the question text. `applications-smoke`, `ui-smoke`, `theme-smoke` (now checks ink and dashed instead of the old colours) and `lifecycle-smoke` PASS. Compared with board 16, light and dark.

### [x] T65 — Application detail (boards 17–18)
Do: header, failure card, trust panel, story, filled values with sources and basis, screenshot frame, technical details.
Done when: `applications-smoke` and `lifecycle-smoke` pass; screenshots match.
Done 10 Oct: back bar; company tile, title, place and a status pill ("Sent today, 12:23" or the design's status word); the "What happened / What you can do" card for anything not sent, with `explainOutcome` and the existing actions; "Nothing here was made up" with a count per source; "The story" timeline (`patterns/detail.tsx`) from `buildSteps` with each step's event time and "You swiped right" first, listing only what has happened; every filled value with its source badge and "Why:" basis, AI drafts in the dashed box; the screenshot in the design's light browser frame with its time and "View full size"; "Open the original posting"; Technical details kept, collapsed. `applications-smoke` PASS (the screenshot now shows straight away as in the design, so that check changed), `lifecycle-smoke`, `ui-smoke`, `theme-smoke` PASS. Compared with boards 17 and 18.

### [x] T66 — Onboarding (boards 03–07)
Do: upload and reading, what we found, the two question screens, on the 3 existing URLs with the same saves.
Done when: a fresh test user completes onboarding in the browser and the saved answers use today's keys and values; screenshots match.
Done 10 Oct: three steps with the design's step header. `/onboarding/resume`: drop zone, file card with Replace, then the reading screen (sweeping band, five findings revealed one by one from GET /api/profile after the same POST /api/profile/resume). `/onboarding/confirm`: "Here's what we found" with the missing-phone card, pencil-edit rows, Experience, Skills, Education (now shown), saved answers; "Looks right" sends the same two PUTs and moves on. `/onboarding/questions`: two screens (CTC with ₹ and "lakh a year", notice chips saving days, 0 for Immediate; kind of job, places, the "Working abroad" card), one PUT /api/answers at the end. Kept today's options where the design differs (Part-time; India, US, Other); left out Roles and visa status (no data for them). New `scripts/onboarding-smoke.ts` PASS light and dark: the saved answers are exactly today's keys and values. Compared with boards 03–07.

### [x] T67 — Opening animation and sign-in (boards 01–02)
Done when: `/sign-in` plays the splash and signs in as before; screenshots match.
Done 10 Oct: `/sign-in` plays the opening animation (`patterns/opening.tsx`) once per browser session through a cookie the server reads, then board 02 (logo, fanned cards, "Swipe right. We'll apply.", Continue with Google through the same server action). The design's Terms and Privacy line is left out because those pages do not exist. `theme-smoke`, `shell-smoke` and `security-test` PASS; compared with boards 01–02.

### [x] T68 — Saved answers, Fill your gaps, Account and data, Governance in the design's language
Done when: `answers-smoke` and `governance-smoke` pass; screenshots light and dark.
Done 10 Oct: the four profile-menu pages rebuilt from the same parts (title bar, section labels, hairline cards with rows, source badges, a lock on sensitive answers, raised cards for adding and deleting, display-number stats on governance). Every behaviour and `data-*` hook kept; shared loading and error states. `answers-smoke` and `governance-smoke` PASS; light and dark screenshots checked.

### [x] T69 — Final pass
Do: delete legacy status tokens and dead components; loading, empty and error states everywhere; keyboard and screen-reader pass; desktop centring.
Done when: every smoke and `contrast-check` pass and a screenshot set covers all 36 boards.
Done 10 Oct: removed the old status badge, company avatar, logo, nav tabs, user menu, bell, and the unused dialog, card, tabs, progress, select and badge primitives; the old coloured status tokens; the legacy button variants (only `default` stays, for the mock ATS form); the starter home page is now a redirect. Every screen has loading, empty and error states (`patterns/states.tsx`); one 480 px column centred at every width. DESIGN.md and ARCHITECTURE.md describe the new build. Typecheck, lint, `ui-lint` (no legacy files left) and `contrast-check` PASS. After clearing fixtures left by an interrupted run, `shell`, `feed`, `ui`, `applications`, `lifecycle`, `answers`, `governance`, `notify`, `theme`, `onboarding` smokes and `security-test` all PASS. Screenshots were compared with all 36 boards screen by screen in T59–T68. Not done: an automated axe accessibility audit (no axe in the stack); keyboard use is covered by the smokes (arrow keys, Escape, focus rings on every control).
