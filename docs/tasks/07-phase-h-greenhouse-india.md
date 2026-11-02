# Phase H — Greenhouse India jobs: many companies, fresh daily, eligibility-first matching

Full entries of this phase. The index is [docs/TASKS.md](../TASKS.md). Status is marked here first, then on the index line.


Greenhouse only (other boards later: the "SwipeApply mid-term plan" doc). Decisions 10 Oct: Claude compiles 300–500 companies hiring in India and a script validates them, the owner approves; only jobs in India or remote and open to India are shown (a bare "Remote" needs an India signal; jobs abroad are never shown); companies tagged Startup / Mid-size / MNC; matches shown as Strong / Good / Stretch with the reason, not a %. **Generic for every field** (owner, 10 Oct): any job seeker (tech, HR, finance, marketing, sales, operations...) uploads a resume and is matched; every job is stored and classified by job function; closed jobs are deleted 30 days after closing unless swiped or applied to. Later only new job boards remain. Plan: `ok-so-include-these-joyful-leaf.md`.

<a id="t77"></a>
### [x] T77 — Eligibility tag on every job
Do: the fetcher keeps `offices` and decodes Greenhouse's HTML-escaped `content`; `tagging.ts eligibility()` → `india` · `remote_india` · `abroad` · `unknown`; migration `Job.eligibility` (indexed) and `Job.firstSeenAt`; backfill stored jobs.
**Done when:** `scripts/eligibility-test.ts` (30+ real samples) PASS and the backfill prints counts per eligibility.
Done 10 Oct: `eligibility-test` PASS (57 checks from real boards, including the misses the first rules made: "CRI - Remote", "Remote, AMER", "Remote - CA", "São Paulo"). Backfill: offices fetched from each Greenhouse board; 3,561 jobs re-tagged and their descriptions un-escaped (Greenhouse markup had been stored as text). Open Greenhouse jobs: 317 india, 18 remote_india, 2,307 abroad, 2 unknown; spot check of 30 per bucket: one miss (UAE, fixed). `feed-sql-test`, `match-test`, `ingest-contract-test`, `results-test`, `guards-test` PASS.

<a id="t78"></a>
### [x] T78 — Company list: compile, validate, approve
Do: the list moves to `prisma/companies.ts` with `stage`; `Company.stage`; `scripts/discover-greenhouse.ts` checks candidates on the public API (open jobs, India-eligible jobs, suggested stage) into a CSV the owner approves; seed the approved list.
**Done when:** the discovery report exists and the approved list is seeded, with totals of companies and India-eligible open jobs.
Progress 10 Oct: batch 1 (508 candidates): 113 on Greenhouse, 65 with India-eligible jobs, 1,380 such jobs open (only 335 were stored, because ingest keeps the last 7 days of postings: T79). The owner kept all 65; `prisma/companies.ts` + `Company.stage` seeded: 66 Greenhouse companies (45 MNC, 19 mid-size, 2 startup). Batch 2 (323 more): 79 on Greenhouse, 32 with India-eligible jobs (273 open); the owner kept all 32. Done 10 Oct: 98 Greenhouse companies active (57 MNC, 36 mid-size, 5 startup) with about 1,650 India-eligible open jobs between them.

<a id="t79"></a>
### [x] T79 — Fast, safe ingest at hundreds of companies
Do: per company one transaction (create new, update changed, close the rest); 4 companies at a time with pauses, timeout and one retry; `lastError` on failures; a singleton run guard; every 3 hours.
**Done when:** a full ingest of the approved list finishes well inside its limit (measured), `ingest-contract-test` passes, and a second run only touches changed rows.
Done 10 Oct: first full run of 116 companies 349 s (limit 2 h), 0 failed, 4,792 new jobs (549 India-eligible), jobs 3,561 → 8,353; second run 83 s with 0 created, 0 updated; `ingest-contract-test` PASS. Every 3 hours, 60-day window; open India-eligible Greenhouse jobs: 840 (763 in India, 77 remote).

<a id="t80"></a>
### [x] T80 — Feed shows India-eligible jobs first, with company type and a fresher level
Do: feed and swipe check use the same eligibility rule (`not_eligible`); location chips In India / Remote; Company type chips; stage tag on the card.
**Done when:** `feed-sql-test`, `feed-smoke`, `navigation-cache-smoke` (build) pass and no real profile's feed holds an abroad job.
Done 10 Oct, changed by the owner: jobs abroad stay available when the user picks US / Other countries (no `not_eligible` swipe rule); their location questions are answered from the profile and standing answers (ARCHITECTURE 6.19 "Jobs abroad", `abroad-test` PASS). Default feed: In India + Remote (open to India); new Level chip "Fresher (0-1 yr)"; Company type chips; type tag on the card; daily cap back to 120 for testing. `feed-sql-test` PASS on all 6 real profiles.

Decision 10 Oct (owner): **tech first.** Matching must be right for every kind of tech candidate (ML, data science, security, DevOps...) before other fields. The taxonomy and scorer are built so that other fields are only new entries later (T85).

