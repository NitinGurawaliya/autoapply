# Phase P — Relevance: a feed built from what the user wants and what each job is (TDD v5, 19 Nov 2026)

Owner, 18 Nov: the product's main goal is relevant jobs for the profile. Asking the user a few questions before building the feed is fine. Jobs should arrive a few at a time, and the feed should learn the user's preferences. A chat with the agent (an "agent tab") is for later; this phase keeps the agent in the backend and puts its memory on a page the user can read and correct. Tasks: [TASKS.md](TASKS.md).

History: v1 → v2 → v3 each answered an independent review (22, 24 and 14 findings). The third review approved v3 with changes and blocked P1 on which code runs the ingest. On 18 Nov the boards branch (`claude/nervous-heisenberg-6e5f28`, docs/boards) was merged into `main` (`e8a12c1`), so v4 is written against that `main`. Section 13 maps the third review's findings to changes. A fourth review approved v4 with changes (17 findings); v5 applies them in place, plus the 18 Nov M21 change (the GitHub ingest reads up to 6,000 due companies a run, 2 hours at most); section 14 maps them.

## 1. Goals and non-goals

Goals:
- Every card in a user's feed is a job they could do **and** would want.
- A job's field, kind and red flags come from reading the posting once; the title decides only when there is no current reading.
- The user confirms what they want (fields, nearby fields, what to never show) before the first feed; the feed learns from skip reasons and shows what it learned so the user can correct it.
- The feed is a daily set released four at a time.
- Every change that alters which jobs are shown is measured against the current matcher, without touching live data, before it is switched on.

Non-goals (this phase): a chat with the agent; reading the user's inbox; application outcomes as a learning signal; resume tailoring (Phase L); any change to the hard rules (years, level, place, governance) or to how applications are filled; new boards; pay, city or level-ambition preferences; profile-driven discovery.

## 2. Facts the design rests on (code at `main` `e8a12c1` and the live DB, 18–19 Nov 2026)

**Ingest.**
- Three entry points read companies and then run their own tail: the worker's pg-boss `ingest-tick` every 5 minutes when `INGEST_MODE=tick` (`worker/handlers/ingest-tick.ts`: embed, warm only when something was embedded, delete old closed jobs hourly, logos); the GitHub Actions workflow `.github/workflows/jobs.yml` (M21) every 3 hours, running `scripts/ingest-tick-now.ts` (embed, warm, delete); and the old run mode `ingestJobs` (`INGEST_MODE=run`: embed, then `labelPendingSkills`). The workflow's schedules start once the file is on the default branch, which it now is; docs/DEPLOY.md says the workers move to `INGEST_MODE=off` after two days of green scheduled runs. Until then both the worker tick and the workflow may ingest.
- **Skills labels (Phase M3) are written only by the run mode.** Neither the tick nor the workflow calls `labelPendingSkills`; today's labels come from the 18 Nov backfill, so new jobs are unlabelled and their skills split is "mentioned", not "required".
- The workflow's ingest job reads up to 6,000 due companies a run with a 120-minute job timeout (M21, 18 Nov); a 2,000-company tick run took 8–58 min on 17 Nov.
- Live DB: 154–192 `IngestRun` rows a day; new jobs in the feed's pool 67–2,447 a day, and 824–1,284 pool jobs rewritten a day (many with unchanged text).
- `deleteOldClosedJobs` deletes jobs closed for **7 days** (`DELETE_CLOSED_AFTER_DAYS`) that no user swiped or applied to; the tick runs it hourly.
- Migrations: `main` has 26; the DB has 27 applied. The extra one, `20261105090000_site_connections` (Naukri branches), is applied but not on `main`, so `prisma migrate status` always reports a difference. That is expected; never act on it with `migrate dev` or a reset. Phase P's migrations are timestamped after `20261118090000`.
- Descriptions in the pool: median 4,218 characters, p90 7,365; requirements often come late.

**Boards and pool.** `APPLY_BOARDS` = greenhouse, ashby, keka, workable, smartrecruiters (match.ts). About 11,800 open India-eligible jobs posted within 60 days are on these boards (third review); P2 re-measures the feed's pool and the `ml_ai` mislabel rate on it (v3's 3,959 and 206 counted two boards).

**Title tracks and the gate.** `functions.ts classifyTitle` is a regex over the title; `ml_ai` matches any title with "AI", "ml", "generative" or "research engineer". `fields()` rewrites `Job.track` on every content change. The feed shows `feedTracks(tracks)` (T107, owner 9 Nov): the user's tracks plus `software` for developers; adjacent tracks only when picked in the Track filter. The track gate runs in `feedRows` (SQL; `FeedRow` carries no description by design) and, for jobs without a vector, in `scoreFeatures` via `trackFit(job.track)`. Mock jobs bypass the SQL gate. The `job_terms` trigger (BEFORE INSERT OR UPDATE OF title, description) maintains `Job.terms`.

**Verdict.** `semantic.ts judgeBatch` sees the title and 600 description characters, 40 jobs per call, 4 in parallel. `judgeJobs` caches in `JobJudgement` (`@@id([profileId, jobId])`; on any hash mismatch it deletes and recreates the row; `fromHash` = md5(`JUDGE_VERSION`, years, tracks, resume summary); `jobHash` = `contentHash`). `trackFloor` raises the field to "close" for the user's own track before storing (added 19 Oct: this prompt called 2,140 of 2,332 verdicts "no"). `match-test.ts` imports `trackFloor`, `judge-test.ts` imports `judgeBatch`, `feed-sql-test.ts` calls `judgeJobs`. `JobJudgement` has no foreign keys (5,892 rows of deleted profiles, 3,990 of deleted jobs).

