# Phase P tasks — relevance

The task file for [TDD.md](TDD.md) (v4). Root [docs/TASKS.md](../TASKS.md) Phase P lists these one line each, in build order. Mark `[~]` / `[x]` here first, then on the root line. Every switch (`READING_GATE`, `RELEVANCE_FIT`, `DAILY_SET`) turns on only after its [7.1](TDD.md#71-evaluation-p2-the-gate-for-p3-p6-p7) gate passes, and on every process at once ([4.9](TDD.md#49-env)). Every migration: `prisma migrate status` against the DB first, then `prisma migrate deploy` only.

<a id="p1"></a>
### [ ] P1 — One after-ingest tail, job reading, gate functions, LLM resilience
Do: `modules/jobs/after-ingest.ts` (embed → skills labels → reading → warm → hourly cleanup) called by `worker/handlers/ingest-tick.ts`, `scripts/ingest-tick-now.ts` and `ingestJobs`; `modules/jobs/reading.ts` (schema, prompt, batches of 10, evidence and requirement lines verified, kind and flags dropped without evidence, daily budget counted from `readAt`, 3 attempts then 24 h); migration: the `Job` reading columns and the `job_reading_stale` trigger; `modules/jobs/gate.ts` pure `trackOf` and `jobGate` (not yet used by the feed); `lib/llm.ts` timeout, Retry-After backoff, `LLM_MAX_CONCURRENT`; `scripts/reading-test.ts`, `reading-report.ts --sample N`, `backfill-job-reading.ts` (resumable), `gate-test.ts` (pure part); ARCHITECTURE 4, 6.2, 11.
Design: [4.1 items 1–4](TDD.md#41-components) · [4.5](TDD.md#45-checks-code-never-only-prompts).
**Done when:** `reading-test` and `gate-test` PASS; `reading-report --sample 20` hand-checked ≥ 18 right; cost per 1,000 measured (input and output); every open India-eligible job on `APPLY_BOARDS` read (count printed); a worker tick and a workflow-style run (`npx tsx scripts/ingest-tick-now.ts --limit 5`) each log `after-ingest … labelled=N read=N budget_left=N`; no feed code reads the reading columns (grep) and `feed-sql-test` PASS; typecheck and lint pass.

<a id="p2"></a>
### [ ] P2 — Evaluation harness and round-1 labels
Do: migration: `EvalPool`, `FeedLabel`, `EvalJudgement`; `deleteOldClosedJobs` keeps labelled and pooled jobs; `scripts/label-candidates.ts` (per real profile with ≥ 20 swipes: the pool stored in `EvalPool`; candidates from the old matcher, the reading gate and the "title OR reading" gate (top 20 each) plus 10 random; `--label` terminal prompt with the posting's opening text and the profile brief, shuffled, source hidden); the backfill reads pooled closed jobs; `scripts/relevance-eval.ts` (rankings within the stored pool; old-path verdicts via `judgeBatch` into `EvalJudgement`; precision@10, @20, labelled share, cards kept, gained and lost, top 10 printed; the owner's account apart); the `ml_ai` mislabel count on the feed's own pool; ARCHITECTURE 4.
Design: [7.1](TDD.md#71-evaluation-p2-the-gate-for-p3-p6-p7).
**Done when:** the owner has answered 7.1's question on real briefs and named the demo profile; round 1 is labelled (labelled share of every top 10 ≥ 80 %); the eval prints the old matcher and both gate rules per profile, and the chosen rule is recorded; a run writes no `JobJudgement` or `FitJudgement` row (counts before and after); the numbers are in this entry's Done line.

<a id="p3"></a>
### [ ] P3 — One gate in the feed, the score and the swipe check
Do: the SQL mirror of `jobGate` in `feedRows` behind `READING_GATE` (returns `roleFamily`, `kind`, `flags`, `readingCurrent`); `scoreFeatures` uses `jobGate` and passes `trackOf(job)` to `trackFit`; `apply/lifecycle.ts candidateScore` uses `jobGate` built from the profile; `trackOf` for the card label and the reason; `feed-audit.ts`, `feed-sql-test.ts` reference path, `match-test.ts` updated; `gate-test.ts` mirror part; ARCHITECTURE 6.3.
Design: [4.1 item 4](TDD.md#41-components).
**Done when:** `gate-test` PASS (JS and SQL agree on 500 real jobs); the P3 gate in 7.1 passes (no profile loses a relevant card from its top 10; ≥ 80 % of labelled removed cards irrelevant; cards kept ≥ 20 where they were); `match-test`, `score-breakdown-test`, `feed-sql-test` PASS; the switch is on everywhere; typecheck and lint pass.

<a id="p4"></a>
### [ ] P4 — Fields and avoids on the confirm screen
Do: migration: `Profile.showNearby`, `Profile.avoid`; `confirm-form.tsx` "Also show nearby fields" and "Never show me" (Contract roles · Internships · Commission only), ui-craft; `PUT /api/profile` accepts them and queues prescan as today; `feedTracks` adds adjacent tracks when `showNearby`; `jobGate` applies `avoid`; nothing stored as an `Answer`; DESIGN.md row; ARCHITECTURE 4, 6.3.
Design: [4.1 item 5](TDD.md#41-components) · [5](TDD.md#5-ui-direction-b-ui-craft-skill).
**Done when:** a test user sets both; they persist and change the feed (nearby on shows an adjacent track's job; each chip removes its kind or flag); no `Answer` row is written (count); resume → feed stays under 3 minutes; `ui-lint --check` PASS; typecheck and lint pass.

<a id="p5"></a>
### [ ] P5 — The candidate brief
Do: migration: `CandidateBrief`; `modules/profile/brief.ts` (tracks, nearby, years, title, top skills; `fitHash = md5(FIT_VERSION + exact JSON)`; `learned` beside it); built in prescan and warm; `GET /api/brief`; "What I know about you" on `/account`; `scripts/brief-test.ts`; ARCHITECTURE 4.
Design: [4.1 item 6](TDD.md#41-components).
**Done when:** `brief-test` PASS (no contact data; `fitHash` changes with `FIT_VERSION` and the JSON, not with learned lines); the brief shows on `/account`; a rebuild leaves `Profile.updatedAt` unchanged (read before and after); typecheck and lint pass.

<a id="p6"></a>
### [ ] P6 — Fit with evidence, in its own table
Do: migration: `FitJudgement`; `JobJudgement` orphans deleted and FKs added; `modules/jobs/fit.ts` (reading + skills comparison per job; batches of 10; evidence = a requirement line number; `jobHash = md5(exact per-job JSON)`; no fit without a current reading; `levelFit` on top; advisory lock per user; cold shortlist 150); `match.ts`, `warm.ts`, prescan and `lifecycle.ts` read `FitJudgement` when `RELEVANCE_FIT=1`, the old path unchanged when `=0`; the quote on the job page; dry-run mode for the eval; `scripts/fit-test.ts`; `match-test.ts`, `judge-test.ts`, `feed-sql-test.ts` cover both paths; round-2 labels; ARCHITECTURE 4, 6.3.
Design: [4.1 item 7](TDD.md#41-components) · [7.1](TDD.md#71-evaluation-p2-the-gate-for-p3-p6-p7).
**Done when:** `fit-test` PASS; 20 quotes hand-checked, ≥ 16 say something about fit; the P6 gate in 7.1 passes (average precision@10 +0.10, no profile losing more than one relevant card, "no" rate per profile printed, a cold feed timed under 20 s); `evidence_missed` < 10 % on a warm run; flipping the switch off and on re-judges nothing (`FitJudgement` and `JobJudgement` row counts unchanged); cost per active user per day measured; all listed tests PASS; the switch is on everywhere; typecheck and lint pass.

<a id="p7"></a>
### [ ] P7 — The daily set
Do: migration: `DailySet`; `modules/jobs/daily.ts` (once per user per IST day via SQL date, `ON CONFLICT DO NOTHING`; `basis` rebuild; no short sets; `released` with compare-and-set; swipes checked against `Swipe`); `PATCH /api/daily-set { from }`; `feed/page.tsx` and `/api/jobs` serve the release; `swipe-deck.tsx` refill off inside the set; the count line, "4 more", the end state; default view only; test profiles from mock jobs; `pushedAt`, one push after `DAILY_PUSH_HOUR_IST`, `alertNewMatches` off with the set; behind `DAILY_SET`; PRD §10; ARCHITECTURE 4, 6.3.
Design: [4.1 item 8](TDD.md#41-components) · [5](TDD.md#5-ui-direction-b-ui-craft-skill).
**Done when:** a test user sees the set in batches of four with "4 more", fewer than four at the end, then the end state and the ranked remainder (≥ 30 reachable for the demo profile); a refresh or a second tab does not skip a batch; changing fields rebuilds the set; a filter or `view=skipped` shows the ranked list; at most one set push per user per day (log); a new user gets a set on the first request; `feed-sql-test` PASS; `ui-lint --check` PASS; typecheck and lint pass.

<a id="p8"></a>
### [ ] P8 — Learning from skips
Do: migration: `Swipe.reason`; `PATCH /api/swipes/:jobId { reason }` (upserts the left swipe, no `forgetFeed`); the 4-second "Why?" row; `modules/profile/learning.ts` (three `not_my_field` in one family in 30 days after its last dismissal: own track → "Stop showing {family} roles?"; other family → a learned line, rank −10, `FeedJob.learnedNote`); `DELETE /api/brief/learned/:id` (dismissal date, `forgetFeed`); "What I've learned" on `/account`; `reading-report --skipped`; `scripts/learning-test.ts`; ARCHITECTURE 4, 6.3.
Design: [4.1 item 9](TDD.md#41-components).
**Done when:** `learning-test` PASS; a test user gives a reason without a 409 (including before the swipe POST lands) and without a feed rebuild (timed); the own-track prompt and a learned line both appear in a test run; a learned line lowers rank only (`score-breakdown-test` PASS); deleting it restores rank and is not undone by the next skip; typecheck and lint pass.

<a id="p9"></a>
### [ ] P9 — Cleanup
Do: after P3 and P6 have each run a week switched on, remove `READING_GATE`, `RELEVANCE_FIT`, the old `judgeBatch` path, `trackFloor` and their tests; drop `JobJudgement` in a migration; ARCHITECTURE 4, 6.3, 11.
**Done when:** no reference to `trackFloor`, `RELEVANCE_FIT`, `READING_GATE` or `JobJudgement` remains; all scorer tests PASS; typecheck and lint pass.
