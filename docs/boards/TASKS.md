# Phase M tasks: more boards, employer accounts and discovery at scale

This is the task file for [TDD.md](TDD.md). The root [docs/TASKS.md](../TASKS.md) Phase M section lists these tasks one line each and links here. This file holds the full entry for each task: Do, the design sections it builds, Done when, and the `Done <date>:` line once it lands. Mark `[~]` / `[x]` here first, then on the root line.

The order is the TDD's ranking ([3.4](TDD.md#34-the-ranking-open-india-jobs-per-task-session)), set so the most India jobs arrive soonest:
1. M1 and M2, the measure and the scale.
2. M3, every known company on boards we already apply on.
3. M5 and M6 (Workday), M7 (SmartRecruiters), M8 (SuccessFactors), M10 (Darwinbox).
4. M4, beside them from M3 on.
5. M9 and M11 (Oracle), M12 (Workable), M13 (Zoho Recruit), M14 and M15 (the long tail).

After M3, two weeks of M1's daily numbers confirm or reorder 5 onward. Each task is one session, plan first, with the Done-when check run and its output pasted, then typecheck and lint. Tasks that make a decision update ARCHITECTURE in the same change.

The owner's open questions are in [TDD §11](TDD.md#11-open-questions-for-the-owner); each entry below names the question it waits on. Naukri and the other signed-in Indian portals (foundit, hirist, iimjobs, Instahyre) come after this phase (owner, 7 Nov).

<a id="m1"></a>
### [ ] M1 — Board measurement, daily
Do:
- Add the `BoardDay` model and its migration (`migrate deploy`).
- Write `scripts/board-day.ts`. It writes one row per board for the day: companies by tier, open India jobs, India tech, India entry-level, new India jobs first seen that day, right swipes and submitted. Before M2 lands, every company counts as `active`.
- Add a worker cron at 23:30 UTC.
- Extend `scripts/feed-report.ts --from --to` to print the rows as a table, with new India jobs per day and per company.
- This takes over T97's report half. T97's docs half (ARCHITECTURE §5) stays with T97.