**User's fields.** The confirm screen shows tracks as chips (`confirm-form.tsx`), stored in `Profile.tracks` with no maximum (two profiles have 5). `tracksOf` drives the judge hash, the feed's Track chips, the swipe check and prescan.

**Answers reach forms.** `modules/answers/memory.ts` embeds every `Answer` with a question and offers them as `matched` candidates on application forms, excluding only `accept_%` and guessed answers.

**Prescan.** Resume upload, profile confirm, saving an answer or a gap queue `enqueuePrescan` (singleton per user and reason for 600 s), which builds the feed in the worker.

**Score.** Phase N: the work 50 (verdict 35 / 25 / 10; unjudged 14, needing similarity ≥ 0.45; closeness 15), skills 40, experience 10; `VERDICT_FLOOR` and `UNSTATED_CAP` are adjustments; parts + adjustments = score (`score-breakdown-test`). Cards under `min_match_score` 40 are dropped and swipes under it blocked. `rank = score + verdict.nudge` (company results, −4 to +3, `results.ts`) orders cards without changing the number; rank is stripped before `FeedJob` is returned; `reason` is built in `scoreFeatures`.

**Feed and swipes.** The feed cache is 60 s per process; `forgetFeed` drops it (a cold rebuild takes 14–42 s); `dropFromFeed` removes one job after a swipe. The deck refills from `/api/jobs` at ≤ 5 cards (`REFILL_BELOW`); `feed/page.tsx` renders the first deck on the server from `listFeed`; `FEED_SIZE` 40, shortlist 150 widening to 450. The swipe check uses `cachedFeedScore`, then `candidateScore` (full Job row, `tracksOf(profile)`, the model for an uncached job). `POST /api/swipes` is sent fire-and-forget by the deck and answers 409 `already_swiped` after the first.

**Pushes.** After a warm, `alertNewMatches` pushes "N new jobs match your resume" when there are new strong or good matches (VAPID keys required).

**LLM.** `lib/llm.ts callJson` is the only path; `complete()` has no timeout, no backoff and no Retry-After; its cache is in-process.

