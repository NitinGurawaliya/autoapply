# Phase M tasks: more boards, employer accounts and discovery at scale

This is the task file for [TDD.md](TDD.md). The root [docs/TASKS.md](../TASKS.md) Phase M section lists these tasks one line each and links here. This file holds the full entry for each task: Do, the design sections it builds, Done when, and the `Done <date>:` line once it lands. Mark `[~]` / `[x]` here first, then on the root line.

The order is the owner's (9 Nov, [TDD 3.4](TDD.md#34-the-ranking-open-india-jobs-per-task-session)): boards with public forms first, boards that need an employer account later.
1. M1 and M2, the measure and the scale.
2. M3, every known company on the boards we already apply on (the GitHub and Hugging Face company lists).
3. M7 (SmartRecruiters), M12 (Workable), M13 (Zoho Recruit), then M14 (the long tail).
4. M4, beside them from M3 on; M16–M19 alongside, when their triggers come (TDD 3.4).
5. Later, the account block: M5 (application password), M6 (Workday), M8 (SuccessFactors), M10 (Darwinbox).
6. Parked: M9, M11 (Oracle), M15 (iCIMS), M20.

After M3, two weeks of M1's daily numbers confirm or reorder 3 and 5. Each task is one session, plan first, with the Done-when check run and its output pasted, then typecheck and lint. Tasks that make a decision update ARCHITECTURE in the same change.

The owner's decisions are in [TDD §11](TDD.md#11-decisions-closed-with-the-owner-9-nov); nothing below waits on a question. Naukri and the other signed-in Indian portals (foundit, hirist, iimjobs, Instahyre) come after this phase (owner, 7 Nov).

<a id="m1"></a>
### [~] M1 — Board measurement, daily
Do:
- Add the `BoardDay` model and its migration (`migrate deploy`).
- Write `scripts/board-day.ts`. It writes one row per board for the day: companies by tier, open India jobs, India tech, India entry-level, new India jobs first seen that day, right swipes and submitted. Before M2 lands, every company counts as `active`.
- Add a worker cron at 23:30 UTC.
- Extend `scripts/feed-report.ts --from --to` to print the rows as a table, with new India jobs per day and per company.
- This takes over T97's report half. T97's docs half (ARCHITECTURE §5) stays with T97.