Design: [3.4 Ranking](TDD.md#34-the-ranking-open-india-jobs-per-task-session) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) (`BoardDay`) · [4.11 Observability](TDD.md#411-observability).
**Done when:** `board-day-test` PASS; the cron wrote rows on two consecutive days for every board; `feed-report --from <day1> --to <day2>` prints them; typecheck and lint pass.

<a id="m2"></a>
### [ ] M2 — Watch every company cheaply: tiers, India-only storage, per-company ingest
Do:
- Add the `Company` tier fields (`tier`, `nextFetchAt`, `indiaOpen`, `lastIndiaAt`, `listHash`) and their migration.
- Write `cadence.ts` with the tiers `active` / `open` / `empty` / `dead`, back-off and jitter.
- Write `ingestCompany(id)` in `ingest.ts`, with the list → detail split and the `listHash` short-circuit, starting with Greenhouse, Lever, Ashby, Keka and Workday.
- Add the `ingest-tick` and `ingest-company` queues with the per-host cap, behind `INGEST_MODE`.
- Make `stores` India-eligible by default. Keep abroad jobs only as the owner answers Q1.
- Delete closed rows after 7 days.
- Update ARCHITECTURE §6.2 and §11.

Design: [4.2 Queues](TDD.md#42-queues-pg-boss) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) · [4.8 Ingest at 50,000 companies](TDD.md#48-ingest-at-50000-companies-load-and-postgres-size) · [4.10 Failure handling](TDD.md#410-failure-handling) · [8 Rollout](TDD.md#8-rollout) step 2. Waits on: Q1.
**Done when:**
- `cadence-test` and `ingest-contract-test` PASS.
- `ingest-scale-smoke` passes on 20,000 synthetic companies: the oldest overdue company is under 1 hour, the per-host cap is never exceeded, and the run prints requests a day.
- One day on `INGEST_MODE=tick` matches the old run's open India job counts per board within 2%.
- `Job` size is recorded before and after.
- Typecheck and lint pass.

<a id="m3"></a>
### [ ] M3 — Seed every known company on the boards we apply on
Do:
- Extend `boardSeeds.ts` / `scripts/discover-boards.ts --import` from Greenhouse, Lever and Ashby to every board in `boards.ts`, keeping Keka, Workday and Zoho slugs as hosts.
- Import the open lists the owner allows (Q5): ats-scrapers `ats-companies/`, upstreamit's live slugs, openroles and jobseek, and Hugging Face `latmay`, credited. Record each list's commit or checksum and its licence in `slugSources/lists.ts`.
- Verify each slug on the board's own API and watch every one that is a board, whether or not it lists an India job today. Its tier comes from what it lists.
- Board order: Greenhouse, Ashby, Keka, Lever (watched now, applied to once T94 lands), then Workday for ingest (applied to after M6).
- Each import is a dry run first, with counts only.

Design: [3.3 Discovery at scale](TDD.md#33-discovery-at-scale) · [4.7 Sequence: discovery](TDD.md#47-sequence-discovery-at-scale) steps 2–3 · [2 Facts](TDD.md#2-facts-the-design-rests-on-research-and-measurements-7-nov-2026) 8, 10, 16. Waits on: Q5, Q7.
**Done when:**
- Per board, the report shows slugs listed per source, checked, on the board, watched by tier, and open India jobs before and after.
- Open India-eligible jobs on Greenhouse, Ashby, Keka and Lever rise by at least 3,000 over the 7 Nov count (11,341 across all boards).
- Every slug that came from a CC BY-NC source is refused by the test.
- Typecheck and lint pass.

<a id="m4"></a>
### [ ] M4 — Continuous discovery and re-validation (supersedes T98)
Do: build the `slugSources/` layer and the `discover-source` and `discover-verify` queues. Sources:
- the Common Crawl columnar index through DuckDB: each new crawl once, all boards in one pass, `job-boards.greenhouse.io` and the EU hosts included;
- a one-off Wayback backfill for Lever and Ashby;
- a monthly re-read of the lists;
- links harvested from ingested `applyUrl`s and descriptions (ATS hosts, and Phenom apply links to their Workday or SuccessFactors tenant);
- the India probe (T93) over DPIIT and YC company websites if Q10 allows.

Re-validation runs on `nextCheckAt`. Remove model-proposed names and the CDX loop from `discovery.ts`. Update ARCHITECTURE §6.2.
Design: [3.3 Discovery at scale](TDD.md#33-discovery-at-scale) · [4.7 Sequence: discovery](TDD.md#47-sequence-discovery-at-scale) · [4.12 Code map](TDD.md#412-code-map). Waits on: Q10 for DPIIT only.
**Done when:**
- `board-seeds-test` PASS for every board's crawl and list parsing.
- One crawl's pass lists slugs for every board in under 10 minutes.
- After a week, the report shows new companies per source and the `listed` backlog at zero.
- Typecheck and lint pass.

<a id="m5"></a>
### [ ] M5 — Employer accounts: vault, permission, the email step by the user
Do:
- Add the `EmployerAccount` model and its migration.
- Write `lib/secrets.ts` (AES-256-GCM, `ACCOUNT_SECRET_KEY`, key versions) and `modules/accounts` (the only code that reads `secret`).
- Add the `create_employer_accounts` standing permission and its sheet.
- Build the account flow's shared steps in `modules/apply/account/flow.ts`: create, sign in, `needs_verification` (the run ends, "Done" re-enqueues it), `exists_elsewhere` (to `apply-person`), and codes through `codeRequester`.
- Add Account → Employer accounts (list, reveal with audit and rate limit, forget), the `/api/accounts/employers` routes and `/api/applications/[id]/verified`.
- Build `/mock/workday`.
- Add `max_accounts_created_*` to `config/rules.json`.
- Write ARCHITECTURE §6.21 and §11. Add the CLAUDE.md hard rule in §4.9 and widen the mock rule as Q6 says.

Design: [3.2 Employer accounts](TDD.md#32-boards-that-need-an-employer-account) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) · [4.4 State machine](TDD.md#44-employer-account-state-machine) · [4.9 Security](TDD.md#49-security-and-privacy) · [5 UI](TDD.md#5-ui) · [6 API](TDD.md#6-api). Waits on: Q2, Q6.
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
Design: [4.6 Sequence: Workday](TDD.md#46-sequence-workday-apply-with-an-employer-account) · [3.1 Bot checks](TDD.md#31-which-boards-and-in-what-order) · [4.10 Failure handling](TDD.md#410-failure-handling). Waits on: Q2, Q4.
**Done when:**
- `workday-test` PASS.
- Dry runs on 3 tenants with India jobs (e.g. Genpact, Citi, Hitachi) fill every page and stop before Submit.
- One real submit for the owner ends `submitted` with Workday's confirmation screenshot and a source on every value.
- The account appears in the owner's Employer accounts.
- Typecheck and lint pass.

<a id="m7"></a>
### [ ] M7 — SmartRecruiters (T95, moved here)
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

<a id="m8"></a>
### [ ] M8 — SuccessFactors
Do:
- First read ats-scrapers' SuccessFactors scraper (MIT, Python) for fetch logic to port, credited.
- `fetchers/successfactors.ts` from each career site's `sitemap.xml` and RSS (`keywords=(india)`), with the company id and data centre read from the page and slugs from M3's lists.
- Build `adapters/successfactors.ts` on M5's flow: an account per company, with the email step as code, link or none per company.
- Follow the wizard of the RMK apply pages.

Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-research-and-measurements-7-nov-2026) (account systems) · [4.4 State machine](TDD.md#44-employer-account-state-machine) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe). Waits on: Q2.
**Done when:**
- Ingest stores India jobs from EY GDS, Wipro and Mahindra.
- Dry runs on 3 companies stop before Submit.
- One real submit for the owner.
- `APPLY_BOARDS` behind `ENABLE_ACCOUNT_BOARDS`.

<a id="m9"></a>
### [ ] M9 — The email step, automatic
Do: the option the owner picks in Q3.
- Option 2 (a private relay address per user): the account email becomes the relay.
- Option 3 (a Gmail forwarding filter to our inbound address): the user's own email stays on the application.

Either way, add an inbound mail service (provider chosen with the owner) whose webhook keeps only the code or link for 15 minutes, keyed to the waiting application, and forwards or drops everything else. Then `codeRequester` and `needs_verification` read from it before asking the user. ARCHITECTURE §6.21 is updated.
Design: [3.2 Email step](TDD.md#32-boards-that-need-an-employer-account) · [4.9 Security](TDD.md#49-security-and-privacy). Waits on: Q3.
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

Design: [3.1 Order](TDD.md#31-which-boards-and-in-what-order) · [4.4 State machine](TDD.md#44-employer-account-state-machine) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe). Waits on: Q2, Q9.
**Done when:**
- Ingest stores Porter's, MakeMyTrip's and Airtel's India jobs.
- Dry runs on 3 employers stop before Submit.
- One real submit for the owner.
- `APPLY_BOARDS` behind `ENABLE_ACCOUNT_BOARDS`.

<a id="m11"></a>
### [ ] M11 — Oracle Recruiting
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
### [ ] M12 — Workable
Do:
- Write `fetchers/workable.ts` on `apply.workable.com/api/v1/widget/accounts/{slug}?details=true`.
- Add a slug source from Workable's search API (`jobs.workable.com/api/v1/jobs?location=India`): company website → careers link → slug.
- Build `adapters/workable.ts` for the one-page form, which has Turnstile: a visible window, and a challenge hands it over.

Design: [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe) · [3.3 Discovery](TDD.md#33-discovery-at-scale) option D.
**Done when:**
- Ingest stores India jobs of Apna, Lokal and Zifo.
- Dry runs on 3 forms pass.
- One real submit, then `APPLY_BOARDS`.

<a id="m13"></a>
### [ ] M13 — Zoho Recruit apply
Do:
- Write `adapters/zohorecruit.ts` for the guest form ("I'm interested"), as a handoff board (`HANDOFF_BOARDS`): the image CAPTCHA is typed by a person, who presses Submit.
- Check that `fetchers/zohorecruit.ts` stores the posting's top-level id: on 7 Nov the first id found in the hidden JSON opened "no longer available".

Design: [3.1 Order](TDD.md#31-which-boards-and-in-what-order) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe).
**Done when:**
- Dry runs on 3 portals fill everything but the CAPTCHA.
- One real handoff submit.
- `APPLY_BOARDS`.

<a id="m14"></a>
### [ ] M14 — The long tail of public boards, as M1 earns them
Do: for each of Jobvite, Rippling, Recruitee, BambooHR, JazzHR, Pinpoint, Gem, Teamtailor, Breezy, Personio and Polymer, but only those whose M1 numbers after M3 show at least 10 new India jobs a week:
- a fetcher, a board entry and seeds;
- an adapter by the recipe, a handoff board where a CAPTCHA is always shown.

Freshteam is dropped (being shut down).
Design: [3.1 Order](TDD.md#31-which-boards-and-in-what-order) · [4.5 Recipe](TDD.md#45-sequence-adding-a-board-with-a-public-form-the-recipe).
**Done when:** each board taken in has passed its own dry runs and one real submit; the boards left out are named in the Done line with their weekly numbers.

<a id="m15"></a>
### [ ] M15 — iCIMS (later)
Do: only if M1 and M4 find Indian employers on iCIMS worth it (960 India jobs on 7 Nov):
- a fetcher for Jibe-built sites' `/api/jobs`;
- an adapter on M5's flow, with an account per portal and a verification link.

The invisible hCaptcha on its email step makes it a handoff, and its site terms against robots go to the owner first.
Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-research-and-measurements-7-nov-2026) (account systems) · [4.4 State machine](TDD.md#44-employer-account-state-machine).
**Done when:** the owner has decided from M1's numbers; if built, as M8.
