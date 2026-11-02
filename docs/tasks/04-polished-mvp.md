# Next phase — polished MVP

Full entries of this phase. The index is [docs/TASKS.md](../TASKS.md). Status is marked here first, then on the index line.


Order matters: safety first, then friction, then coverage, then the UI pass, then shipping. One task per session. Each task ends with its check run and the output pasted, then `npm run typecheck && npm run lint`.

### Phase A — Safe for more than one user

<a id="t24"></a>
### [x] T24 — Browser profile isolation per user (30 min)

Do: `browser.ts` must never share cookies or storage between users. Profile folders are keyed by user id (`.greenhouse-profile/<userId>/slot-N`); runs of the same user still get their own slot; a run for user B can never open user A's folder. Clean temp folders of finished test users.
Done when: `scripts/profile-isolation-smoke.ts` sets a cookie in a run for user A and shows user B's run cannot see it, and two runs of the same user still run in parallel.

<a id="t25"></a>
### [x] T25 — Duplicate and mismatch guards (30 min)

Do: governance rules `no_duplicate_role` (same company and normalised title already submitted or in flight for this user) and `max_per_company_per_week` (config, default 3). A right-swipe that would break one is blocked with the rule name, and the feed hides jobs that are already applied to. Show today's count against the daily cap on the feed and applications pages.
Done when: swiping the same role twice, or a fourth role at one company within a week, ends `blocked` with the rule name; counters match the database.

<a id="t26"></a>
### [x] T26 — Database-backed submit lock and stale-job reaper (40 min)

Do: replace the in-memory per-user submit lock with a database lock (a `SubmitLock` table with expiry), so it holds across several worker processes. Add a reaper in the worker: apply jobs `active` for longer than the expiry with no live worker are cancelled and their applications marked `failed` with a readable reason.
Done when: `scripts/queue-smoke.ts` passes with two worker processes running; a killed worker's active job is reaped within the expiry and shows as failed.

<a id="t44"></a>
### [x] T44 — Multi-user safety hardening (new, from the endpoint audit)

Do: (a) ingest endpoint admin-only and size-limited; (b) mock form and its endpoint disabled in production; (c) database rate limiter, used on resume uploads; (d) length limits on every free-text input; (e) the worker opens only allow-listed ATS hosts; (f) per-user cap on in-flight applications so one user cannot fill the shared queue; (g) security headers; (h) "delete my account and data".
Done when: `scripts/security-test.ts` shows two users cannot read or change each other's data through any route, signed-out calls get 401, each limit above is enforced, and the headers are present.

### Phase B — Remove friction

<a id="t27"></a>
### [x] T27 — Notify when the user is needed (40 min)

Do: when an application goes to `needs_input` (questions or security code), notify with a browser Notification and a tab-title badge while the app is open, plus an optional email through a configured provider (off by default). The text names the company. One notification per application per state.
Done when: forcing a `needs_input` application shows a notification and a title badge without a page refresh, and no duplicate appears on the next poll.

<a id="t28"></a>
### [x] T28 — Cancel and retry buttons (30 min)

Do: `POST /api/applications/:id/cancel` and `POST /api/applications/:id/retry` (owner only; retry only from failed or cancelled, and it re-checks governance and duplicate rules). Buttons on the list rows and the detail page, with a confirm step for cancelling a running application.
Done when: cancelling a run waiting for a code stops it within 3 s and shows Cancelled; retrying a failed application re-queues it and it completes on the mock form.

<a id="t29"></a>
### [x] T29 — Saved answers page (40 min)

Do: `/answers` lists every saved answer (canonical and per-question) with its question text, value and source badge; edit, delete and add; sensitive keys marked. Deleting a stale answer makes the next run ask again.
Done when: editing and deleting an answer is reflected in the next mock run (it asks again after a delete and uses the new value after an edit).

<a id="t30"></a>
### [x] T30 — Per-company results (30 min)

Do: record per run whether a security code was asked and the final outcome; a small stats query by company and board; the feed ranks code-free, previously successful companies slightly higher and shows a "usually needs an emailed code" hint on the card.
Done when: after a few runs the stats query returns correct counts, and a company with a recorded code request shows the hint.

