# Phase K tasks — Naukri (and LinkedIn) through the user's own account

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) Phase K lists these tasks one line each and links here; this file holds the full entry per task: Do, the design sections it builds, Done when, and the `Done <date>:` line once it lands. Mark `[~]` / `[x]` here first, then on the root line.

Order K1 → K2 → K4, one session each, plan first, the Done-when check run and its output pasted, typecheck and lint. K4b after K4's real submit. K3 and K5 (LinkedIn) are designed in their own `docs/linkedin/` after K4's real runs and move there with it.

Starts only when Phase J is done: T94 (Lever handoff), T95 (SmartRecruiters), T96 (Keka) in `APPLY_BOARDS`, T97 (board report). Rules in CLAUDE.md and ARCHITECTURE §6.20.

<a id="k1"></a>
### [~] K1 — Connect flow and tooling decision
Do: `SiteConnection` schema and migration, the per-site rules, site-scoped encrypted browser state in `lib/storage.ts`, `modules/sources`, three routes (list, connect, disconnect; the "fetch now" ingest route moved to K2, since it queues work only K2's handler runs), the `source-connect` queue with its screen-only handler and `hasScreen` beat, the Account card and sheet; ARCHITECTURE §6.20 and §11 record the choice.
Design: [3 Options and decision](TDD.md#3-options-and-decision) · [4.1 Components](TDD.md#41-components) · [4.2 Queues](TDD.md#42-queues-pg-boss) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) · [4.4 State machine](TDD.md#44-connection-state-machine) · [4.5 Sequence: Connect](TDD.md#45-sequence-connect-k1) · [4.9 Security](TDD.md#49-security-and-privacy) · [4.12 Code map](TDD.md#412-code-map) · [4.13 Env](TDD.md#413-env-architecture-11-additions) · [5 UI](TDD.md#5-ui) · [6 API](TDD.md#6-api).
**Done when:** the owner connects Naukri in the handoff window without typing anything into our app; `naukri-connect-smoke` PASS (a worker restart keeps the session, Disconnect deletes the blob, a test profile is refused); typecheck and lint pass.

<a id="k2"></a>
### [~] K2 — Naukri job ingest
Do: `sites/naukri.ts` and `sites/ingest.ts` (the run, under `modules/apply` because it drives the window), `fetchers/naukri.ts`, the board entry, `storeSiteListings` with `SourceRun`, the "fetch now" route moved here from K1, Naukri in the feed only (applying stays off until K4), the cron tick and the on-demand route, `applyBoardsFor`, the "via Naukri" feed chip and filter, the 14-day close.
Design: [4.6 Sequence: ingest](TDD.md#46-sequence-per-user-ingest-k2) · [4.8 Checks, refusals and pace](TDD.md#48-checks-refusals-and-pace) · [4.10 Failure handling](TDD.md#410-failure-handling) · [4.11 Observability](TDD.md#411-observability) · [7 Testing](TDD.md#7-testing).
**Done when:** `naukri-listing-test` PASS; `naukri-ingest-smoke` for the owner stores Naukri jobs that show in their feed with tiers and "via Naukri" and stops at the budget with a `budget` event; a second, unconnected user sees none; a Workday-redirect job is not stored and a Greenhouse-redirect job carries `applyVia = greenhouse`.

<a id="k3"></a>
### [ ] K3 — LinkedIn job ingest
Do: as K2 for LinkedIn (`source = linkedin`) on the same `SiteConnection`, `openBrowser({site})` and `ingestForUser`; jobs whose Apply leaves for a company ATS keep that URL.
Design: its own short TDD in `docs/linkedin/`, written after K4's real runs; reuses [4.1 Components](TDD.md#41-components) and [4.6 Sequence: ingest](TDD.md#46-sequence-per-user-ingest-k2).
**Done when:** as K2 for LinkedIn.

<a id="k4"></a>
### [~] K4 — Naukri apply adapter
Do: recon (5 Nov: Naukri's own job-page and drawer scripts, read signed out, nothing pressed) gives the drawer markup and the apply and bot calls, copied into the mock Naukri page (`app/mock/naukri/mock.ts`, K4b); the owner's first real submit confirms them; `stepwise`/`advance` in the runner; the adapter with questions through the answer bank and `needs_input` for the rest; routing, pace and connection checks; `explain.ts`/`steps.ts` copy.
Design: [4.7 Sequence: apply](TDD.md#47-sequence-apply-k4) · [4.8 Checks, refusals and pace](TDD.md#48-checks-refusals-and-pace) · [7 Testing](TDD.md#7-testing) · [8 Rollout](TDD.md#8-rollout) · [11 Decisions](TDD.md#11-decisions-closed-with-the-owner-3-nov) items 1 and 2.
**Done when:** `naukri-adapter-test` PASS; `naukri-dry-run` on 3 real jobs reaches Apply signed in and presses nothing; one real right-swipe by the owner ends `submitted` with Naukri's confirmation and screenshot and the questions with sources on the application page; a question it could not answer went through "Needs you" once; `ENABLE_NAUKRI=1` and Naukri in `applyBoardsFor`.

<a id="k4c"></a>
### [ ] K4c — Naukri jobs that apply on another board
Do: a Naukri job with `applyVia` (Greenhouse, Lever, Ashby, Keka) applies through that board's adapter: its form URL and ids from the redirect URL (`adapters/*.ts formUrl` reads Naukri's ids today), the board's own queue and switch (`APPLY_BOARDS`), Naukri's caps not counted; until then `swipeRefusal` refuses them (`board_not_supported`) and nothing is recorded.
Design: [4.7 Sequence: apply](TDD.md#47-sequence-apply-k4) ("redirect to company site"), ARCHITECTURE §6.20 Apply (K4).
**Done when:** a Naukri job that redirects to Greenhouse goes through the Greenhouse adapter on the mock form for a test profile and on one real job for the owner; typecheck and lint pass.

<a id="k4b"></a>
### [x] K4b — Mock Naukri drawer
Do: `/mock/naukri` (`app/mock/naukri/`: the page and Naukri's two services) for the smoke test, built before K4's real submit at the owner's request (5 Nov); the hard rule widens from `/mock/greenhouse` to both mock forms in CLAUDE.md and PRD §9 in the same change.
Design: [11 Decisions](TDD.md#11-decisions-closed-with-the-owner-3-nov) item 4 · [7 Testing](TDD.md#7-testing).
**Done when:** `scripts/naukri-mock-smoke.ts` (owner, 5 Nov: in place of `tests/smoke.spec.ts`, which is T22 and not built) runs the Naukri step loop against the mock drawer on a test profile and passes; typecheck and lint pass.
Done 2026-11-05: naukri-mock-smoke 13/13 (asked once with nothing sent, then sent with 4 answers and sources; test profile on real Naukri blocked; a mock on another host refused), naukri-adapter-test 51/51 on the same page; `/mock/naukri` driven by hand in the app through to `/mock/submissions`.
Changed: `app/mock/naukri/` (mock.ts, route.ts, the two service routes), `app/mock/submissions/page.tsx`, `runner.ts` (mock path), `urls.ts` (`mockSiteOf`), CLAUDE.md and PRD §9, ARCHITECTURE §10.1.

<a id="k5"></a>
### [ ] K5 — LinkedIn Easy Apply adapter
Do: adapter for Easy Apply's multi-step dialog on K4's step loop; external-apply jobs go to the ATS adapter we have, else are not offered.
Design: with K3 in `docs/linkedin/`, after K4's real runs; reuses [4.7 Sequence: apply](TDD.md#47-sequence-apply-k4).
**Done when:** dry runs on 3 Easy Apply jobs fill everything they can; one real submit before LinkedIn goes into `APPLY_BOARDS`.

## A million users: the user's own session, run from our cloud (owner, 23 Nov)

Designed in [TDD §13](TDD.md#13-naukri-for-a-million-users-the-users-own-session-run-from-our-cloud-decided-23-nov-2026); decided by the owner on 23 Nov, the myjobb way ([§13.11](TDD.md#1311-decision-owner-23-nov-2026-the-myjobb-way)): connect from the phone through a streamed sign-in (or the desktop extension), a residential proxy per user from the start, runs in our cloud. Open questions in [§13.15](TDD.md#1315-open-questions-for-the-owner). Starts after the job boards work (owner, 7 Nov). Order: K6 → K7 → K8 → K10 → K14 → K11; K9 when K6's V1 allows it; K4c, K13 and K12 (Naukri jobs on a company ATS) at any time, they need no Naukri session. Each is one session, plan first.

<a id="k6"></a>
### [~] K6 — Checks on the owner's account, through a proxy
Do: with one residential proxy from the chosen provider (§13.15 item 1) and the owner's Naukri account, nothing pressed on a real job without the owner's yes for that job: V1 a session made through the proxy survives the proxy's address changing within the city, and a session made at home works through the proxy; V2 whether Naukri's own apply and chatbot requests carry a value the page makes (read in DevTools on one job); V3 a job with questions answered through to applied; V5 Naukri's own daily cap; V6 the share of Naukri-only listings over the owner's runs, by target system; V7 how long the refresh token lives unused; plus the bytes of a search page, a job page, a refresh and an apply, through the proxy.
Design: [13.11 Decision](TDD.md#1311-decision-owner-23-nov-2026-the-myjobb-way) · [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) · [13.15 checks](TDD.md#1315-open-questions-for-the-owner).
**Done when:** V1–V7 each have a measured answer with numbers in this entry's Done line, §13.2's assumed page weight is replaced by the measurement, and the owner has answered §13.15 items 1, 2 and 4 from them.

<a id="k7"></a>
### [~] K7 — A residential proxy per user
Do: one sticky session per user, named by an HMAC of site and user id (no table: the provider keys stickiness on the name; a table only if V1 needs addresses held for months); provider credentials in env (ARCHITECTURE §11); `browser.ts` opens a Naukri context through the user's proxy, and a small HTTP client under `modules/apply/sites` does the same for request-level calls; nothing for Naukri leaves a worker's own address (a run without a proxy fails closed); per-user proxy bytes counted on `SourceRun` and the application's events.
Design: [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) (Egress) · [13.11 Decision](TDD.md#1311-decision-owner-23-nov-2026-the-myjobb-way) item 3.
**Done when:** `scripts/naukri-egress-test.ts` PASS (two users get different addresses, the same user keeps theirs across runs, a Naukri request with no proxy is refused before it leaves); the owner's ingest run goes out through the owner's proxy with bytes recorded; typecheck and lint pass.

<a id="k8"></a>
### [~] K8 — Streamed Naukri sign-in on the phone
Do: `source-connect` on a cloud worker with a display: a fresh Chrome context through the user's proxy on Naukri's login page, phone-sized; `Page.startScreencast` frames and the user's taps and keys through the worker's own relay (owner, 23 Nov: server-sent events down, POSTed input up, no WebSocket; `modules/apply/sites/relay.ts`, the pass from `GET /api/sources/:site/stream`, scoped to the user's connect job, input never logged, frames never stored); `waitForSignIn` and the sealed save as K1; the consent sheet (account risk, a home address in their city) and the streamed sheet on Account, with loading, error and expired states; CLAUDE.md's signed-in-sources hard rule and ARCHITECTURE §6.20 (sign-in, silent re-login, proxies, cloud workers) rewritten to the owner's 23 Nov decision in the same change.
Design: [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) (Connect on a phone, Mobile UX) · [13.11 Decision](TDD.md#1311-decision-owner-23-nov-2026-the-myjobb-way) · [4.4 State machine](TDD.md#44-connection-state-machine) · [4.9 Security](TDD.md#49-security-and-privacy).
**Done when:** the owner connects Naukri from their phone at 390 px through the stream, password and OTP typed by the owner, "Connected as <name>" shown, with no worker on the owner's laptop; nothing of the login pages is stored or logged (checked in the relay's and worker's logs); `naukri-connect-smoke` PASS with the stream; typecheck and lint pass.

<a id="k8b"></a>
### [x] K8b — Connect Naukri with a code (OTP), no Naukri page on the phone
Do: on K8's relay, `POST /stream/<id>/login` (the mobile number, or the saved one) and `POST /stream/<id>/code` (Naukri's code), handled by the worker driving Naukri's own OTP login (`sites/naukriOtp.ts`) in the stealthy Chrome through the user's proxy; a challenge falls back to K8's page for that step; the number kept sealed (`browser-state/<userId>/naukri-login.json`); the Account sheet becomes number, then six-digit code, then "Connected as <name>"; CLAUDE.md and ARCHITECTURE §6.20 changed to the owner's OTP rule.
Design: [13.16 OTP connect](TDD.md#1316-otp-connect-owner-23-nov-2026-after-the-first-live-try) · [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) · [4.9 Security](TDD.md#49-security-and-privacy).
**Done when:** the owner connects their real Naukri account from the app with their number and Naukri's code only, "Connected as <name>" shown; a local Naukri-like page passes the same flow in `naukri-stream-smoke` with the code and number absent from logs and storage (the number only sealed); typecheck and lint pass.
Done 23 Nov: the owner connected their real account from the app on the laptop (number, then Naukri's code; "Nitin"), session and number sealed, first run 3 searches, 13 listed, 1 new job; `naukri-stream-smoke` 78/78. Local worker, direct egress (no proxy yet).
Paths: `sites/naukriOtp.ts`, `sites/relay.ts` (/login, /code), `sources/login-number.ts`, `account/sign-in-stream.tsx`.

<a id="k9"></a>
### [ ] K9 — Connect from a computer: the extension
Do: only if K6's V1 shows a session made at home works through the user's proxy: a one-button MV3 extension (`extension/`): pairing by a one-time code from Account, "Connect Naukri" with consent, posts the browser's naukri.com cookies to `POST /api/sources/naukri/session` (Zod, naukri.com only, sealed at once, nothing else read, no other site's cookies); Disconnect from the app deletes the session.
Design: [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) (Connect on a computer) · [13.7 Option (e)](TDD.md#137-option-e-extension-for-sign-in-cloud-workers-for-runs).
**Done when:** the owner connects from desktop Chrome and the next run reads and applies through the owner's proxy with that session; a cookie for any other site sent to the route is refused; typecheck and lint pass.

<a id="k10"></a>
### [ ] K10 — Keep alive and run in the cloud
Do: `source-refresh` (Naukri's own refresh with the sealed session through the user's proxy, before each run, and on V7's cadence only if needed; a refused refresh → `needs_signin` and a push); `ingest-source` and Naukri applies taken by cloud workers with a display instead of the laptop (`WorkerBeat.hasScreen`, the browser per §13.15 item 3); apply at request level when V2 allows (a chatbot-JSON question parser beside `questionOf`, `readApplyReply` as evidence), else K4's page run; caps, pace, `check('submit')` and every event unchanged.
Design: [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) (Keep alive, Apply) · [13.13 What carries over](TDD.md#1313-what-carries-over-from-todays-code) · [4.7 Sequence: apply](TDD.md#47-sequence-apply-k4) · [4.8 Checks](TDD.md#48-checks-refusals-and-pace).
**Done when:** with the owner's laptop worker off, the owner's account refreshes, runs a job run and sends one real right swipe from the cloud through the owner's proxy, ending `submitted` with Naukri's reply and the answers' sources; an expired session ends in `needs_signin` with a push and nothing sent; `naukri-adapter-test` and `naukri-mock-smoke` still PASS; typecheck and lint pass.

<a id="k10a"></a>
### [~] K10a — The cloud worker image: the stealthy Chrome on a virtual screen
Do: a `screen` stage in `Dockerfile.worker` (Xvfb, Python and SeleniumBase 4.58.0 in a venv, non-root, the relay port) with `scripts/screen-entrypoint.sh` starting the display; the default image stays the screenless reader; `ConnectOptions.firstRun` so checks queue no real read; DEPLOY, ARCHITECTURE §6.21 and CLAUDE.md's Testing line updated.
Design: [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) (cloud workers) · ARCHITECTURE §6.21.
**Done when:** the image builds; inside it `canShowWindow()` is true and `naukri-stream-smoke` PASS (the stealthy Chrome under Xvfb, the relay, the OTP flow); typecheck and lint pass. Running it on a VM for real users is K10.

<a id="k11"></a>
### [ ] K11 — Pilot of 20 accounts, then a load test
Do: 20 users connect from their phones and run for a week; then a simulator drives connect, refresh, buckets and applies at 10k and 100k users' load (§13.2) against recorded replies; measure proxy GB a user a day, account checks per user, cloud worker hours, Postgres writes, LLM calls an apply; caps revisited; the next stage's changes proposed with numbers and ARCHITECTURE updated for what the owner accepts.
Design: [13.14 Path](TDD.md#1314-path-to-a-million-users) · [13.10 At a million users](TDD.md#1310-at-a-million-users) · [13.2 Load](TDD.md#132-load-one-user-one-million-users).
**Done when:** the Done line records the pilot week (users, runs, applies sent, checks met per user, proxy GB a user a day) and the measured limits at 10k and 100k simulated users.

<a id="k12"></a>
### [ ] K12 — Workday apply adapter
Do: after the owner answers §13.15 item 7 (Workday accounts): an adapter for Workday's candidate flow (account or sign-in per employer, the multi-page wizard, resume upload, questions through `resolveForm`), `workday` in `APPLY_BOARDS` behind its own switch, Naukri listings that redirect to `*.myworkdayjobs.com` routed to it through K4c; a dry run first, nothing submitted without the owner's yes. Serves every Workday job, not only Naukri's.
Design: [13.6 Option (d)](TDD.md#136-option-d-naukri-for-discovery-apply-on-the-companys-own-ats-from-our-cloud) · [13.15 item 7](TDD.md#1315-open-questions-for-the-owner); a short TDD of its own first (it touches accounts, storage and the runner).
**Done when:** dry runs on 3 real Workday jobs from different tenants fill every page and stop before Submit; one real submit by the owner ends `submitted` with the screenshot and sources; the account handling matches the owner's answer; typecheck and lint pass.

<a id="k13"></a>
### [ ] K13 — Naukri as a company directory for our ATS ingest
Do: every Naukri listing whose `applyRedirectUrl` is on a board we ingest (`boards.ts adapterBoardOfHost`, plus Workday's tenant and site from `fetchers/workday.ts workdaySlugOf`) adds or reactivates that company as an ordinary `Company` row (`addedBy = "naukri"`) for the daily ATS ingest, so its jobs reach every user, Naukri connection or not; the company's Naukri copies fold into the ATS rows (`roleKey`). Reads only what users' own runs already fetched; no extra Naukri pages.
Design: [13.6 Option (d)](TDD.md#136-option-d-naukri-for-discovery-apply-on-the-companys-own-ats-from-our-cloud) · [13.11 Decision](TDD.md#1311-decision-owner-23-nov-2026-the-myjobb-way) item 4.
**Done when:** after the owner's next two Naukri runs, the new companies show in `scripts/feed-report.ts` with their boards and open India jobs, a user with no Naukri connection sees those jobs in their feed, and no job appears twice; typecheck and lint pass.

<a id="k14"></a>
### [ ] K14 — Discovery by search bucket, in the cloud
Do: `planSearches` gives each user's searches as (keyword, city, experience) buckets; a due bucket is read once a window on a cloud worker in Chrome, with the session and proxy of one connected user whose own search it is (§13.15 item 5), so the page makes its own signature; listings shared as ordinary `Job` rows; a run record per bucket beside `SourceRun`; job pages only for jobs not yet stored. No shared signed-out reader (§13.15 item 6).
Design: [13.9 Discovery at scale](TDD.md#139-discovery-at-scale-who-reads-naukris-listings) (ii) · [13.12 Architecture](TDD.md#1312-architecture-connect-keep-alive-run) (Reads).
**Done when:** in the K11 simulator at 10k and 100k users, Naukri page loads a day grow with the number of buckets, not users (numbers in the Done line); every pilot user sees the jobs of their own searches; typecheck and lint pass.
