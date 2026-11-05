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