Design: [3.4 Ranking](TDD.md#34-the-ranking-open-india-jobs-per-task-session) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) (`BoardDay`) · [4.11 Observability](TDD.md#411-observability).
**Done when:** `board-day-test` PASS; the cron wrote rows on two consecutive days for every board; `feed-report --from <day1> --to <day2>` prints them; typecheck and lint pass.
In progress 9 Nov: `BoardDay` migration applied (`migrate deploy`), `modules/jobs/boardDay.ts`, the `board-day` queue and 23:30 UTC cron, `scripts/board-day.ts`, `feed-report --from/--to`, ARCHITECTURE 6.2 step 6. `board-day-test` PASS (14 checks); typecheck and lint pass; rows for 8 and 9 Nov written by hand (open India: Workday 3,714, Keka 3,489, Greenhouse 2,727, Lever 808, Ashby 446, Zoho 157; new India jobs 0, as no ingest has run since 5 Nov). Left: the running worker picks up this code and its cron writes two days on its own.

<a id="m2"></a>
### [~] M2 — Watch every company cheaply: tiers, India-only storage, per-company ingest
Do:
- Add the `Company` tier fields (`tier`, `nextFetchAt`, `indiaOpen`, `lastIndiaAt`, `listHash`) and their migration.
- Write `cadence.ts` with the tiers `active` / `open` / `empty` / `dead`, back-off and jitter.
- Write `ingestCompany(id)` in `ingest.ts`, with the list → detail split and the `listHash` short-circuit, starting with Greenhouse, Lever, Ashby, Keka and Workday.
- Add the `ingest-tick` and `ingest-company` queues with the per-host cap, behind `INGEST_MODE`.
- Make `stores` India-eligible by default. Keep abroad jobs only for the companies watched before M3 (owner, 9 Nov: Greenhouse and Lever's ~460).
- Delete closed rows after 7 days.
- Update ARCHITECTURE §6.2 and §11.

Design: [4.2 Queues](TDD.md#42-queues-pg-boss) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) · [4.8 Ingest at 50,000 companies](TDD.md#48-ingest-at-50000-companies-load-and-postgres-size) · [4.10 Failure handling](TDD.md#410-failure-handling) · [8 Rollout](TDD.md#8-rollout) step 2.
**Done when:**
- `cadence-test` and `ingest-contract-test` PASS.
- `ingest-scale-smoke` passes on 20,000 synthetic companies: the oldest overdue company is under 1 hour, the per-host cap is never exceeded, and the run prints requests a day.
- One day on `INGEST_MODE=tick` matches the old run's open India job counts per board within 2%.
- `Job` size is recorded before and after.
- Typecheck and lint pass.

In progress 9 Nov: built and measured, not yet on the worker.
- Code: `cadence.ts`; `ingest.ts` `ingestOne`, `recordRead`, `dueCompanies`; the `ingest-tick` and `ingest-company` queues (exclusive per company, pg-boss `groupConcurrency` per board) behind `INGEST_MODE` (default `run`). Greenhouse list probe (`listHash`). Workday reads details only for postings not held (`listOnly`). India-only `stores`, with `keepAbroad` for the 460 Greenhouse and Lever companies. Closed rows deleted after 7 days. `lib/undici-guard.ts`: Node's fetch threw an uncatchable parser assertion 9 times in one full read and had killed the process. Workday list pages with an empty posting no longer fail (16 tenants did on 9 Nov). ARCHITECTURE 6.2 step 5b and §11.
- Checks: `cadence-test` (19), `ingest-tick-test` (13), `ingest-contract` and `board-seeds` PASS. `ingest-scale-smoke` is a scheduler simulation, not a fake HTTP server: at 20,000 companies, ~29,000 reads a day (0.34/s); 5 min most overdue in steady state; 54 min to read a cold start of all 20,000; the per-board cap held. Typecheck and lint pass.
- One full tick-mode read of all 1,308 companies (`scripts/ingest-tick-now.ts`), against BoardDay 9 Nov written before it (4 days without ingest in between): open India jobs Greenhouse 2,727 → 2,749 (+0.8%), Lever 808 → 806, Ashby 446 → 448, Keka 3,489 → 3,524 (+1%), Workday 3,714 → 3,631 (−2.2%, 16 tenants then failing), Zoho 157 → 166. Tiers after: 1,260 active, 43 open, 5 empty. `Job` 468 MB / 41,730 rows → 492 MB / 38,912 rows (7-day deletion).
- Deployed 10 Nov 17:36 UTC: the laptop Docker worker `swipeapply-worker` (image `swipeapply-worker:m-tick`, this branch with main merged) runs with `INGEST_MODE=tick`.
  - First tick: 899 companies due, 0 failed, 94 new jobs (62 India-eligible), 899 jobs embedded, 859 old closed jobs deleted.
  - Each tick queued its companies one `send` at a time, ~0.35 s each, so 899 took 5 minutes. Now it uses batch inserts of 500 (`enqueueIngestCompanies`): 167 in under 5 s; a duplicate is skipped.
- Left: a day of tick mode matching within 2%, and M1's cron writing 10 and 11 Nov on its own.

<a id="m3"></a>
### [~] M3 — Seed every known company on the boards we apply on
Do:
- Extend `boardSeeds.ts` / `scripts/discover-boards.ts --import` from Greenhouse, Lever and Ashby to every board in `boards.ts`, keeping Keka, Workday and Zoho slugs as hosts.
- Import the open lists (owner, 9 Nov: all of them): ats-scrapers `ats-companies/`, upstreamit's live slugs, openroles and jobseek, and Hugging Face `latmay`, credited. Record each list's commit or checksum and its licence in `slugSources/lists.ts`.
- Verify each slug on the board's own API and watch every one that is a board, whether or not it lists an India job today. Its tier comes from what it lists.
- Board order: Greenhouse, Ashby, Keka, Lever (watched now, applied to once T94 lands), then Workday for ingest (applied to after M6).
- Each import is a dry run first, with counts only.

Design: [3.3 Discovery at scale](TDD.md#33-discovery-at-scale) · [4.7 Sequence: discovery](TDD.md#47-sequence-discovery-at-scale) steps 2–3 · [2 Facts](TDD.md#2-facts-the-design-rests-on-research-and-measurements-7-nov-2026) 8, 10, 16.
**Done when:**
- Per board, the report shows slugs listed per source, checked, on the board, watched by tier, and open India jobs before and after.
- Open India-eligible jobs on Greenhouse, Ashby, Keka and Lever rise by at least 3,000 over the 7 Nov count (11,341 across all boards).
- Every slug that came from a CC BY-NC source is refused by the test.
- Typecheck and lint pass.

In progress 10 Nov:
- Done: the importer reads every board (`--watch-all`, `--from list:<name>`, licences in `slugSources/lists.ts`, `board-seeds-test` PASS). Dry run of ats-scrapers + upstreamit + latmay, nothing written:

  | Board | New slugs checked | Live boards | India jobs on them |
  |---|---|---|---|
  | Greenhouse | 9,469 | 3,707 | 998 |
  | Lever | 8,301 | 2,226 | 887 |
  | Zoho Recruit | 1,572 | 1,182 | 286 |
  | Ashby | 1,665 | 798 | 74 |
  | Keka | 0 (all known) | — | — |

  Workday was stopped (applied to only after M6).
- Owner, 10 Nov: write later, once the infra runs (the worker on this code in tick mode, M1/M2 proven). The dry run keeps no per-company record, so the write re-checks every slug. Re-fetch the lists at the pinned versions, then run `discover-boards.ts --import <list> --boards <b> --watch-all --from list:<name> --write`, about 2 h for the five boards.

In progress 17 Nov (owner: one board at a time, each finished before the next; recorded boards first, then every list):
- Discovery's check now counts only a 404, a 410 or "no portal" as not a board, on every board (`boards.ts openOrGone`); a 429, 5xx or timeout is a failed check, retried later, never written. The importer takes `--shard i/n` (parallel runs never share a board) and pauses itself for 10 min when more than a third of the last 50 checks fail, stopping the board after 3 pauses (`boardSeeds.ts`).
- Lists registered: ats-scrapers, upstreamit, latmay, and (17 Nov) openroles, jobseek, open-ats-feed and job-scraper, all MIT or CC BY, pinned in `slugSources/lists.ts`. Every slug is checked live on the board's own API before it is written.
- Greenhouse recorded boards: 2,523 checked in 6 shards, 2,479 watched, 44 gone, 0 failed. Ashby: recorded 3,407 checked, 3,336 watched; latmay 670, ats-scrapers 91, upstreamit 39 added; 0 failed, no pauses.
- **Not checked, and why:**
  - Workday (949 recorded tenants and its files in ats-scrapers, upstreamit, latmay and job-scraper): it answers 429 to checks from this IP; it needs its own slower run, apart from its ingest.
  - SmartRecruiters (1,138 recorded, its ats-scrapers and job-scraper files): the board is parked (M7, DataDome).
  - feashliaa's lists: CC BY-NC, no commercial use.
  - ats-scrapers' files for systems we do not apply on (iCIMS, SuccessFactors, Oracle, BambooHR, Personio, Darwinbox and others), and job-scraper's Rippling, Google, Netflix and similar entries: outside M3.
  - Keka from latmay (no Keka rows) and Zoho from ats-scrapers and upstreamit (no Zoho files).

<a id="m4"></a>
### [ ] M4 — Continuous discovery and re-validation (supersedes T98)
Do: build the `slugSources/` layer and the `discover-source` and `discover-verify` queues. Sources:
- the Common Crawl columnar index through DuckDB: each new crawl once, all boards in one pass, `job-boards.greenhouse.io` and the EU hosts included;
- a one-off Wayback backfill for Lever and Ashby;
- a monthly re-read of the lists;
- links harvested from ingested `applyUrl`s and descriptions (ATS hosts, and Phenom apply links to their Workday or SuccessFactors tenant);
- the India probe (T93) over DPIIT and YC company websites if its terms allow (owner, 9 Nov; no paid sources).

Re-validation runs on `nextCheckAt`. Remove model-proposed names and the CDX loop from `discovery.ts`. Update ARCHITECTURE §6.2.
Design: [3.3 Discovery at scale](TDD.md#33-discovery-at-scale) · [4.7 Sequence: discovery](TDD.md#47-sequence-discovery-at-scale) · [4.12 Code map](TDD.md#412-code-map).
**Done when:**
- `board-seeds-test` PASS for every board's crawl and list parsing.
- One crawl's pass lists slugs for every board in under 10 minutes.
- After a week, the report shows new companies per source and the `listed` backlog at zero.
- Typecheck and lint pass.

<a id="m5"></a>
### [ ] M5 — Employer accounts: application password, vault, permission, the email step by the user
Do:
- Add the `EmployerAccount` model and its migration.
- Write `lib/secrets.ts` (AES-256-GCM, `ACCOUNT_SECRET_KEY`, key versions) and `modules/accounts` (the only code that reads `secret`).
- The application password (owner, 9 Nov): the user sets it once in Account (at least 12 characters, a letter, a digit and a symbol; "use it nowhere else"); each new employer account stores its own encrypted copy.
- Add the `create_employer_accounts` standing permission and its sheet.
- Build the account flow's shared steps in `modules/apply/account/flow.ts`: create, sign in, `needs_verification` (the run ends, "Done" re-enqueues it), `exists_elsewhere` (to `apply-person`), and codes through `codeRequester`.
- Add Account → Employer accounts (list, reveal with audit and rate limit, forget), the `/api/accounts/employers` routes and `/api/applications/[id]/verified`.
- Build `/mock/workday`.
- Add `max_accounts_created_*` to `config/rules.json`.
- Write ARCHITECTURE §6.21 and §11. Add the CLAUDE.md hard rule in §4.9 and widen the mock rule to `/mock/*` (owner, 9 Nov).

Design: [3.2 Employer accounts](TDD.md#32-boards-that-need-an-employer-account) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) · [4.4 State machine](TDD.md#44-employer-account-state-machine) · [4.9 Security](TDD.md#49-security-and-privacy) · [5 UI](TDD.md#5-ui) · [6 API](TDD.md#6-api).
**Done when:**
- `vault-test` PASS, including that the password appears in no event, log line or error.
- `account-flow-smoke` on `/mock/workday` passes for a test profile: create, verify by "Done", sign in on a second run, and `exists_elsewhere` handed over.
- The Employer accounts list shows the mock account and reveals its password once.
- Typecheck and lint pass.

<a id="m6"></a>
### [ ] M6 — Workday apply (K12 in the Naukri plan)
Do: first, read the open-source Workday code ([TDD §12](TDD.md#12-research-notes-and-sources), open-source references: `HarshadLambate/workday-autofill`, `ishaannarula/job-application-automation`, `simonfong6/auto-apply`, and `challaharshavardhan/WorkdayJobBot` read only, no licence) and note in this entry what each does about account creation, the email step, the wizard's `data-automation-id`s and Submit; port nothing without crediting MIT code. Then `adapters/workday.ts` on M5's flow, covering:
- "Apply Manually";
- create or sign in per tenant;
- the wizard pages (My Information, My Experience with Keka's `history.ts` rows, Application Questions through `resolveForm`, Voluntary Disclosures, Self Identify, Review);
- `markAttempted`, Submit, and Workday's own confirmation;
- routing to `apply-handoff` (a visible window, the worker's click) until measured.

Write `scripts/workday-test.ts` on saved pages. Put Workday in `APPLY_BOARDS` behind `ENABLE_ACCOUNT_BOARDS` and `ACCOUNT_BOARDS_USERS`. The K12 entry in `docs/naukri/TASKS.md` then points here.
Design: [4.6 Sequence: Workday](TDD.md#46-sequence-workday-apply-with-an-employer-account) · [3.1 Bot checks](TDD.md#31-which-boards-and-in-what-order) · [4.10 Failure handling](TDD.md#410-failure-handling). Workday runs in a visible window first (owner, 9 Nov).
**Done when:**
- `workday-test` PASS.
- Dry runs on 3 tenants with India jobs (e.g. Genpact, Citi, Hitachi) fill every page and stop before Submit.
- One real submit for the owner ends `submitted` with Workday's confirmation screenshot and a source on every value.
- The account appears in the owner's Employer accounts.
- Typecheck and lint pass.

<a id="m7"></a>
### [x] M7 — SmartRecruiters (T95, moved here)
Do: as T95, plus what 7 Nov found. First read `rajakrishna/easy-apply` (MIT, SmartRecruiters form) and `devilscrapes/smartrecruiters-jobs-scraper-javascript` (MIT, the postings API) as references ([TDD §12](TDD.md#12-research-notes-and-sources)):
- `fetchers/smartrecruiters.ts` lists with `country=in`, then each posting's detail.
- Add the host `jobs.smartrecruiters.com` and a discovery entry, with seeds from M3's lists.
- Write `adapters/smartrecruiters.ts` for the multi-step "Easy apply" (`oneclick-ui`).
- The form sits behind DataDome, so the adapter starts in a visible window with the worker's own click, and a challenge hands the window over (§3.1).

Design: [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe) · [3.1 Bot checks](TDD.md#31-which-boards-and-in-what-order).
**Done when:**
- Ingest stores Swiggy's and Freshworks' India jobs with eligibility tags.
- `ats-smoke` dry runs on 3 forms pass.
- One real submit, then SmartRecruiters goes into `APPLY_BOARDS`.
- The challenge rate on the first 10 submits is recorded.

In progress 9 Nov:
- Done: `fetchers/smartrecruiters.ts` (India list, `country=in`; details only for postings not held; name from the first posting) and the `smartrecruiters` board entry (India-only, form host `jobs.smartrecruiters.com`, discovery by host and address). Swiggy and Freshworks added and ingested: 165 and 20 open India jobs, eligibility `india`.
- The form, read 9 Nov without typing anything: page 1 (resume dropzone, first/last name, email twice, city autocomplete, phone with country code, structured Experience and Education lists, LinkedIn, Facebook, X, website, message), then Next to the screening questions and Submit. `GET /oneclick-ui/api/company/{companyId}/publication/{uuid}/config` says which standard fields are required (Freshworks: experience and education required). DataDome and Cloudflare scripts are on the page.
- 10 Nov, the owner's OK for dry runs given: the form is page 1 (an "Apply with resume" dropzone that parses the resume; first/last name, email twice, city autocomplete, phone with +91 preselected; Experience and Education lists, required for Freshworks; LinkedIn, Facebook, X, website; resume; message), then Next to the screening questions.
  - Every field sits in an open shadow DOM (`spl-input`, `spl-autocomplete`, `spl-phone-field`, `spl-dropzone`).
  - The form link is the job page's `a#st-apply`.
  - **Blocked:** DataDome shows "Access is temporarily restricted" to the worker's browser, headless and in the visible Chrome window. See [BLOCKERS.md](../BLOCKERS.md). No adapter yet.
- Parked (owner, 10 Nov): M12 goes first. The reader and the 186 jobs stay; the jobs do not reach the feed. Back when the block lapses or a SmartRecruiters partner key is in hand; then the adapter, dry runs, one real submit and `APPLY_BOARDS`.
- 17 Nov: the block is lifted in the stealthy Chrome (BLOCKERS.md): Miratech, WNS and Dr Reddy's job pages and Easy Apply forms loaded, 20 to 29 fields each. Supply: 3,498 open India jobs from 144 companies, ~610 new a day (~210 tech). Next: the adapter, dry runs on 3 forms, one real submit, `APPLY_BOARDS`.
Done 17 Nov: dry runs pass on 17 forms from 17 employers (8 to 50 fields; two-page, revealed follow-ups, multi-selects, currency boxes, experience and education entries); 12 real submits for Nitin from 12 employers, each answered 200, none challenged by DataDome (its slider came only in back-to-back dry runs); Swiggy 167 and Freshworks 15 open India jobs ingested, 3,550 in all.
Changed: `adapters/smartrecruiters.ts`, `adapter.ts` + `runner.ts` (`nextStep`), `history.ts` (entries), `valueResolver.ts`/`guess.ts`/`acknowledgement.ts`/`optionMap.ts` (rupee bands, pay boxes, self-ID lists, fact-certifying boxes), `match.ts` (on by default), `scripts/ats-smoke.ts`; ARCHITECTURE §6.6, §6.22.

<a id="m8"></a>
### [ ] M8 — SuccessFactors
Do:
- First read ats-scrapers' SuccessFactors scraper (MIT, Python) for fetch logic to port, credited.
- `fetchers/successfactors.ts` from each career site's `sitemap.xml` and RSS (`keywords=(india)`), with the company id and data centre read from the page and slugs from M3's lists.
- Build `adapters/successfactors.ts` on M5's flow: an account per company, with the email step as code, link or none per company.
- Follow the wizard of the RMK apply pages.

Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-research-and-measurements-7-nov-2026) (account systems) · [4.4 State machine](TDD.md#44-employer-account-state-machine) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe).
**Done when:**
- Ingest stores India jobs from EY GDS, Wipro and Mahindra.
- Dry runs on 3 companies stop before Submit.
- One real submit for the owner.
- `APPLY_BOARDS` behind `ENABLE_ACCOUNT_BOARDS`.

<a id="m9"></a>
### [-] M9 — The email step, automatic (parked: the owner keeps it manual, 9 Nov)
Parked 9 Nov: the owner keeps the email step manual. If that changes, do: the option the owner picks.
- Option 2 (a private relay address per user): the account email becomes the relay.
- Option 3 (a Gmail forwarding filter to our inbound address): the user's own email stays on the application.

Either way, add an inbound mail service (provider chosen with the owner) whose webhook keeps only the code or link for 15 minutes, keyed to the waiting application, and forwards or drops everything else. Then `codeRequester` and `needs_verification` read from it before asking the user. ARCHITECTURE §6.21 is updated.
Design: [3.2 Email step](TDD.md#32-boards-that-need-an-employer-account) · [4.9 Security](TDD.md#49-security-and-privacy).
**Done when:**
- On `/mock/workday`, a verification link and a code mailed to the inbound address are used with no person in the loop.
- No mail body is stored past 15 minutes (checked in the test).
- Typecheck and lint pass.

<a id="m10"></a>
### [ ] M10 — Darwinbox
Do:
- Write `fetchers/darwinbox.ts` on `{slug}.darwinbox.in/ms/candidateapi/job` and `job/{id}`, with a board entry (India-only storage, the `*.darwinbox.in` host) and seeds from M3's lists and the crawl.
- Write `adapters/darwinbox.ts` on M5's flow: create an account per employer with email and password, its sign-up code through the code sheet (or M9), then the apply form.
- The form has Turnstile, so the adapter starts in a visible window and a challenge hands it over.

Design: [3.1 Order](TDD.md#31-which-boards-and-in-what-order) · [4.4 State machine](TDD.md#44-employer-account-state-machine) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe).
**Done when:**
- Ingest stores Porter's, MakeMyTrip's and Airtel's India jobs.
- Dry runs on 3 employers stop before Submit.
- One real submit for the owner.
- `APPLY_BOARDS` behind `ENABLE_ACCOUNT_BOARDS`.

<a id="m11"></a>
### [-] M11 — Oracle Recruiting (parked with M9)
Do:
- First read ats-scrapers' Oracle scraper (MIT, Python) for fetch logic to port, credited.
- Write `fetchers/oracle.ts` on the CE REST requisitions with the India location facet, and its detail.
- Seed tenants from M3's lists.
- Write `adapters/oracle.ts`: passwordless email and 6-digit code from M9 (never more than 2 code tries, against Oracle's lock at 5), then the CE apply flow.

Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-research-and-measurements-7-nov-2026) (account systems) · [3.2 Email step](TDD.md#32-boards-that-need-an-employer-account). Waits on: M9.
**Done when:**
- Ingest stores JPMorgan's and Oracle's India jobs.
- Dry runs on 3 tenants stop before Submit with the code read automatically.
- One real submit for the owner.

<a id="m12"></a>
### [x] M12 — Workable
Do:
- Write `fetchers/workable.ts` on `apply.workable.com/api/v1/widget/accounts/{slug}?details=true`.
- Add a slug source from Workable's search API (`jobs.workable.com/api/v1/jobs?location=India`): company website → careers link → slug.
- Build `adapters/workable.ts` for the one-page form, which has Turnstile: a visible window, and a challenge hands it over.

Design: [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe) · [3.3 Discovery](TDD.md#33-discovery-at-scale) option D.
**Done when:**
- Ingest stores India jobs of Apna, Lokal and Zifo.
- Dry runs on 3 forms pass.
- One real submit, then `APPLY_BOARDS`.

In progress 10 Nov:
- Done: `fetchers/workable.ts` (widget API, one request a company) and the `workable` board entry (India-only, form host `apply.workable.com`, discovery by host and address). Apna (156 India jobs listed, 48 stored in the 60-day window) and Zifo (3 of 42 in India, 2 stored) are active; Lokal is watched as empty (no openings). 50 India jobs stored.
- Done: `adapters/workable.ts` reads the form from its public JSON (`/api/v1/jobs/<shortcode>/form`). `questions.ts` asks before the browser opens, and Workable is in `HANDOFF_BOARDS` (Turnstile on Submit, as Lever).
  - A survey of 60 India forms: text 162, paragraph 73, boolean 19, number 4, multiple 3; Education and Experience never required; the address arrives prefilled from the IP.
  - The form opens in headless Chromium.
- Done: `workable-test` PASS (14 checks). `ats-smoke` dry runs on 3 live forms with the owner's profile PASS: Zifo Senior Clinical Data Engineer 7/7, Apna Admission Counselor 7/7, Apna Hardware Procurement Lead 15/15, no field empty, resume attached, nothing submitted.
- First real submit tried 10 Nov for Nitin (the owner relayed Nitin's OK and answer), on Apna Full Stack Software Developer, behind `ENABLE_WORKABLE=1` on the worker and the swipe.
  - `swipeRight` blocked it with `min_match_score`: the T107 band gate ("They want about 2+ years; you have 1"; the model's verdict was a good fit).
  - All 50 Workable jobs score 0 for Nitin, so nothing was sent.
- Owner override, 10 Nov ("override this rule for nitin, we need to test the adapter"): `min_match_score` waived for that one application only. Written as an `override` event; every other swipe rule was re-checked and passed.
  - Run 1 sent nothing: the resume input carries `data-ui="resume"` itself, so the field was dropped and Workable refused the form. Fixed; a required field missing from the page now stops the run.
  - Run 2: 11/11 filled, resume attached. The worker's Submit sent nothing for 60 s (Turnstile), so the window went to a person. The form's POST left 46 s later, and the window closed before Workable's thanks page showed: `pending_verification`.
- After run 2: submit now reads Workable's own answer to the application POST (`readReply`): 2xx is sent, even if the window closes; 4xx is a refusal with its words, handed to a person; else unknown. The worker waits 120 s, not 60, before handing over for Turnstile.
- 10 Nov, test set for the adapter (the owner: more Workable jobs, Nitin's profile only).
  - Workable's job search (`jobs.workable.com/api/v1/jobs?location=India`, 10 developer queries) gave 134 companies. 125 slugs were confirmed on the widget API by name match.
  - Import: 55 companies added with fresh India jobs (1,303 listed); ingest stored 591 (`lokal-app` is Lokal's real account).
  - Workable answers 429 after ~250 calls in ten minutes: discovery now counts only a 404 as "not a board" and pauses 2 s between Workable calls. The 124 rows the 429 wrote as `not_on_board` were deleted.
- 11–12 Nov, Lokal React Native Intern for Nitin (passes every rule).
  - Bugs fixed: date questions (MM/DD/YYYY, calendar closed), values read back, Submit only once Workable unlocks it (resume upload, 1.8 s for one page), the window in front.
  - The worker's Submit then reached Cloudflare's "Verify you are human" box. Three ticks by the owner each failed, so nothing was sent and the run was cancelled. **Blocked:** [BLOCKERS.md](../BLOCKERS.md). The adapter fills every form right; Submit cannot pass Turnstile from the agent's browser.
- Done 17 Nov: 7 of 7 Workable forms that reached Submit were sent by the worker in the stealthy Chrome (Turnstile silent; ARCHITECTURE 6.21); a no-submit fill of 11 forms took 221 of 221 fields.
  Changed: `adapters/workable.ts` (number questions as bare numbers, dropdowns picked from their list), `guess.ts` (salutations never guessed), `real-browser.ts` and `scripts/seleniumbase_cdp_launcher.py`, `browser.ts` (stealthy by default), `match.ts` (Workable in `APPLY_BOARDS`, `ENABLE_WORKABLE=0` to switch off).
  Checks: `scripts/_workable-fillcheck.ts`, `scripts/_dropdown-keys-check.ts`; record in `docs/STEALTHY-BROWSER.md`.

<a id="m13"></a>
### [x] M13 — Zoho Recruit apply
Do:
- Write `adapters/zohorecruit.ts` for the guest form ("I'm interested"), as a handoff board (`HANDOFF_BOARDS`): the image CAPTCHA is typed by a person, who presses Submit.
- Check that `fetchers/zohorecruit.ts` stores the posting's top-level id: on 7 Nov the first id found in the hidden JSON opened "no longer available".

Design: [3.1 Order](TDD.md#31-which-boards-and-in-what-order) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe).
**Done when:**
- Dry runs on 3 portals fill everything but the CAPTCHA.
- One real handoff submit.
- `APPLY_BOARDS`.

- Done 17 Nov: 30 India portals' forms read from public JSON (`/recruit/v2/public/Job_Openings/<id>/apply/<webform_id>`; every stored job id opened its form, so the fetcher's ids are right): 20 with a CAPTCHA, 6 with an assessment after the form. Dry runs (no submit, no upload) on Quicko, Posimind, FCI and Indus took 51 of 51 fields; Execo stopped at its assessment. Real submit: Quicko Full Stack Developer for Nitin, a person typed the CAPTCHA, Zoho answered 200.
  Changed: `adapters/zohorecruit.ts` (new: text, number, picklist, yes/no, skills and suggestion boxes; CAPTCHA forms handed to a person, others submitted by the worker; assessment, required tables and multi-selects stop the run), `pick.ts`, `adapter.ts`, `lib/queue.ts` (`HANDOFF_BOARDS`), `match.ts` (in `APPLY_BOARDS`, `ENABLE_ZOHO=0` to switch off). Checks: `scripts/_zoho-survey.ts`, `scripts/_zoho-fillcheck.ts`.
  Left for later: the assessment page (6 of 30 forms) and questions before the browser (`questions.ts`).

<a id="m13b"></a>
### [x] M13b — Zoho Recruit's CAPTCHA read by the worker, as Keka (owner, 21 Nov)
Do: `captcha/` (board-generic types and errors, `inspectZohoCaptcha`, capture and refresh in `detector.ts`, `readCaptcha` in `ai.ts`), `adapters/zohorecruit.ts submitZoho` (read, type, Submit; wrong CAPTCHA → `CaptchaRejectedError`; no reader → the person), ARCHITECTURE "Zoho Recruit's CAPTCHA".
Design: ARCHITECTURE Keka paragraph (the same rerun) and "Human handoff".
**Done when:**
- `scripts/zoho-captcha-test.ts` prints PASS.
- Live portals: the CAPTCHA row is found, captured and refreshed with nothing typed (`scripts/_zoho-captcha-probe.ts --read`).
- One real Zoho application whose CAPTCHA the worker read is confirmed by Zoho (a real job and profile, the owner's yes).

- Done 21 Nov: `zoho-captcha-test` PASS (19 checks); live probe, 4 CAPTCHA portals: one markup, capture and refresh on all 4, model reads right on about half by eye. Real submit: owner's profile, Quicko Full Stack Developer, the agent read "36gw62", Zoho answered 200 on the first read (no person, 32 s from start to sent). Zoho back in `APPLY_BOARDS` (owner); a first job (Arting Digital) was refused at the swipe by `min_match_score`. Second, Nitin's account (owner's ask): his feed shows Zoho cards, techcarrot AI Engineer (score 56), read "pbnw4p", Zoho 200 first read, 47 s. Dry run, 5 forms twice, never submitted: 81 of 81 fields filled each round, 10 of 10 typed, ~5 of 10 reads right by eye; both length misreads led to reads held to 6 characters.
  Changed: `captcha/*`, `adapters/zohorecruit.ts`, `jobs/pool.ts`, `lib/queue.ts` (comment), ARCHITECTURE; checks `scripts/zoho-captcha-test.ts`, `scripts/_zoho-captcha-probe.ts`, `scripts/_zoho-real-run.ts` (one run on this code beside the live worker).

<a id="m14"></a>
### [-] M14 — The long tail of public boards, as M1 earns them (parked by the owner, 17 Nov: few India jobs)
Do: for each of Jobvite, Rippling, Recruitee, BambooHR, JazzHR, Pinpoint, Gem, Teamtailor, Breezy, Personio and Polymer, but only those whose M1 numbers after M3 show at least 10 new India jobs a week:
- a fetcher, a board entry and seeds;
- an adapter by the recipe, a handoff board where a CAPTCHA is always shown.

Freshteam is dropped (being shut down).
Design: [3.1 Order](TDD.md#31-which-boards-and-in-what-order) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe).
**Done when:** each board taken in has passed its own dry runs and one real submit; the boards left out are named in the Done line with their weekly numbers.

Parked 17 Nov (owner: the boards add few jobs). Measured from one Common Crawl's companies (`scripts/_m14-slugs.ts`, `scripts/_m14-measure.ts`, the ingest India rule), new India jobs a week over all companies found: Recruitee ~1 (64 companies; 1 with India jobs), Breezy ~1 (61; 4), Personio 0 (984; 0), Pinpoint ~0 (54; 3, 67 open India jobs, mostly inDrive), Teamtailor ~6 (470; 2), JazzHR 0 (73; 0), Jobvite ~1 (168; 5), Gem ~2 (633; 3). Not measured: Rippling, BambooHR, Polymer (the crawl index failed or my slug reader missed their address shape; Rippling's addresses start with a locale, `/en-US/<company>`).
  Public lists that work: Breezy `/json`, Personio `/xml`, Teamtailor `/jobs.rss`, Rippling `api.rippling.com/platform/api/ats/v1/board/<slug>/jobs`, Gem `api.gem.com/job_board/v0/<slug>/job_posts/`, Recruitee `/api/offers/`, Pinpoint `/postings.json`; Jobvite and JazzHR are HTML only.

<a id="m21"></a>
### [~] M21 — Discovery and ingest on a GitHub Actions schedule (owner, 18 Nov)
Why: finding companies and reading their jobs should run on time whether or not a worker is up (the laptop sleeps, dies, or is off). Both move to scheduled GitHub Actions; the worker with a screen keeps only applying (stealthy Chrome) and the pre-scan.

Do:
- `.github/workflows/jobs.yml`, two jobs, each `on: schedule` plus `workflow_dispatch`, each with its own `concurrency` group so a run never overlaps the one before. Steps: checkout, Node 22, `npm ci` (cached), `npx prisma generate`, the script. Secrets, added by the owner in the repository settings, never in the file: `DATABASE_URL`, `DIRECT_URL`, `OPENAI_API_KEY`, and `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `APP_URL` for new-match pushes.
  - `discovery`: daily `30 1 * * *` (as `DEFAULT_DISCOVER_CRON`), `npx tsx scripts/discover-now.ts` (boards and count as dispatch inputs), `timeout-minutes: 120`.
  - `ingest`: every 3 hours (the active tier's interval, cadence.ts), `npx tsx scripts/ingest-tick-now.ts --limit 6000` (companies already due only), `timeout-minutes: 120`. Then the daily board measurement (`board-day`, `30 23 * * *`) as a third small job.
- `scripts/ingest-tick-now.ts`: after the reads, `warmFeeds()` as the worker's tick does (handlers/ingest-tick.ts), so feeds are warm and new-match pushes still go out; and the hourly delete of old closed jobs the tick does.
- `src/worker/schedule.ts`: `INGEST_MODE=off`, `DISCOVER_CRON=off` and `BOARD_DAY_CRON=off` stop the worker scheduling ingest, discovery and the board day (one switch each, read at start; `schedulePlan`). The laptop and Docker workers run with both off once the Actions runs have passed twice; the Docker worker then has nothing to do and is stopped.
- ARCHITECTURE §6.2 (discovery), §5b (ingest tick) and docs/DEPLOY.md: where each runs, the secrets, the two switches.

Facts and limits to keep in mind:
- Minutes: discovery up to about an hour a day (Greenhouse took 52 minutes on 2 Nov), ingest about 10–15 minutes a run (about 1,500 due companies every 3 hours at 8 at once). A month: ~1,800 + 8 × 30 × ~12 ≈ 4,700 minutes. A private repository's free plan has 2,000; the rest is billed (about $0.008 a minute on Linux, ≈ $20 a month), or free on a public repository. Measure the first runs and set the ingest interval from them.
- GitHub runs scheduled workflows late at busy times (often 10–30 minutes) and may skip one; every 3 hours with reads of only due companies tolerates that, but jobs are fresh to within hours, not 5 minutes as with the worker's tick.
- Runs come from GitHub's datacenter addresses: Workable's rate limit and Workday's Cloudflare treat them worse than a home connection. Workday reads are paused (18 Nov); Workable keeps its pace and auto-pause, and a refused read is not a failure (cadence.ts REFUSED).
- Scheduled workflows are switched off after 60 days without a commit on a public repository.
- The worker's per-board cap across workers (pg-boss `groupConcurrency`) does not reach the Actions run; `ingest-tick-now.ts` keeps its own cap (8 at once, 4 of one board), so a run beside a live worker stays under the boards' limits only once the worker's ingest is off.

Design: ARCHITECTURE §6.2 (discovery), §5b (ingest tick); no TDD (a workflow and three small changes).
**Done when:**
- `workflow_dispatch` runs of `discovery` (`--boards greenhouse`) and `ingest` finish green; their logs show companies checked and added, and companies read, new jobs and feeds warmed.
- Two days of scheduled runs finish green; the workers run with the three switches off, and the feed's newest India jobs are no older than the last ingest run.
- `schedule-plan-test` PASS (the switches, offline; `schedule-smoke` starts a real worker, which would take live applications); typecheck and lint pass.

<a id="m16"></a>
### [ ] M16 — Board health: success rate, alert, pause
Do:
- Compute per board a rolling 24-hour success rate, challenge rate and top error categories from `ApplicationEvent` (extending `modules/jobs/results.ts`).
- Add the `BoardSwitch` model and migration: a paused board's new swipes queue but do not run.
- Alert the owner by push and `NOTIFY_WEBHOOK_URL` when a board falls below half its 7-day mean over at least 10 runs, or one error category passes 30%, then pause it.
- Show the numbers in `feed-report` and on the governance page.
- Update ARCHITECTURE §6.15.

Design: [4.15 Fleet and board health](TDD.md#415-the-apply-fleet-and-board-health) · [4.17 Rollout gate](TDD.md#417-the-rollout-gate-per-board).
**Done when:**
- `board-health-test` PASS.
- A replay of 20 fixture failures on one board alerts and pauses it while the others keep running.
- The owner resumes it from the governance page.
- Typecheck and lint pass.

<a id="m17"></a>
### [ ] M17 — The feed at 200,000 jobs
Do:
- Add a partial HNSW index on `Job.embedding` (`halfvec_cosine_ops`) for open India-eligible rows.
- Make the feed's candidate query take the nearest 500 by index, then filter and rank as today.
- Extend `scripts/feed-sql-test.ts` with 200,000 synthetic rows, timing and recall.
- Run `ANALYZE` after imports.
- Update ARCHITECTURE §6.3.

Design: [4.16 The feed at volume](TDD.md#416-the-feed-at-volume).
**Done when:**
- `feed-sql-test` shows p95 under 300 ms at 200,000 rows for 3 profiles, and top-50 recall of at least 95% against the exact query.
- The live feed's timing before and after is in the Done line.
- Typecheck and lint pass.

<a id="m18"></a>
### [ ] M18 — Model cost: filter, cap, measure
Do:
- Embed only stored, open, non-duplicate jobs with a description of at least 200 characters.
- Cap judged jobs per user per day (`max_judged_per_user_per_day`, 150).
- Write a daily cost line in `BoardDay`'s report: embedding tokens, judgement tokens and dollars at list price.
- Check the prices against the OpenAI bill.
- Then (owner, 9 Nov), run a profile-cluster experiment that compares shared verdicts with per-user verdicts on a sample of 500.

Design: [4.14 Model cost at volume](TDD.md#414-model-cost-at-volume).
**Done when:**
- A week's cost per day and per active user is in the Done line.
- The cap holds in `judge-test`.
- The cluster experiment, if run, reports agreement with per-user verdicts.
- Typecheck and lint pass.

<a id="m19"></a>
### [ ] M19 — Apply fleet and per-IP pace
Do:
- Measure browser-minutes per application per board from events.
- Add `max_submits_per_ip_per_board_per_hour` to `config/rules.json` (30 to start, owner, 9 Nov), enforced with the existing `rateLimit` keyed by the container's egress address.
- Scale containers on apply-queue depth (DEPLOY.md).
- Write a load run of the mock board at 200 applications an hour across 4 containers.
- Update ARCHITECTURE §6.7 and §12.

Design: [4.15 Fleet and board health](TDD.md#415-the-apply-fleet-and-board-health).
**Done when:**
- Browser-minutes per board are measured.
- The per-IP limit holds in a test.
- The load run's throughput and memory are in the Done line.
- Typecheck and lint pass.

<a id="m20"></a>
### [-] M20 — The user's own live view for bot checks (parked: bot checks stay as Ashby and Keka do them, 9 Nov)
Do:
- When a check needs a person, stream the worker's window to the user's phone or browser (a CDP screencast, input sent back), from the application's "Needs you" card.
- The user solves their own check and presses Submit.
- Only that user, one window, closing after 15 minutes.
- `always`-check boards (and Keka, if the owner says so) move to it.
- Update ARCHITECTURE "Human handoff".

Design: [3.5 Bot checks](TDD.md#35-bot-checks-a-policy-per-board-owner-decision).
**Done when:**
- On the mock, a test profile solves a mock challenge from a phone-sized browser and the application ends `submitted`.
- One real Keka or Zoho handoff is done from the owner's phone.
- Typecheck and lint pass.

<a id="m15"></a>
### [ ] M15 — iCIMS (later)
Do: only if M1 and M4 find Indian employers on iCIMS worth it (960 India jobs on 7 Nov):
- a fetcher for Jibe-built sites' `/api/jobs`;
- an adapter on M5's flow, with an account per portal and a verification link.

The invisible hCaptcha on its email step makes it a handoff, and its site terms against robots go to the owner first.
Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-research-and-measurements-7-nov-2026) (account systems) · [4.4 State machine](TDD.md#44-employer-account-state-machine).
**Done when:** the owner has decided from M1's numbers; if built, as M8.