### Phase C — Coverage

<a id="t18"></a>
### [~] T18 — Lever adapter (40 min) — Done when: a real Lever form reaches `submitted`. Un-hide Lever in `APPLY_BOARDS` only after this passes.

Status: adapter built and dry-run verified on 8 live Lever forms (fills every field, reads each back, resume attached, nothing submitted). Switched off on 9 Oct (`lever` removed from `APPLY_BOARDS` in `src/modules/jobs/match.ts`): 0 real submissions, 1 failure on the hCaptcha Submit button. Add it back once a real Lever form reaches `submitted`.

<a id="t19"></a>
### [x] T19 — Ashby adapter (40 min) — Done when: a real Ashby form reaches `submitted`. Un-hide Ashby in `APPLY_BOARDS` only after this passes.

Status: adapter built and dry-run verified on 6 live Ashby forms (fills every field including Yes/No buttons, radios, checkbox groups and the date picker, reads each back, resume attached; a closed job is reported as closed). Done: real Ashby applications reached `submitted` (3 by 9 Oct). Switched off again on 9 Oct (`ashby` removed from `APPLY_BOARDS`) because most runs end in Ashby's spam refusal; improve, then add it back. Most Ashby failures are its spam refusal (reCAPTCHA scoring), handed back to the user as "submit it yourself".

<a id="t20"></a>
### [x] T20 — Scheduled ingest (pg-boss cron every 6 h) (15 min) — Done when: the cron is registered and visible in the worker logs.

<a id="t31"></a>
### [x] T31 — Ingest module boundary and cross-source dedupe (40 min)

Do: the ingest code in `modules/jobs` (fetchers, normalise, tagging) imports nothing from `app/` or `apply`. Write `docs/INGEST_CONTRACT.md` (Job row fields, unique key, required tags). Dedupe the same role across sources by company, title and location, keeping the direct ATS apply link.
Done when: `scripts/ingest-contract-test.ts` passes, and two sources carrying the same role give one feed card.

<a id="t32"></a>
### [-] T32 — More public ATS fetchers (40 min) — replaced by T95 (SmartRecruiters) and T96 (Keka), 18 Oct: Workable and Recruitee had no Indian employers in the probe

Do: Workable, SmartRecruiters and Recruitee fetchers behind the same interface (public APIs only), with companies added to the seed.
Done when: `npm run ingest` logs rows for each new source with valid `postedAt`, `country` and `applyUrl`.

### Phase D — UI polish