**Other.** `/dev/*` is open without sign-in outside production (`proxy.ts`). Real profiles with ≥ 20 swipes: 801 (the owner's test account), 87, 81, 56, 45, 37. 363 of 1,166 swiped jobs are closed. Skills labelling cost ~$0.13 per 1,000 jobs (Phase M3); reading is estimated at ~$0.375 per 1,000 (input and output).

## 3. Options and decision

| Option | Verdict |
|---|---|
| A. A curator agent per user with tools | Slow, ~100× the cost, untestable, hard rules leak into a prompt. Rejected. |
| B. Read each job once; the user confirms fields and avoids; one gate everywhere; a fit verdict with evidence; hard rules in code; measured offline | **Chosen.** |
| C. Infer intent, fix the title regex | Does not hear what the user wants. Rejected. |

## 4. Architecture

### 4.1 Components

1. **One after-ingest tail** (`modules/jobs/after-ingest.ts afterIngest({ deadlineMs })`): embed new jobs → label skills for the feed's pool (`labelPendingSkills`, so the tick and the workflow label too) → read pool jobs (item 2) → warm when anything was embedded, labelled or read → the daily set's push step (item 8) → delete old closed jobs (at most hourly, keeping pooled and labelled ones, item 10). Each step fails alone, stops at the deadline and is resumed by the next call. Callers:
   - **The worker's tick** sends its due companies **first**, then starts `afterIngest` in the background behind an in-process flag (as logos does), so a slow tail never holds a tick past its 600 s expiry; deadline 8 minutes.
   - **The workflow** runs `afterIngest` as its own job after the ingest job (`scripts/after-ingest-now.ts`, its own `timeout-minutes: 45`), reading until the daily budget or a 40-minute deadline, so the 2-hour company read never starves it.
   - **Run mode** (`ingestJobs`, not scheduled today) calls it too; `worker/handlers/ingest.ts` drops its own warm so nothing warms twice. Logos stay with the callers.
   "The feed's pool" everywhere in this phase: open, `source = ANY(APPLY_BOARDS)`, India-eligible, posted within `INGEST_DAYS` (60).
2. **Job reading** (`modules/jobs/reading.ts`). From title + up to 6,000 description characters (P1 measures the share of readings with ≥ 2 requirement lines), batches of 10, through `callJson`:
   - `roleFamily`: one of `TRACKS` or `non_tech`;
   - `kind`: `employee | intern | contract | gig | task`;
   - `flags`: `paid_task`, `commission_only`;
   - `summary`: one sentence (display only);
   - `evidence`: lines copied from the posting supporting `roleFamily`, `kind` or a flag;
   - `requirements`: up to 4 lines copied from the posting saying what the candidate must have or will do.
   Code checks: every evidence and requirement line is a whitespace-normalised substring of the posting or it is dropped; a `kind` other than `employee` or a flag without a surviving evidence line is dropped; a `roleFamily` without evidence is stored as null.
   Columns: `roleFamily`, `kind`, `flags`, `reading` (summary, evidence, requirements), `readingCurrent Boolean`, `readAt`, `readFailedAt`, `readAttempts`, `readClaimedUntil`.
   - **Staleness by trigger** (`job_reading_stale`, BEFORE INSERT OR UPDATE OF title, description): `IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN NEW."readingCurrent" := false`. Ingest rewrites both columns on every changed job, so the value check (not the column list) is what keeps a location-only change from staling a reading. No query hashes text.
   - **Claiming**: the reader claims a batch with `UPDATE "Job" SET "readClaimedUntil" = now() + 10 min WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED) RETURNING …`, so the tick and the workflow never read the same jobs.
   - **No lost race**: the reader keeps `md5(title || chr(10) || description)` of the text it sent, and its write is `UPDATE … WHERE id = $id AND md5(title || chr(10) || description) = $hash`; if the text changed meanwhile the write is skipped and the job is read again.
   - The reader picks pool jobs where `reading IS NULL OR NOT readingCurrent`, unclaimed, skipping any with 3 attempts and `readFailedAt` in the last 24 h.
   - **Budget**: `JOB_READINGS_PER_DAY` (4,000), counted as jobs with `readAt` since the IST day began (global across processes; two processes may overshoot by one batch each). The backfill's reads count against that day's budget. With the tick's 8-minute and the workflow's 40-minute deadlines, the measured inflow (67–2,447 new and ~1,000 rewritten pool jobs a day, of which only text changes need a re-read) fits; P1 checks the backlog after 24 h of scheduled runs.
3. **LLM resilience** (`lib/llm.ts`): a per-call timeout (default 60 s, callers may raise it: essays are long), Retry-After-aware exponential backoff on 429 and 5xx (at most 4 tries), and two lanes: `lane: "background"` (reading, skills labels, judging, fit) is capped per process at `LLM_BACKGROUND_CONCURRENT` (6); `lane: "interactive"` (the default: field mapping, guesses, essays during an apply run) is never queued behind background batches. The cap is per process; the daily budget bounds the total.
4. **One gate** (`modules/jobs/gate.ts`): `trackOf(job)` = the reading's `roleFamily` when `readingCurrent` and not null, else `classifyTitle` / `Job.track`. `jobGate(job, { tracks, avoid }, { field })` passes when (if `field`) **`trackOf(job)` is in `tracks`** (the reading decides when current; the title only when there is none), `trackOf(job)` is not `non_tech`, `kind` is not `gig` or `task`, `flags` has no `paid_task`, and nothing in `avoid` matches (item 5's table). `tracks` is the **effective** list the feed used: the Track filter's picks when set (as `listFeed` does today), else `feedTracks(profile)`; `null` (no tracks) skips the field part. Mock jobs pass, as in SQL today. **The swipe check calls it with `field: false`**: it enforces non-tech, gig, task, paid task and avoid only, because it cannot know which Track filter the card was shown under; the field part is enforced where the card is chosen. The pure functions land quietly in P1 (P2's eval needs them); P3 adds the SQL mirror in `feedRows` (which then returns `roleFamily`, `kind`, `flags`, `readingCurrent`) and uses `jobGate` in `scoreFeatures` (with the effective tracks, and `trackOf(job)` replacing `job.track` in `trackFit`) and in `candidateScore` (`field: false`, the profile's `avoid`), so the card, the score and the swipe check agree. P2 also scores the v3 rule ("title OR reading") on the same labels; P3 ships the rule with the higher paired precision@10, both passing non-inferiority, a tie going to "reading decides".
5. **Fields and avoids** on the confirm screen (no new screen). Under the track chips: "Also show nearby fields" (`Profile.showNearby`, off; on, adjacent tracks join `feedTracks`) and "Never show me" chips (`Profile.avoid String[]`, empty by default):

   | Chip | Value | Removes |
   |---|---|---|
   | Contract roles | `contract` | `kind = contract` |
   | Internships | `intern` | `kind = intern` |
   | Commission only | `commission_only` | flag `commission_only` |

   Gigs, tasks and paid tasks are always out (they are not jobs). Nothing is stored as an `Answer`. Saving queues a prescan as today.
6. **Candidate brief** (`modules/profile/brief.ts`, table `CandidateBrief`): tracks, nearby, years, current title, top skills; never name, email, phone or links. `fitHash = md5(FIT_VERSION + the exact candidate JSON sent)`. Learned lines and dismissals live beside it (`learned`), outside the hash. Its own table, so a rebuild leaves `Profile.updatedAt` alone. Shown on `/account`.
7. **Fit verdict** (`modules/jobs/fit.ts`, table `FitJudgement`, behind `RELEVANCE_FIT`). For the shortlist (on the request path at most 150; prescan and warm widen to 450), batches of 10; per job it sends the reading (role family, kind, summary, numbered requirement lines) and the skills comparison already computed; returns `fit` (`strong | good | stretch | no`), `why` (≤ 12 words) and `evidence` (a requirement line number, checked). `jobHash = md5(the exact per-job JSON sent, without its batch index)`, so a changed skills split, reading or label re-judges that job alone; the shortlist's readings come from one extra query (`FeedRow` carries no reading). Jobs without a current reading get no fit verdict and take the unjudged path. `levelFit` (code) applies on top. **Separate table** `FitJudgement` (`@@id([profileId, jobId])`, `fitHash`, `jobHash`, `fit`, `why`, `evidenceIndex`): the old path keeps `JobJudgement` untouched, so flipping `RELEVANCE_FIT` re-judges nothing and processes on different settings never overwrite each other. **One build per user at a time by a lease row**, not an advisory lock (one would collide with `swipeRight`'s `pg_advisory_xact_lock(hashtext(userId))` and pin a pooled connection across model calls): `CandidateBrief.fitBuildUntil` is set by compare-and-set (`UPDATE … WHERE fitBuildUntil IS NULL OR fitBuildUntil < now()`) for 3 minutes; verdicts are written per batch, so a second caller reads what is done and judges nothing; a single-job check (`candidateScore`) judges its one job without the lease. With `RELEVANCE_FIT=0` the old path, `trackFloor` included, runs unchanged; P9 removes it.
8. **Daily set** (`modules/jobs/daily.ts`, table `DailySet`, behind `DAILY_SET`).
   - Build: once per user per IST day (`(now() AT TIME ZONE 'Asia/Kolkata')::date`), by the first of request, prescan or warm, `INSERT … ON CONFLICT DO NOTHING` then read: the top `DAILY_SET_SIZE` (12) unswiped jobs of the default feed by rank. A `basis` hash (tracks, nearby, avoid, verdict path and its `fromHash`/`fitHash`) is stored; when it differs (the user changed their fields, or a new user's set was built by the resume-upload prescan before confirm), the set is rebuilt. A set built from a degraded feed (the judge or fit failed for part of the shortlist) is not stored; the next build tries again.
   - Release: `DailySet.released` (starts at 4). The deck shows `set[0 .. released)` minus jobs swiped (checked against `Swipe`, not the cache) and minus jobs that no longer pass the gates or score below the minimum (checked against the **unsliced** scored list, not the 40-card slice, so a busy day's arrivals never push set jobs out). After the last of them, "4 more" sends `PATCH /api/daily-set { from: released }`, which advances `released` by 4 only if it still equals `from`; a rejected PATCH returns the current `released` (a refresh or a second tab cannot skip a batch). Inside the set the deck's own refill is off. When fewer than 4 remain they are shown, then the end state: "That's today's set", "Keep going" (the ranked remainder, refill on) and "Done for today".
   - Scope: the default view without URL filters; any filter or `view=skipped` shows the ranked list as today. `feed/page.tsx` and `/api/jobs` both serve the release. Test profiles build their set from the same feed they get today (real boards plus mock).
   - Push: `DailySet.pushedAt`; the push step runs on **every** `afterIngest` call, not only after a warm: after `DAILY_PUSH_HOUR_IST` (08) it builds the set for each active user with push on if it is missing, then sends one "Today's set is ready" per user per day. While the set is on, `alertNewMatches` is off for that user. `DailySet.userId` has a foreign key to User with cascade.
9. **Learning from skips** (`modules/profile/learning.ts`). After a left swipe, a one-tap row for 4 s (Not my field · Too senior · Place · Company · Other), saved by `PATCH /api/swipes/:jobId { reason }`: `INSERT … ON CONFLICT ("userId","jobId") DO UPDATE SET reason = … WHERE "Swipe".direction = 'left'` (a right swipe is never changed), then `dropFromFeed` (the deck's fire-and-forget POST may land second and get a 409 that skips its own drop); no `forgetFeed`. The swipe also stores the job's family at that moment (`Swipe.family`), so later re-readings do not move old skips. Only `not_my_field` is counted, and only on `direction = 'left'` (`swipeRight` turns a left swipe into a right one and keeps the row). Owner, 19 Nov: the agent also asks from clear patterns in the other kinds, one question at a time, at most one a day, one tap: "Hide contract roles?", "Hide internships?" (Hide adds the avoid chip; Keep showing dismisses).
   - Three `not_my_field` on jobs of one `trackOf` family within 30 days, counted only after that family's last dismissal:
     - if the family is one of the user's own tracks: a prompt on the feed, "Stop showing {family} roles?" (Yes writes `tracksOf(profile)` minus the family to `Profile.tracks`, a field change; No dismisses). It is never offered for the last remaining track (`tracksOf` would infer it straight back from the skills); then the prompt is "Change your fields?", which opens the confirm screen;
     - otherwise (nearby fields, the `software` slot): a learned line that lowers rank by 10 (`FeedJob.learnedNote` shows "You skip most {family} roles"), never the score, so the number, `min_match_score` and the swipe check are untouched. It can move a card out of the 40-card slice or the 12-job set.
   - Lines are listed on `/account` with ×; deleting one stores the dismissal date and calls `forgetFeed`. Skips are also logged for reading quality (`reading-report.ts --skipped`).
10. **Evaluation** (`scripts/label-candidates.ts`, `scripts/relevance-eval.ts`; tables `EvalPool`, `FeedLabel`, `EvalJudgement`). See 7.1. `deleteOldClosedJobs` keeps jobs with a `FeedLabel` or in an `EvalPool`.

### 4.2 Queues

No new queue. `afterIngest` runs in the worker's tick and in the workflow; brief, fit and the daily set run in prescan and warm. The reading backfill (`scripts/backfill-job-reading.ts`) runs in the background with the same capped `callJson`, resumable.

### 4.3 Data model (eight hand-written migrations, one per task, timestamped after `20261118090000`; `prisma migrate deploy` only, never a shadow DB; `prisma migrate status` first, expecting only the Naukri migration that exists in the DB alone)

```
P1  Job: roleFamily String?, kind String?, flags String[] @default([]), reading Json?, readingCurrent Boolean @default(false),
         readAt DateTime?, readFailedAt DateTime?, readAttempts Int @default(0), readClaimedUntil DateTime?;
         trigger job_reading_stale (value check, 4.1.2)
P2  EvalPool:      profileId, round Int, jobId, source String (old | reading | title_or | random | fit)   @@id([profileId, round, jobId])
    FeedLabel:     profileId, jobId, relevant Boolean?, by String, at DateTime, round Int              @@id([profileId, jobId])
    EvalJudgement: profileId, jobId, path String (old | fit), fromHash, jobHash, fit, why, evidence Int? @@id([profileId, jobId, path])
                   all three: FK profileId → Profile and jobId → Job, cascade (account deletion removes them;
                   deleteOldClosedJobs' NOT EXISTS keeps pooled and labelled jobs)
P4  Profile: showNearby Boolean @default(false), avoid String[] @default([])
P5  CandidateBrief: userId String @id, brief Json, fitHash String, learned Json @default("[]"), fitBuildUntil DateTime?, updatedAt;
                    FK → User, cascade
P6  FitJudgement:  profileId, jobId, fitHash, jobHash, fit, why, evidenceIndex Int?, createdAt   @@id([profileId, jobId]);
                   FKs → Profile and Job, cascade.  JobJudgement: orphans deleted only (P9 drops the table)
P7  DailySet: userId, day (date, IST), jobIds String[], released Int @default(4), basis String, pushedAt DateTime?, builtAt
              @@id([userId, day]); FK → User, cascade
P8  Swipe: reason String?, family String?
P9  drop JobJudgement
```

### 4.4 Sequences

**A job, ingest to card:** a read (tick or workflow) → `fields()` (title track, as today) → `afterIngest`: embed → skills labels → reading → warm (per active user: brief → `feedRows` with the gate → ranking → verdict (fit or old path, cached) → score → rank (+ nudge, + learned) → daily set when its basis changed or the day turned) → hourly cleanup. The set's push goes out after 08:00 IST.

**The request path:** once warm or prescan has run for a user since their last change, `listFeed`, the swipe check and the set only read cached verdicts. A cold user is judged on the request with the shortlist capped at 150 (new path); saving the confirm screen queues a prescan.

**A user:** resume (prescan) → confirm (tracks, nearby, never show me; prescan) → questions → today's set → left swipe → optional reason → after three "not my field": a prompt or a learned line.

### 4.5 Checks (code, never only prompts)

- Reading and fit outputs Zod-validated; enums only; evidence and requirements verbatim; fit evidence by number.
- Hard rules unchanged: `bandMiss`, `levelsFor`, the place filter, `min_match_score`, governance. `jobGate` keeps T107 (`feedTracks`) and only changes which family a job belongs to.
- `jobGate` (JS) and its SQL mirror agree on 500 real jobs (test).
- `score-breakdown-test` unchanged (learned lines act on rank).
- No contact data in a brief; the fit prompt never gets resume text or the raw posting; nothing from this phase is an `Answer`.
- The eval never writes `JobJudgement` or `FitJudgement`.

### 4.6 Failures

Reading missing, failed or stale: the title track decides, ranked as today; no fit verdict. Fit fails after backoff: the unjudged path, not cached, retried at the next warm. No set: the ranked deck. A step of `afterIngest` fails: the others run; the next call retries.

### 4.7 Observability

`afterIngest`: `after-ingest embedded=N labelled=N read=N read_failed=N budget_left=N warmed=N deleted=N`. Warm: `fit judged=N cached=N evidence_missed=N no=N set=built|kept|rebuilt`. `reading-report.ts --sample N | --skipped`; `relevance-eval.ts` (7.1).

### 4.8 Code map

| Task | Files |
|---|---|
| P1 | `modules/jobs/after-ingest.ts` (new) and its callers (`worker/handlers/ingest-tick.ts` after its sends, `scripts/after-ingest-now.ts` as a new `jobs.yml` job, `modules/jobs/ingest.ts ingestJobs`; `worker/handlers/ingest.ts` and `scripts/ingest-tick-now.ts` drop their own warm and cleanup); `modules/jobs/reading.ts`, `modules/jobs/gate.ts` (pure `trackOf`, `jobGate`, not yet used by the feed); `lib/llm.ts`; `scripts/reading-test.ts`, `reading-report.ts`, `backfill-job-reading.ts`, `gate-test.ts` (pure part) |
| P2 | `scripts/label-candidates.ts`, `scripts/relevance-eval.ts`, the three tables; `deleteOldClosedJobs` keeps labelled and pooled jobs |
| P3 | `feedRows` SQL mirror, `scoreFeatures`, `apply/lifecycle.ts candidateScore`, `feed-audit.ts`, `feed-sql-test.ts`, `match-test.ts`, `gate-test.ts` (mirror part) |
| P4 | `confirm-form.tsx`, `api/profile`, `feedTracks`, `jobGate` avoid |
| P5 | `modules/profile/brief.ts`, `api/brief`, `/account` |
| P6 | `modules/jobs/fit.ts`, `match.ts`, `warm.ts`, the prescan handler, `lifecycle.ts`, `jobs/[id]/match-sections.tsx`, `match-test.ts`, `judge-test.ts`, `feed-sql-test.ts`, `scripts/fit-test.ts` |
| P7 | `modules/jobs/daily.ts`, `api/daily-set`, `api/jobs`, `feed/page.tsx`, `feed/swipe-deck.tsx`, `warm.ts` push, PRD §10 |
| P8 | `modules/profile/learning.ts`, `api/swipes/[jobId]`, the reason row, the stop-showing prompt, `match.ts` rank and `FeedJob.learnedNote`, `/account` |
| P9 | remove `RELEVANCE_FIT`, `READING_GATE`, the old judge path, `trackFloor` and `JobJudgement` once P6 and P3 have each run a week switched on |

Each task updates the ARCHITECTURE section it changes (CLAUDE.md design rule 3): 4 (data model), 6.2 (P1), 6.3 (P3, P4, P6, P8), 11 (env).

### 4.9 Env

`JOB_READINGS_PER_DAY` (4000), `AFTER_INGEST_TICK_MS` (480000), `AFTER_INGEST_RUN_MS` (2400000), `LLM_BACKGROUND_CONCURRENT` (6), `LLM_TIMEOUT_MS` (60000), `READING_GATE` (P3), `RELEVANCE_FIT` (P6), `DAILY_SET` (P7), `DAILY_SET_SIZE` (12), `DAILY_RELEASE` (4), `DAILY_PUSH_HOUR_IST` (8). The worker, the workflow (repository secrets or `env:` in jobs.yml) and the web app must carry the same switches.

## 5. UI (Direction B, `ui-craft` skill)

- **Confirm screen**: under the track chips, "Also show nearby fields" (toggle) and "Never show me" (Contract roles · Internships · Commission only).
- **Feed**: "Today's set · 4 of 12"; after a batch, "4 more"; the end state "That's today's set", "Keep going", "Done for today"; after a left swipe a one-tap "Why?" row for 4 s; when a family is skipped three times, "Stop showing {family} roles?" Yes / No.
- **Card**: the learned note, when there is one, under the reason.
- **Job page**: under "Why it's a match", the fit's requirement line as a quote (P6).
- **Account**: "What I know about you": tracks, nearby, never show me (edit through confirm), learned lines with ×.

## 6. API

`PUT /api/profile` gains `showNearby`, `avoid`; `GET /api/brief`; `DELETE /api/brief/learned/:id` (`forgetFeed`); `PATCH /api/swipes/:jobId { reason }` (upserts the left swipe; no `forgetFeed`); `PATCH /api/daily-set { from }` (compare-and-set); `GET /api/jobs` serves the release when the set is on.

## 7. Testing

### 7.1 Evaluation (P2; the gate for P3, P6, P7)

- **Profiles**: real profiles with ≥ 20 swipes, reported one by one; the owner's account apart from the average.
- **Pool**: per profile and round, stored in `EvalPool`: jobs passing today's hard gates at label time, ignoring `closedAt`, the 60-day cutoff and swipe exclusions. Every ranking is computed within that stored pool. Pooled and labelled jobs are kept by `deleteOldClosedJobs`; the backfill reads pooled closed jobs.
- **Labels** (`FeedLabel`, by the owner via `scripts/label-candidates.ts --label`, a terminal prompt): each candidate shows the start of the posting text (not the model's summary) and the profile's brief (tracks, years, title, top skills; never contact data), shuffled, without its source. Round 1 (P2, after P1's readings): the union of the old matcher's top 20, the reading gate's top 20 and the "title OR reading" gate's top 20, up to 15 of the old matcher's cards a new rule removes (owner, 19 Nov: shows whether the reading drops good jobs), plus 10 random pool jobs. Round 2 (P6, before its switch): the fit's new top-20 picks not yet labelled, mixed with as many random pool jobs.
- **Verdicts for the eval** go only to `EvalJudgement`: the old path through `judgeBatch` directly (with `trackFloor`, keyed by its `fromHash`), so jobs the new gate gains are not scored unjudged; the new path through `fit.ts` in dry-run mode.
- **Ranking within the pool**: the eval does not copy the ranking code; `scoreFeed` gains an `onlyIds` option (the stored pool) that `feedRows` applies, so the eval ranks with production code.
- **Metric**: precision@10 and @20 over labelled jobs in each ranking, compared per profile (paired); the share of each top 10 that is labelled (below 80 %, label more before deciding); cards kept; cards gained and lost by each gate; the top 10 per profile printed.
- **Gates**:
  - P3 (the gate only removes or reassigns): non-inferiority — precision@10 not lower for any profile, no profile loses a relevant card from its top 10, and at least 80 % of labelled cards the gate removes are irrelevant; cards kept ≥ 20 where they were ≥ 20.
  - P6: average precision@10 up by at least 0.10 (paired per profile), no profile losing more than one relevant card; cards kept ≥ 30, or ≥ the old count where that was lower; the fit's "no" rate ≤ 0.6 of the shortlist for every profile (the 19 Oct failure was 0.92); a timed cold feed under 20 s.
  - P7: the demo profile keeps every card the old matcher showed that the owner labelled relevant (section 11 item 14).
- **Online check after each switch** (`scripts/relevance-online.ts`): per user per week, the right-swipe share of cards seen and the `not_my_field` rate; a switch that lowers the first or raises the second for most active users is rolled back.
- **Question for the owner**: labelling uses real users' profile briefs (no contact data). Confirm that is acceptable, or label only the owner's and test profiles.

### 7.2 Unit and regression

- `reading-test`: an AI photographer → `non_tech`; a finance "AI research contributor" → `non_tech` or `gig`; a paid video task → `task` + `paid_task`; "AI Engineers" and "MTS – Machine Learning" → `ml_ai`; a contract role → `contract`; lines not in the posting dropped; the trigger marks a reading stale on a description change and not on a location change. `reading-report --sample 20`: ≥ 18 right.
- `gate-test`: the reading decides when current; the title when not; `software` slot; `non_tech`, gig, task, paid task; each avoid chip; mock jobs; `jobGate` and the SQL mirror agree on 500 real jobs (P3).
- `fit-test`: an invalid evidence number keeps the fit without a quote; "no" stands; `fitHash` changes with `FIT_VERSION` and the candidate JSON, not with learned lines; `jobHash` changes when the per-job JSON changes.
- `brief-test`: no contact data. `learning-test`: three `not_my_field` on an own track → the prompt; on a nearby family → a learned line and rank −10, score unchanged; deleting it restores rank; a later skip does not recreate it before three new ones.
- `afterIngest`: a tick and a workflow run both label skills and read within the budget (log lines).
- `match-test`, `score-breakdown-test`, `feed-sql-test`, `judge-test` pass on both paths where they apply; `ui-lint --check` for UI tasks.

## 8. Rollout

P1 (quiet: tail, reading, gate functions, resilience) → P2 eval and round 1 → P3 gate (`READING_GATE`, on when 7.1 passes) → P4 fields and avoids → P5 brief → P6 fit (`RELEVANCE_FIT`, round 2, on when 7.1 passes) → P7 daily set (`DAILY_SET`) → P8 learning → P9 cleanup. Each switch is one env change on every process (4.9) to roll back.

Ingest during Phase P: `afterIngest` is shared, so it works whether the worker's tick, the workflow or both are reading companies; switching the workers to `INGEST_MODE=off` (docs/DEPLOY.md) is independent of this phase.

Demo path (PRD §10, CLAUDE.md): the demo profile is named in P2 and checked at every switch; P7 updates PRD §10 to "a daily set of 12, then the full ranked feed".

## 9. Risks

- Cold feeds after a change of fields (14–42 s today). Mitigation: the confirm save queues a prescan; the cold shortlist is 150; P6 times it (< 20 s).
- Rate limits across two ingest processes. Mitigation: per-process cap and backoff; the daily reading budget is global (counted in the DB).
- Fit quotes restating the role. Mitigation: requirement lines; P6 hand-checks 20 quotes (≥ 16 about fit).
- Fewer cards once non-tech, gigs and tasks leave. Mitigation: 7.1 gates on cards kept.
- Learning from mis-taps. Mitigation: three in 30 days; own tracks need a confirmed prompt; rank only otherwise; visible and deletable; dismissals stick.
- Costs: reading ~$0.375 per 1,000 jobs (backfill of the five-board pool ~$4.50 once; ~$1 a day at the budget); fit ~$0.02 per active user per day.

## 10. Tasks

P1–P9 in [TASKS.md](TASKS.md).

## 11. Decisions closed with the owner (18–19 Nov)

1. The goal is relevant jobs for the profile; the owner's account is a test account, not a source of truth for supply or evaluation averages.
2. A few questions before the first feed are fine (on the confirm screen: fields, nearby, never show me).
3. The agent stays in the backend; its memory is a page the user can read and correct; a chat tab is later.
4. Jobs arrive four at a time in a daily set; the feed learns from skip reasons.
5. Hard rules stay in code; the model's "no" wins on the new path.
6. Phase P builds on `main` after the boards branch merge (19 Nov, `e8a12c1`).
7. Defaults chosen here, open for the owner: the reading decides a job's field when current (P2 compares it with "title OR reading"); strict fields with an opt-in "nearby" toggle; gigs, tasks and paid tasks always out; labels by a terminal prompt into `FeedLabel`; outcome learning deferred; whether labelling may use real users' briefs (7.1).
8. (19 Nov) The agent is quiet, with one daily line above the set: "Your agent read N new jobs and picked these 12." Reasons stay on cards; the brief on `/account`.
9. (19 Nov) The agent asks over time, only from clear skip patterns (contract roles, internships, a field): one question at a time, at most one a day, one tap ("Hide contract roles?" Hide / Keep showing). P8 covers these, not only "not my field".
10. (19 Nov) Supply: no scout for now; today's sector-based discovery stays.
11. (19 Nov) No cost cap for now; `JOB_READINGS_PER_DAY` is a throughput budget, not a spend limit.
12. (19 Nov) The free-points fix ships now, standalone, before Phase P: a posting naming no vocabulary skill scores 0 skills points (was 15), and a "stretch" verdict with no skill matched is not shown.
13. (19 Nov) Labelling may use real profiles with 20+ swipes, showing only the brief (tracks, years, title, top skills; never contact data or resume text).
14. (19 Nov) The demo profile is the owner's account. Its pool is nearly used up, so the P7 gate for it is "keeps every card the old matcher showed that the owner labelled relevant", not a fixed 30.

## 12. Sources

Code at `main` `e8a12c1` (19 Nov): `worker/handlers/ingest-tick.ts`, `scripts/ingest-tick-now.ts`, `.github/workflows/jobs.yml`, `worker/schedule.ts`, `modules/jobs/ingest.ts`, `functions.ts`, `semantic.ts`, `match.ts`, `warm.ts`, `results.ts`, `answers/memory.ts`, `lib/llm.ts`, `lib/feed-cache.ts`, `apply/lifecycle.ts`, `feed/*`, `api/swipes`, `confirm-form.tsx`, `proxy.ts`, `prisma/schema.prisma`, migration `job_terms`; docs/DEPLOY.md; the three independent reviews and their read-only DB counts.

## 13. Third review (v3 → v4)

| # | Finding | v4 |
|---|---|---|
| B1 | Which code runs the ingest; P2, P5–P7 depend on it | The boards branch is merged into `main` (19 Nov); one `afterIngest` tail for all three entry points; facts restated for `main` (2, 4.1.1, 8, 11.6) |
| B2 | Round 1 needs the gate before P3 | Pure `trackOf` and `jobGate` land in P1; P3 adds the SQL mirror and wiring; the backfill reads pooled closed jobs (4.1.4, 7.1) |
| B3a | "Title OR reading" keeps jobs on the title alone | The reading decides when current; the title only without one; P2 measures both rules (4.1.4) |
| B3b | Avoid chips vs kind | One table: contract, intern, commission_only; gigs, tasks, paid tasks always out (4.1.5) |
| B3c | Staleness can't be computed in SQL cheaply | `readingCurrent` maintained by a trigger beside `job_terms`; `feedRows` returns the reading columns (4.1.2, 4.1.4) |
| B3d | No-vector `trackFit`, mock jobs, empty tracks | `trackOf` passed to `trackFit`; mock jobs pass; empty tracks skip only the field part (4.1.4) |
| B3f | `candidateScore` and nearby / avoid | Built from the profile's tracks, `showNearby`, `avoid` (4.1.4) |
| B4 | Both paths share `JobJudgement` | New `FitJudgement` table; old table untouched; flips re-judge nothing (4.1.7, 4.3) |
| B5 | Daily set: sliding window, stale, empty, push | `released` with compare-and-set "4 more", `basis` rebuild, no short sets, `Swipe`-checked, IST via SQL, `pushedAt` + 08:00 IST, `alertNewMatches` off with the set (4.1.8) |
| B6 | Fit inputs outside the keys | `jobHash = md5(exact per-job JSON)`; no fit without a current reading (4.1.7) |
| B7 | Learning on own tracks, display, dismissals | Own tracks → a confirmed "Stop showing" prompt; others → rank −10 with `learnedNote`; dismissals counted (4.1.9) |
| B8 | Eval bias, unstored pool, labeller's view | `EvalPool`; old-path verdicts in `EvalJudgement`; posting text and profile brief shown; labelled-share check; owner question on real briefs (7.1) |
| B9 | No place to count the reading budget | `readAt`, `readFailedAt`, `readAttempts`; budget counted per IST day in the DB (4.1.2) |
| B10 | Facts: tracks limit, swipe check order, cold timing, two boards | Corrected (2, 9) |
| B11 | Done-whens | P1 "no feed code reads the reading columns" + `feed-sql-test`; P3 non-inferiority; P6 "no" rate and timed cold feed; P7 rebuild and one push a day; seven migrations listed with `migrate status` first (TASKS, 4.3, 7.1) |
| B12 | Cold cap on the old path; double judging; unused intern; reasons | Cap on the new path only; advisory lock per user; intern is an avoid chip; only `not_my_field` used (4.1.5, 4.1.7, 4.1.9) |
| B13 | PATCH before the POST lands | The PATCH upserts the left swipe (4.1.9) |
| B14 | Who labels skills live | No one in tick or workflow mode; `afterIngest` labels in every mode (2, 4.1.1) |

## 14. Fourth review (v4 → v5) and the M21 change

| # | Finding | v5 |
|---|---|---|
| B-1 | Reading can't keep up once the workflow is the only ingester | The workflow runs `afterIngest` as its own job (45 min) until the budget or a 40-minute deadline; reading and labelling cover only the feed's pool; budget 4,000; P1 checks the backlog after 24 h (4.1.1, 4.1.2) |
| B-2 | The tail runs before the tick's reads and can blow its 600 s | The tick sends due companies first, then runs the tail in the background behind a flag, with an 8-minute deadline; labelling limited to the pool (4.1.1) |
| B-3 | The trigger fires on every rewrite; the reader can mark an old reading current | `IS DISTINCT FROM` value check; the reader's write lands only if the text it read is unchanged (4.1.2) |
| B-4 | Advisory lock collides with `swipeRight`; xact locks across model calls | A lease row (`CandidateBrief.fitBuildUntil`) by compare-and-set; per-batch writes; single-job checks without the lease (4.1.7) |
| B-5 | The gate ignores the Track filter; the swipe check could block a shown card | `jobGate` takes the effective track list; the swipe check enforces only non-field parts (4.1.4) |
| B-6 | PATCH before POST skips `dropFromFeed`; could alter a right swipe | `ON CONFLICT … WHERE direction = 'left'`, then `dropFromFeed`; family stored on the swipe; counts only left swipes (4.1.9) |
| B-7 | Daily set: test profiles, 40-card slice, push tied to warm, degraded sets, PATCH reply, FK | Same feed for test profiles; unsliced list; push step on every tail call; no sets from degraded feeds; rejected PATCH returns `released`; FK (4.1.8, 4.3) |
| B-8 | Removing the last track comes straight back | Write `tracksOf(profile)` minus the family; never offered for the last track (4.1.9) |
| B-9 | P6 has no cards-kept or "no"-rate floor | Cards kept ≥ 30 or ≥ old; "no" rate ≤ 0.6 per profile; paired comparison (7.1) |
| B-10 | Migration drift and count | Naukri migration in the DB alone is expected, never "fixed"; eight migrations after `20261118090000`; P6 only deletes `JobJudgement` orphans (2, 4.3) |
| B-11 | Closed jobs are deleted after 7 days | Corrected; pooled and labelled jobs kept (2, 4.3) |
| B-12 | Run mode would warm twice | `handlers/ingest.ts` drops its warm; logos stay with callers (4.1.1) |
| B-13 | One FIFO cap queues apply-time calls behind batches | Background and interactive lanes; per-call timeout (4.1.3) |
| B-14 | Eval ranking copies production code; P3's winner undefined | `scoreFeed({ onlyIds })`; paired precision@10, ties to "reading decides"; P3 adds "precision@10 not lower" (4.1.4, 7.1) |
| B-15 | `jobHash` and the batch index; readings not in `FeedRow` | Hash without the index; one extra query for readings (4.1.7) |
| B-16 | Eval tables outside account deletion | FKs with cascade (4.3) |
| B-17 | Done-whens | P1 ≥ 98 % read and the backlog check; backfill counts against the budget; `jobs.yml` env in P3, P6, P7; `feed-audit` in P6; an online check after each switch (TASKS, 7.1) |
| M21 | The workflow reads up to 6,000 companies for up to 2 hours | The tail is its own workflow job, so the long read cannot starve it (4.1.1) |
| Owner | Decisions 8–14 (19 Nov) | Section 11; the free-points fix landed as `4b8efa8` |
