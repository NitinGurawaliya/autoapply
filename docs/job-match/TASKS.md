# Phase M tasks — a job card and job page that explain the match

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) Phase M lists these tasks one line each and links here; this file holds the full entry per task. Mark `[~]` / `[x]` here first, then on the root line.

Order M1 (owner approves the mockups) → M2 → M3 and M4 → M5 → M6 → M7. M5 needs nothing from M2–M4 but shares `ingest.ts` and `match.ts`, so it runs after them.

<a id="m1"></a>
### [x] M1 — Card and job page mockups
Do: `design/job-card.html` (four sample cards: strong with pay, good without pay, stretch with a years cap, one with no skills found) and `design/job.html` (the job page), light and dark, 390 px, in the tokens of `src/app/globals.css`; `docs/DESIGN.md` Screens: the feed-card paragraph and the `/jobs/[id]` row point at them.
Design: [5 UI](TDD.md#5-ui) · [1 Goals and non-goals](TDD.md#1-goals-and-non-goals).
**Done when:** the owner approves both mockups (or their changes are made); the card's fixed height is settled and written in DESIGN.md.
Done 18 Nov: approved on the third round (ink and lime only → six hues → neutrals plus lime and rose, TDD 11 item 5); card height `clamp(440px, calc(100dvh - 330px), 490px)`. `design/job-card.html`, `design/job.html`, DESIGN.md Screens.

<a id="m2"></a>
### [x] M2 — Job skills from a fixed vocabulary
Do: `src/modules/jobs/skills.ts` (`TECH_VOCAB`, aliases, `jobSkills`, `candidateSkills`); `Job.skills` and the other 4.3 columns in one hand-written migration applied with `prisma migrate deploy`; `ingest.ts fields(job)` writes `skills`; `scripts/backfill-job-skills.ts`; `scripts/job-skills-test.ts`; Phase L's planned `tailor/vocab.ts` points here.
Design: [3 Options and decision](TDD.md#3-options-and-decision) · [4.1 Components](TDD.md#41-components) · [4.3 Data model](TDD.md#43-data-model-prisma-additions-one-hand-written-migration-applied-with-prisma-migrate-deploy-only) · [7 Testing](TDD.md#7-testing).
**Done when:** `job-skills-test` PASS; the backfill fills every open job; on 20 real jobs every term printed occurs in the description; typecheck and lint pass.
Done 18 Nov: 210-term vocabulary (`modules/jobs/skills.ts`), `job-skills-test` 33 checks PASS; backfill read 44,161 open jobs, 23,611 (53 %) name a skill, 5.3 terms each; hand check of 20 real jobs: every term at its matched spot, two fixes from it (HTML entities decoded, BDD no longer Cucumber). Migration `20261118090000_job_skills_salary` (all Phase M columns) via `migrate deploy`, row counts unchanged.

<a id="m3"></a>
### [x] M3 — Required or nice-to-have, labelled by the model
Do: `semantic.ts jobSkillLevels` (batched `callJson`, per-job enum schema, ≤ 3,000 description chars, no profile data); the ingest run labels new and changed jobs (`SKILL_LEVELS_PER_RUN`); backfill; `scripts/job-skills-report.ts`.
Design: [4.2 Queues](TDD.md#42-queues) · [4.5 Checks](TDD.md#45-checks) · [4.6 Security](TDD.md#46-security-and-privacy) · [4.7 Failures](TDD.md#47-failures).
**Done when:** the report on 20 real jobs shows `skillsRequired ⊆ skills` on all, labels reasonable on ≥ 18 of 20 by hand; cost per 1,000 jobs measured; typecheck and lint pass.
Done 18 Nov: 20-job hand check: labelled 20/20, required ⊆ skills 20/20, reasonable on 18 (PUMA marks "exposure to" Elasticsearch and three alternative clouds required); ~855 input tokens a job, ~$0.13 per 1,000. Backfill labelled 10,499 jobs (1 failed, 29 min): 10,173 of 10,185 open India jobs with skills; 359 of 372 real feed cards now split required from mentioned. `semantic.ts labelPendingSkills` in each ingest run, `scripts/job-skills-report.ts`.

<a id="m4"></a>
### [x] M4 — Score breakdown and the skills comparison on FeedJob
Do: `match.ts` scorers return `breakdown`; `FeedJob` gains `breakdown`, `skills {have, missing, split}`, `seniority`, `salary`; `feedRows` selects the new columns (no description); `candidateSkills` once per feed; `scripts/score-breakdown-test.ts`; ARCHITECTURE §6.3 records the breakdown and the skills rule.
Design: [4.3 Data model](TDD.md#43-data-model-prisma-additions-one-hand-written-migration-applied-with-prisma-migrate-deploy-only) · [4.4 Sequence](TDD.md#44-sequence-a-job-from-ingest-to-card).
**Done when:** `score-breakdown-test` PASS (the invariant on the match-test cases and 200 real feed jobs); `feed-sql-test` PASS unchanged; no missing term is on the resume for the owner's profile; typecheck and lint pass.
Done 18 Nov: `score-breakdown-test` PASS (8 fixtures; 372 cards on 11 real profiles add up, 0 missing skills the candidate shows); `feed-sql-test` PASS, same cards, order, scores and reasons on all 10 profiles. `match.ts` breakdown, `jobSkillsFor`, `FeedJob` fields; ARCHITECTURE 4, 6.3.

<a id="m5"></a>
### [x] M5 — Pay from the board
Do: verify each board's pay field on a live fetch (Greenhouse pay ranges, Ashby compensation, Lever `salaryRange`); `src/modules/jobs/salary.ts` (`salaryOf`, `formatSalary`); fetchers request pay where it is opt-in; `ingest.ts fields(job)` writes the salary columns; backfill from `Job.raw`; `scripts/salary-test.ts`; ARCHITECTURE §6.2.
Design: [3 Options and decision](TDD.md#3-options-and-decision) · [4.3 Data model](TDD.md#43-data-model-prisma-additions-one-hand-written-migration-applied-with-prisma-migrate-deploy-only).
**Done when:** `salary-test` PASS; count of open jobs with pay printed per board; no pay from description text; typecheck and lint pass.
Done 18 Nov: `salary-test` 15 checks PASS. Ashby with includeCompensation (Salary component) and Lever salaryRange; Greenhouse public API empty on all 8 boards sampled, so none. Backfill over the 300 Ashby/Lever companies with India jobs: 901 Lever and 22 Ashby open jobs with pay (81 India-eligible). ARCHITECTURE 6.2.

<a id="m6"></a>
### [x] M6 — The card
Do: `job-card.tsx`, `marks.tsx MatchBadge` (the number and tier word), `swipe-deck.tsx cardData`, to `design/job-card.html`; DESIGN.md.
Design: [5 UI](TDD.md#5-ui).
**Done when:** `/feed` at 390 px light and dark matches the mockup for a job with pay and labels and one with neither; ← → and buttons still swipe; typecheck and lint pass.
Done 18 Nov: owner checked the real `/feed` in their browser and approved it; `/dev/ui` at 375 px dark: 350 px card, no overflow. `job-card.tsx`, `marks.tsx TierPill`, `swipe-stage.tsx` labelled Skip/Apply, `lib/job-facts.ts`, `swipe-deck.tsx`.

<a id="m7"></a>
### [x] M7 — The job page
Do: `jobs/[id]/page.tsx` sections Why this is a match, Skills, About the role, How we got to N, to `design/job.html`.
Design: [5 UI](TDD.md#5-ui) · [4.3 Data model](TDD.md#43-data-model-prisma-additions-one-hand-written-migration-applied-with-prisma-migrate-deploy-only).
**Done when:** `/jobs/[id]` at 390 px light and dark matches the mockup; the breakdown rows add up to the score shown; a job with no skills found leaves the Skills section out; typecheck and lint pass.
Done 18 Nov: owner checked the real job page in their browser and approved it; breakdown adds up on 372 real cards (`score-breakdown-test`); sections render-checked on real feed jobs. `jobs/[id]/page.tsx`, `jobs/[id]/match-sections.tsx`.