**Superseded by Phase G** (the owner's design arrived 10 Oct). T37–T39 are folded into T61–T66; T40 stays for the final accessibility pass.

Rules from CLAUDE.md stay: mobile first at 390 px, centred at 480 px on desktop, shadcn/ui, tokens in `globals.css`, one brand accent plus the fixed status colours, no gradients, no emoji. The goal is to replace the black and white look with a clear brand colour, hierarchy and depth.

<a id="t33"></a>
### [x] T33 — Design tokens and theme (40 min)

Do: pick one brand accent and a soft neutral background; set colour, radius, shadow, spacing and type-scale tokens in `globals.css` (light and dark); replace the default black primary; document the tokens in `docs/DESIGN.md`.
Done when: screenshots of feed, applications and sign-in at 390 px show the brand accent in buttons, active chips and links, and a script confirms text contrast of at least 4.5:1.

<a id="t34"></a>
### [x] T34 — App shell and navigation (30 min)

Do: a shared header with the logo and wordmark, a bottom tab bar on mobile (Feed and Applications now; T29 adds Answers to `TABS` in `nav-tabs.tsx`), top nav on desktop, a user menu with sign out, and a pending-count badge on Applications. Replace the per-page nav and sign-out blocks.
Done when: every signed-in page uses the shell, the active tab is highlighted, and the badge shows the number of applications needing input.

<a id="t35"></a>
### [x] T35 — Feed card and filter redesign (60 min)

Do: a card with a company-initials avatar, role, location, "x days ago", a match ring or bar coloured by score, tags (remote, experience asked) and skill chips. Colour overlays fade in while dragging (green for apply, grey for skip). Filters move into a bottom sheet with an active-filter summary. Better empty state with next steps.
Done when: `scripts/ui-smoke.ts` still passes; screenshots at 390 px show the new card; dragging shows the overlay; filters open and apply from the sheet.

<a id="t36"></a>
### [x] T36 — Applications list and detail polish (40 min)

Do: a summary strip (submitted, in progress, needs you, failed), richer rows with company avatars and status colours, a vertical step timeline on the detail page, a grouped field list with source badges, the screenshot in an expandable section, and a clear failure explanation with the next action.
Done when: screenshots of list and detail at 390 px are reviewed and `ui-smoke.ts` passes.

<a id="t37"></a>
### [ ] T37 — Onboarding polish (40 min)

Do: a step indicator across upload, confirm and questions; drag-and-drop upload with parse progress; a clearer confirm form grouped by section; helpful validation messages; loading and error states on every step.
Done when: a fresh test user completes onboarding in the browser test with the step indicator updating on each page.

<a id="t38"></a>
### [ ] T38 — Popups and live status (40 min)

Do: redesign the needs-input and security-code dialogs (company header, per-question help, a list when several applications wait, a clear "this code is for X" line), and add a live progress strip on the feed showing running applications.
Done when: with two applications waiting, the dialog lists both and answering one moves to the next; screenshots are reviewed.

<a id="t39"></a>
### [ ] T39 — Sign-in and landing page (30 min)

Do: a short landing page (what it does, how governance protects the user, Google sign-in) in plain language, with accessible contrast.
Done when: signed-out visitors see the landing page and sign-in works.

<a id="t40"></a>
### [ ] T40 — Accessibility, empty/loading/error states, responsive pass (40 min)

Do: a keyboard and screen-reader pass (focus rings, labels, dialog focus trap, aria on tabs and chips), skeleton loaders, error and empty states on every screen, and checks at 390 px, 768 px and desktop.
Done when: an automated axe check via Playwright reports no serious violations on the main pages, and every screen has loading, empty and error states.

### Phase E — Ship

<a id="t41"></a>
### [ ] T41 — Deploy (60 min)

Do: follow `docs/DEPLOY.md`: add `postinstall: prisma generate`, `maxDuration` on the resume route, `Dockerfile.worker`, the ingest schedule (T20) and production env vars; deploy the web app to Vercel and the worker to a container host; point the mock job at the production URL.
Done when: on the production URL a test user completes onboarding and a mock application reaches `submitted`, and a real Greenhouse job reaches `submitted` with a recorded confirmation.

<a id="t42"></a>
### [x] T42 — Governance page (30 min)

Do: `/governance` shows the rules, today's counters (applications, blocks, AI drafts) and the last 20 events across the user's applications.
Done when: setting `min_match_score` high produces a blocked application and the page shows the rule and the event.

<a id="t43"></a>
### [ ] T43 — End-to-end test and CI (40 min)

Do: `tests/smoke.spec.ts` (T22): sign in as a test user, onboard, open the feed, swipe the mock job and reach `submitted`; run typecheck, lint and the backend smoke scripts in CI.
Done when: the Playwright test and the smoke scripts pass in one command locally and in CI.

<a id="t45"></a>
### [x] T45 — Adapter hardening and many swipes at once
Shared failure handling for the Greenhouse, Lever and Ashby adapters (cookie banners, named field errors, required-field checks before Submit, unsupported-question stop, Submit button fallbacks, failure screenshots), board-confirmed "closed" detection, one-worker-per-machine lock, retry delay, and a single race-safe swipe path with a queue cap that does not lose swipes. See ARCHITECTURE.md 6.16 and 6.17.
**Done when:** `scripts/adapters-robust-test.ts`, `scripts/swipe-batch-test.ts`, `scripts/closed-test.ts` print PASS and live dry runs pass on 3 Ashby forms and 1 Lever form.

<a id="t46"></a>
### [x] T46 — Greenhouse form gaps (from the 9 Oct failure review)
Checkbox fieldsets read as one question (no more unticking every box of a required group), one-box acknowledgements asked by their legend, radio groups, number inputs that only take a number, and a required-field check before Submit. See ARCHITECTURE.md 6.6 (Greenhouse).
**Done when:** `scripts/greenhouse-form-test.ts` prints PASS. Live check still to do: one dry run (`scripts/ats-smoke.ts`) on the Stripe, Twilio and SingleStore forms that failed before.

<a id="t47"></a>
### [x] T47 — Acknowledgements on every adapter, and the invisible Ashby questions
Ashby checkbox groups (OpenAI's arbitration and "I certify" boxes, Snowflake's privacy notice) were never found: they lack the field-entry class the adapter searched for, so runs ended "Missing entry for required field". Fixed by finding questions by `data-field-path`; Yes/No answered "No" no longer counts as empty. Required privacy, truthfulness and arbitration acknowledgements are ticked under a one-time standing permission (`accept_acknowledgements`). See ARCHITECTURE.md 6.18.
**Done when:** `scripts/acknowledgement-test.ts` prints PASS. Live check still to do: retry the failed OpenAI and Snowflake Ashby applications.

<a id="t48"></a>
### [x] T48 — Performance quick wins (from the 9 Oct audit)
One shared, visibility-aware poller on a small `/api/applications/summary` endpoint instead of four timers on the full list (about 7x fewer requests, none while the tab is hidden); loading and error screens on Governance and Account; `getCurrentUser` cached per request; independent queries in parallel and joins instead of two reads (`history.ts`, `/api/applications`, `listFeed`, governance overview); indexes on `Job(source, country, postedAt)` and `ApplicationEvent(applicationId, type, createdAt)`; feed header streams before the cards. Measured (dev, test account): Applications tab 20 s to 1.8 s, Governance first feedback 11 s to 1.3 s, feed header 14-27 s to about 2 s. Not done here: feed scoring and cookie sessions (decisions 1 and 5 in the performance audit doc).
**Done when:** the regression smokes pass and the timings above are re-measured. Done 9 Oct.

<a id="t70"></a>
### [x] T70 — Feed without descriptions (audit decision 1)
Do: `Job.terms` (distinct words, kept by a trigger) and `feedRows` in `modules/jobs/match.ts`: Postgres finds which of the candidate's skills each job mentions, so `listFeed` reads small columns only; `scoreFeatures` shares the scoring with `scoreJob`; `Job.experienceMin` backfilled to `requiredYears` (`scripts/backfill-job-features.ts`).
**Done when:** `scripts/feed-sql-test.ts` PASS (same 40 cards, order, scores and reasons as the old feed for every real profile), the feed smokes pass, and the feed load is re-measured.
Done 10 Oct: `feed-sql-test` PASS for all 5 real profiles (identical cards; feed 0.9–2 s, was 8–27 s; under 0.5 MB per load, was 24 MB). `match-test`, `guards-test`, `results-test` (its test jobs now use a title no real job has), `ingest-contract-test`, `lifecycle-smoke`, `gaps-test` and `swipe-batch-test` PASS. `feed-smoke` fails at the Filters sheet, which Phase G is rebuilding (T62, uncommitted at the time); the cards themselves render. Found on the way and fixed: swipe-time counts were read before the per-user lock, so a burst passed the daily cap (24 of 20); `swipe-batch-test` now checks whichever of the queue and daily caps is lower.

<a id="t71"></a>
### [x] T71 — One query to sign in (audit decision 5, light option)
Do: `getSessionAndUser` in `lib/auth.ts` as one SQL join returning the session, the user and whether a profile exists; the proxy and `getCurrentUser` read that instead of querying again. Database sessions kept (the owner's choice: the test scripts sign in with them).
**Done when:** sign-in costs one query per request, pages are re-measured, and `security-test`, `onboarding-smoke`, `answers-smoke`, `infra-smoke` pass.
Done 10 Oct: query log shows one session query per request (was four); `/answers` and `/account` 1.6–2.2 s → 0.8–1.1 s warm on the dev server. All four checks PASS.

<a id="t72"></a>
### [x] T72 — Sponsorship asked once for every country abroad
Do: `modules/apply/sponsorship.ts` and the needs-sponsorship branch of `valueResolver.ts`: one standing answer (`sponsorship_outside_home`) for jobs outside the home country, asked instead of the per-country question; the pre-scan keeps it as one gap.
**Done when:** `scripts/sponsorship-test.ts` PASS and the answering chain checks still pass.
Done 10 Oct: `sponsorship-test` PASS (14 checks); `resolver-test`, `acknowledgement-test`, `keys-test`, `recall-test`, `derive-test`, `essay-test`, `gaps-test`, `precheck-smoke` PASS. `option-map-test` fails 2 live model cases ("12 LPA" → "10-15 LPA", an unlisted event → "Other"): the model now leaves them unmapped. Fixed the same day: numbers in ranges are placed by code (`numericRange` with units), and the prompt's "Other" rule is stated plainly; `option-map-test` PASS three runs in a row (14 checks).

<a id="t73"></a>
### [x] T73 — Applications list in pages; detail page re-renders only on a change (audit decisions 3 and 4)
Do: page `GET /api/applications` (active always, finished 25 at a time, counts per status) and `applications-list.tsx` (Show more, pages kept on poll); `AutoRefresh` polls `?only=version` and refreshes only on a change, slower while waiting for the user, never while hidden.
**Done when:** `scripts/applications-pages-smoke.ts` PASS and `applications-smoke`, `security-test`, `notify-smoke`, `shell-smoke` pass.
Done 10 Oct: `applications-pages-smoke` PASS (10 checks: counts over all 51, first page 26 rows, Show more to 51, kept after a poll, Sent tab paged; detail: 2 version checks and 0 page renders while unchanged, 1 render on a change, checks stop once sent). `applications-smoke` (its All check now expects the first page), `security-test`, `notify-smoke`, `shell-smoke` PASS; typecheck and lint pass.

<a id="t74"></a>
### [x] T74 — Pages kept between tabs; the feed kept on the server for a minute
Do: `experimental.staleTimes.dynamic = 60`; `lib/forget-pages.ts` (server function) after every save; the deck remembers jobs swiped this visit; the applications list shows its last result while it reloads; `lib/feed-cache.ts` (per-user feed, a minute, cleared by swipes, profile and resume changes, preferred locations).
**Done when:** `scripts/navigation-cache-smoke.ts` PASS on a production build and the feed, list and answer checks still pass.
Done 10 Oct: `navigation-cache-smoke` PASS against `next start` (6 checks: coming back to the feed 15 ms with no server render, a swiped card never returns, a save makes the next visit fresh); on the dev server, which never keeps pages, a return costs about 300 ms thanks to the server copy (was 1–2 s). `next build` passes. Typecheck, lint and 18 checks PASS (`lifecycle-smoke` on a rerun: its retry step races the running worker).

<a id="t75"></a>
### [x] T75 — Bugs found testing Greenhouse end to end (10 Oct)
Do: the feed leaves out companies at the weekly limit; country tagging by whole words, US states and codes (192 jobs re-tagged); newest answer wins for country questions across all saved answers; work-history dates and tick boxes never take the start-date or job-title answers; the agent's own keys are never a form question's key; "I understand that…" notices are acknowledgements; the dry run uses the real answering chain.
**Done when:** the weekly-limit reproduction shows 0 cards at the limit, 23 sample locations tag right, and the Coinbase dry run (nitin, not submitted) passes with work authorization No.
Done 10 Oct: Rubrik 4 cards with 2 applications this week, 0 at 3; locations 23/23; dry run PASS (34 fields, 30 filled, none empty, resume attached; work authorization No from the newest answer; Start date year asked instead of "na"). See the checks listed in the commit.

<a id="t76"></a>
### [x] T76 — A real Greenhouse application end to end
Do: send one real application with the presenter's profile and fix what it finds: the reaper failing resumed runs, "the country where you reside" treated as the job's country, Greenhouse's demographic-data consent box read as optional.
**Done when:** a real Greenhouse application reaches `submitted`.
Done 10 Oct: Stripe, Software Engineer New Grad (Singapore), nitin: 5 facts asked before opening the form, 27 fields, 21 answered, consent ticked, security code entered, `submitted` (confirmation page reached). `queue-smoke` (resumed run left alone), `greenhouse-form-test` (consent box), `resolver-test` (residence wording) and the answering checks PASS.