<a id="t81"></a>
### [x] T81 — Tech tracks for every job and every user
Do: `modules/jobs/functions.ts`, one taxonomy built to grow: function `engineering` / `data_ai` / `non_tech` now, with tech tracks: frontend, backend, full-stack, mobile, DevOps/SRE/cloud/platform, data engineering, data science & analytics, ML/AI (incl. LLM/applied AI, research), security, QA/test automation, embedded/firmware/hardware, solutions/support engineering, engineering management; plus seniority (intern, entry, mid, senior, staff/lead, manager+). Each track has its own skill vocabulary (e.g. ML: PyTorch, TensorFlow, MLOps, NLP, CV; security: SIEM, SOC, pentest, IAM; data science: SQL, statistics, A/B testing). Jobs classified at ingest by title rules, the LLM (cached per distinct title) only for the rest, stored as `Job.function`, `Job.track`, `Job.seniority`; non-tech jobs are stored and tagged `non_tech` (not shown to tech users). The resume parse returns the candidate's tracks (primary + secondary), seniority and skills; the user confirms them.
**Done when:** `scripts/functions-test.ts` classifies 150+ real Greenhouse tech titles across all tracks correctly (sampled, reviewed with the owner), the backfill reports counts per track, and 6 tech resumes (frontend, backend, ML, data science, security, DevOps) parse into the right tracks and skills.
Done 10 Oct: `functions-test` PASS (212 checks: real titles across all 14 tracks and non-tech, levels, 8 kinds of profile); backfill: 8,353 jobs; open India-eligible: 501 tech (software 170, solutions 66, ML/AI 46, DevOps 42, eng. management 36, security 31, data science 30, QA 21, backend 18, full-stack 14, data engineering 11, frontend 8, embedded 5, mobile 3), 489 non-tech. Owner, 10 Oct: no rules per role for matching, so tracks became labels and the matching is by meaning (T82).

<a id="t82"></a>
### [x] T82 — Scoring v2 for tech: gates, fit, tiers
Do: gates (eligibility; the job's track is one of the user's tracks or an adjacent one, e.g. backend↔full-stack, data science↔ML; experience gap of 3+ years = out), then fit from the user's skills found in the job (weighted in the requirements part, the track's own vocabulary and synonyms instead of the engineering-only aliases), title similarity within the track, seniority fit and freshness; Strong / Good / Stretch with the reason ("PyTorch and NLP match; asks 2-4 years, you have 3"); the minimum match becomes a minimum tier; the swipe check uses the same code.
**Done when:** `match-test` tier cases per track pass (a data scientist is not shown frontend roles, a security engineer sees SOC/AppSec roles, an ML engineer sees applied-AI roles as strong, a senior staff role for a 1-yr developer is out), `feed-sql-test` agreement holds, and the top 20 for each real profile plus ML, data-science and security test profiles are reviewed with the owner.
Done 10 Oct, by meaning (owner's choice: embeddings + fact rules): jobs and resumes embedded (8,013 open jobs, 157 s), the 150 closest judged by the model against the resume and cached; tiers on the card. `match-test` (tier cases), `feed-sql-test`, `guards`, `results`, `ingest-contract`, `swipe-batch` PASS. Top 20 per real profile: `npx tsx scripts/feed-report.ts --titles` (for the owner's review).

<a id="t83"></a>
### [x] T83 — Onboarding and feed by track
Do: onboarding shows the suggested tracks and level ("You look like: ML/AI · entry"), editable; Track chips in the feed with Company type and location; a dry run on an ML and a security Greenhouse form.
**Done when:** ML, data-science and security test profiles go through onboarding, see only their tracks' India-eligible jobs with tiers, and one dry run per track passes (not submitted).
Progress 10 Oct: "Your fields" on the confirm screen (suggested from the resume, editable, saved as `Profile.tracks`); "Your fields" filter chips in the feed. Answering chain checked read-only on ML, security and abroad Greenhouse forms (questions from the public API, nothing typed): handles them like software forms. Left: one live dry run per track (`ats-smoke`, types into the live form, not submitted) waits for the owner's OK.
Done 11 Oct: live dry runs (owner's OK, Bangalore profile, not submitted) on StockX ML, Zenoti security and Thoughtworks London forms: PASS after two fixes (profile beats a stale saved city; location search retries simpler words). The country questions moved into onboarding (`onboarding-smoke` PASS).

<a id="t84"></a>
### [~] T84 — Daily freshness numbers
Do: per-run counts (new jobs, new India-eligible jobs, failing companies); `scripts/feed-report.ts` new Strong/Good matches per profile in 24 h.
**Done when:** the report runs after a scheduled ingest and shows several new matches per profile per day.
Progress 10 Oct: `scripts/feed-report.ts` (ingest runs, failing companies, India-eligible jobs first seen in 24 h, and per profile: feed by tier, fresher count, new strong/good in 24 h). First run: 553 India-eligible jobs new in 24 h (first full pull); the 6-yr profile has 10 strong + 7 good, the fresher profiles 2–9 cards and 0–2 new strong/good (they have swiped most of the rest). Not met for freshers: 12 open fresher tech jobs in India on Greenhouse. Next: more companies hiring freshers (Indian startups, often on Lever / Ashby, back to T78).
Update 11 Oct: discovery batch 3 (87 Indian startups, unicorns, campus-hiring companies): only 5 have Greenhouse boards, 2 hire in India (IMC Trading, Tower Research Capital, added: 30 India jobs, 1 fresher). Fresher supply on Greenhouse cannot grow much; it waits on the Lever and Ashby adapters. Added: Early career (0-2 yrs) level, feeds warmed after each ingest, wider shortlist when the deck is short.

<a id="t85"></a>
### [ ] T85 — Other fields (HR, finance, marketing, sales, operations...) — after T81–T83 are right for tech
Do: add each field's functions and skill vocabulary to the same taxonomy; resume parse and onboarding for them; test profiles and dry runs per field.
**Done when:** HR and finance test profiles see only their field's India-eligible jobs with tiers, and one dry run per field passes (not submitted).
