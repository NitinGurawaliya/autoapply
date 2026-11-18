# A job card and job page that explain the match — technical design (Phase M: M1–M7)

Version 1, 18 Nov 2026. Owner's ask (18 Nov), with a competitor's cards and job page as reference: the user has about 1 to 1.5 seconds per card to decide, and our card "shows very little and very vague information"; the job page should explain the match the way the reference does (matches and gaps, the job's skills against yours, how the score was reached).

The one-line design: **the scorer returns the parts it already computes, ingest records the tech skills a job literally names (and, from boards that publish it, the pay), a constrained model call only labels those skills required or nice-to-have, and the card and job page show all of it in ink and lime.**

## 1. Goals and non-goals

Goals:
- The card answers in one glance: how good a match (the number and the tier word), where and how (place, work mode), at what level (experience), for what pay (when published), what kind of company (the stage we store), which of the job's skills you have and which you lack, and one line of why.
- The job page explains the number: matches and gaps, the job's skills against yours, every part of the score with its maximum, the caps and floors applied, and what held it back.
- Accuracy over coverage: no skill, pay figure or company fact is shown that the job or our data does not state.

Non-goals:
- Company enrichment (size, type, HQ, founded, ratings, an About-company section): a later phase (owner, 18 Nov). The reference got exactly this wrong (Abnormal "1-10 people in Runcorn", Rubrik "a startup").
- Changing any score, tier, filter or ranking. The breakdown is a read-out of today's scorer.
- Gradients and emoji (DESIGN.md rules hold for both). Colour is in scope since 18 Nov (owner: "there is no color in this"): see 11, item 5.
- Pay parsed from description prose.

## 2. Facts the design rests on (code read, 18 Nov 2026)

- `scoreInBand` and `scoreByMeaning` (`src/modules/jobs/match.ts:275-389`) compute title/meaning, skills, experience and location points, a years ceiling, and (by meaning) a verdict floor; `scoreFeatures` adds the gate (`bandMiss`) and `UNSTATED_CAP = 74`. Only `score`, `reason`, `requiredYears` and `skillHits` are returned.
- `FeedJob` (`match.ts:46-69`) already carries `score`, `tier`, `reason`, `skillHits` (≤ 4), `stage`, `track`, `hint`, `requiredYears`; the card shows a tier word with no number (`MatchBadge`, `src/components/ui/marks.tsx:94-113`) and two chips (`job-card.tsx:59-65`).
- `skillHits` = the profile's `skills` list found in the job. Skills that appear only in the resume text are not counted, so a "missing" list built on it would claim a skill the user has.
- Nothing extracts a job's own skills. `Job.terms` (trigger `job_terms`) holds the job's distinct words, split as the skill matcher splits text; multi-word terms ("spring boot") are not single terms.
- No pay is stored anywhere (`schema.prisma` Job, 192-237); the boards' payloads are kept in `Job.raw`.
- The job page (`src/app/(app)/jobs/[id]/page.tsx`) reads its match from `listFeed` (line 130), so anything on `FeedJob` reaches the page for free.
- Ingest writes every job through one `fields(job)` function (`src/modules/jobs/ingest.ts:71-91`); `tagPosting` and `classifyTitle` run there.
- Phase L planned a ≈400-term tech vocabulary for resume keywords (`docs/resume-tailoring/TDD.md` code map, L2), not yet built.

## 3. Options and decision

Job skills (owner: "a mix of both … it should never make things up, it should be accurate"):

| Option | Accurate | Cost | Required vs optional |
|---|---|---|---|
| A. Fixed vocabulary, literal match | never invents; misses terms outside the list | free, at ingest | no |
| B. Model lists the skills | can invent or rename | one call per job | yes |
| **C. A finds, the model only labels A's terms** | never invents (enum of A's terms) | one call per job, cached | yes, when the call succeeds |

Decision: **C**. The vocabulary is the only source of skill names; the model's schema is an enum of the terms A found, so it cannot add one. A failed or missing label shows the terms unsplit as "The job mentions".

What the user has: profile `skills` **plus** the resume text, both alias-aware. A job skill is "missing" only when neither has it.

Pay: structured board fields only (Greenhouse pay ranges, Ashby compensation, Lever `salaryRange`); each verified on a live fetch in M5 before it is trusted; no prose parsing.

## 4. Architecture

### 4.1 Components

| Component | File | Role |
|---|---|---|
| Vocabulary | `src/modules/jobs/skills.ts` | `TECH_VOCAB` (≈400 terms: languages, frameworks, databases, clouds, tools) with aliases (JS/JavaScript, Node/Node.js, Postgres/PostgreSQL, K8s/Kubernetes); shared with Phase L L2. |
| Job skills | `skills.ts jobSkills(title, description)` | Canonical vocabulary terms that appear in the text on word boundaries ("Java" never inside "JavaScript"), in order of first appearance, ≤ 20. |
| Candidate skills | `skills.ts candidateSkills(profile)` | Canonical terms from `profile.skills` and the resume text, plus the profile's own skills not in the vocabulary (lower-cased). |
| Skill levels | `semantic.ts jobSkillLevels(jobs)` | One batched `callJson` per ≤ 20 jobs: for each job, which of its found terms are required. Schema built at call time as an enum of that job's terms. |
| Breakdown | `match.ts scoreInBand / scoreByMeaning / scoreFeatures` | Also return `breakdown` (4.3). No score change. |
| Pay | `src/modules/jobs/salary.ts` | `salaryOf(source, raw)` → `{min, max, currency, period} \| null`; `formatSalary` ("₹15L – ₹30L", "$120k – $150k / yr"). |
| Card | `src/components/patterns/job-card.tsx`, `src/app/(app)/feed/swipe-deck.tsx cardData` | Section 5. |
| Job page | `src/app/(app)/jobs/[id]/page.tsx` | Section 5. |

### 4.2 Queues

No new queue. Skill levels run in the existing `ingest` worker job after the embed step, for new and changed jobs with no current label (`skillsHash ≠ contentHash`), India-eligible first, capped per run (`SKILL_LEVELS_PER_RUN`, default 2,000); a backfill script covers stored jobs.

### 4.3 Data model (Prisma additions, one hand-written migration, applied with `prisma migrate deploy` only)

```prisma
model Job {
  // …
  skills          String[] @default([])   // M2: vocabulary terms the posting names (jobSkills)
  skillsRequired  String[] @default([])   // M3: the subset the model labelled required
  skillsHash      String?                 // M3: contentHash the labels were made from; null = not labelled
  salaryMin       Int?                    // M5: from the board's structured pay only
  salaryMax       Int?
  salaryCurrency  String?                 // ISO 4217
  salaryPeriod    String?                 // year | month | hour
}
```

`FeedJob` gains:

```ts
breakdown: {
  parts: Array<{ key: "work" | "skills" | "experience" | "location"; label: string; points: number; max: number; note: string }>;
  adjustments: Array<{ key: "years_cap" | "unstated_cap" | "verdict_floor"; label: string; effect: number }>; // effect = score change it made
};
skills: { have: string[]; missing: string[]; split: boolean }; // split = missing holds required terms only
seniority: string | null;
salary: string | null; // formatted
```

Invariant: `clamp(sum(parts.points)) + sum(adjustments.effect) === score`.

Labels (our words, not the reference's): "The work" (by meaning: the agent's verdict plus closeness, max 60; without a vector: track and title, max 40), "Skills" (by meaning max 10; without max 30 or 40), "Experience" (20), "Location" (10); "Asks N more years than you have" (years cap), "States no years or level" (cap 74), "The agent's verdict" (floor).

### 4.4 Sequence: a job from ingest to card

```
ingest fields(job): skills = jobSkills(title, description); salary* = salaryOf(source, raw)
ingest run end:      embed new/changed → jobSkillLevels(unlabelled, ≤ SKILL_LEVELS_PER_RUN) → skillsRequired, skillsHash
listFeed:            feedRows selects skills, skillsRequired, skillsHash, contentHash, salary*, seniority (no description)
                     candidate = candidateSkills(profile) once per feed
                     have = job.skills ∩ candidate; missing = (split ? skillsRequired : skills) − candidate
                     scoreFeatures → score, reason, breakdown
card / job page:     render from FeedJob
```

### 4.5 Checks

- `skillsRequired ⊆ skills`, enforced by the schema enum and again by a filter before write.
- A missing term is never in the candidate set (both computed by the same canonicaliser).
- Salary shown only when `min` or `max` is a positive integer and the currency is known.

### 4.6 Security and privacy

The model gets the job's title, ≤ 3,000 characters of its description and its found terms; never resume text or profile data (the comparison with the user is code). No resume text is logged.

### 4.7 Failures

Skill-level call fails or times out: the job keeps `skillsHash = null`; the card shows unsplit terms as "Not on your resume"; the next run retries. Salary field malformed: `null`, logged by board with no values.

### 4.8 Observability

Ingest log line: `skills labelled=N failed=N`; `scripts/job-skills-report.ts` (M3): jobs with skills, average terms, labelled share, top missing terms for a profile (counts only).

### 4.9 Code map

| File | Change | Task |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/<ts>_job_skills_salary/` | columns 4.3 | M2 (M3, M5 add theirs to the same pattern) |
| `src/modules/jobs/skills.ts` | new | M2 |
| `src/modules/jobs/ingest.ts` | `fields(job)` adds skills, salary; run end labels skills | M2, M3, M5 |
| `src/modules/jobs/semantic.ts` | `jobSkillLevels` | M3 |
| `src/modules/jobs/salary.ts` | new | M5 |
| `src/modules/jobs/match.ts` | breakdown, `FeedJob` fields, `feedRows` columns | M4 |
| `scripts/backfill-job-skills.ts`, `scripts/job-skills-test.ts`, `scripts/score-breakdown-test.ts`, `scripts/salary-test.ts`, `scripts/job-skills-report.ts` | new | M2–M5 |
| `design/job-card.html`, `design/job.html` | new mockups | M1 |
| `src/components/patterns/job-card.tsx`, `src/components/ui/marks.tsx`, `src/app/(app)/feed/swipe-deck.tsx` | card | M6 |
| `src/app/(app)/jobs/[id]/page.tsx` | job page | M7 |
| `docs/ARCHITECTURE.md` §4, §6.2, §6.3; `docs/DESIGN.md` Screens | records | M2–M7 |

### 4.10 Env

`SKILL_LEVELS_PER_RUN` (default 2000; 0 turns labelling off).

## 5. UI

Mockups in M1 are the spec once the owner approves them (`design/job-card.html`, `design/job.html`).

Card, top to bottom (fixed height; may grow from `clamp(400px, …, 470px)`, settled in M1):
1. Logo, company, "via Greenhouse"; right: the score number with its tier word (Strong fit / Good fit / Stretch), lime fill as today.
2. Title (2 lines), "Posted 3d ago" and New.
3. Chips, wrapping to at most 2 rows: place, work mode, experience ("Fresher", "2+ yrs"), pay when published, stage (Startup / Mid-size / MNC).
4. Skills: up to 3 the user has (check icon, ink tint) and up to 2 missing (outline, muted), "+n" for the rest. Heading "Missing" when split, "Not on your resume" when not.
5. Why: one line, the reason's first sentence.
6. Board line and "See details".

Job page, top to bottom:
1. Header: logo, company, title, posted; score ring with number and tier word; facts (place, work mode, experience, pay, stage, board); Apply and Skip.
2. Why this is a match: the reason as the summary; Matches (✓) from parts at ≥ 70 % of their max; Gaps (✗) from parts below 50 %, adjustments that lowered the score, and the missing required skills; a next step when skills are missing ("Used Java? Add it to your profile so your agent can say so", link to the profile).
3. Skills: "On your resume" and "Not on your resume" (required first, then mentioned).
4. About the role: `describe()` as today.
5. How we got to N: one row per part (label, note, points / max), each adjustment, the total; "What held it back": the part with the largest shortfall, or the cap that applied.

States: no skills found → the skills row and section are left out (never "0 skills"); no pay → no chip; unlabelled → unsplit heading.

## 6. API

No new route. `GET /api/jobs` returns the larger `FeedJob`.

## 7. Testing

- `scripts/job-skills-test.ts` (M2): fixtures for word boundaries (Java / JavaScript, Go in "good", C in "C++"/"C#", R), aliases, multi-word terms, and that every returned term occurs in the text.
- `scripts/job-skills-report.ts` and a hand check (M3): 20 real jobs, printed terms, required, have and missing; pass = 0 terms absent from the text, 0 missing terms present on the resume, labels judged reasonable on ≥ 18 of 20.
- `scripts/score-breakdown-test.ts` (M4): the invariant in 4.3 on the `match-test.ts` cases and on 200 real feed jobs; `feed-sql-test.ts` still passes (no score changed).
- `scripts/salary-test.ts` (M5): one recorded payload per board with pay and one without; formatter cases.
- UI (M6, M7): the dev server at 390 px, light and dark; screenshots beside the mockups; a job with no pay and no labels.

## 8. Rollout

M2 and M5 store data without showing it; M3 labels in the background; M4 is a read-out. M6 and M7 switch the UI on once the backfills have run.

## 9. Risks

- The vocabulary misses a term a job needs (false "nothing missing"). Mitigation: the list is reviewed against the top terms of 500 India jobs in M2; missing is only ever under-reported, never invented.
- Common words that are also tech names ("Go", "R", "Spring", "Rust" in prose). Mitigation: those terms match only in their tech spellings or near another tech term, covered by fixtures.
- Card height: more content in a fixed card. Mitigation: M1 settles the height and clamps.
- Labelling cost: one call per ≤ 20 jobs; measured in M3 against the open-job count.

## 10. Tasks

[docs/job-match/TASKS.md](TASKS.md), M1 → M7.

## 11. Decisions closed with the owner (18 Nov)

1. Company: only what we store (Startup / Mid-size / MNC); enrichment is a later phase.
2. Pay: shown only when the board publishes it.
3. Skills: vocabulary finds, the model only labels; never invent; compare against the resume as well as the skills list.
4. The reference's content; its look only where item 5 says.
5. Colour carries meaning only (owner, 18 Nov). The ink-and-lime mockup read as flat ("there is no color in this"); a six-hue version read as random ("a lot of random colours … looks vibecoded"). Settled: neutrals plus two meanings. **Lime** = you have it / it's good (skills you have, matches, Strong fit, Apply, New). **Rose** = a gap (missing skills, gaps, an experience ask over yours, a part under half its maximum, "What held it back"). Everything else is grey: chips, company stage, Good fit, the reason box. Pay stands out by an outline, not a colour; Stretch is a dashed outline. Tokens added to `globals.css` in M6: `ok-bg` / `ok` (light `#eefad0` / ink, dark `#283212` / `#d9f56e`), `gap-bg` / `gap` (light `#fdeaea` / `#a83a3a`, dark `#3a1f21` / `#f0a6a6`). Rose is the one addition to DESIGN.md "Colour"; M6 records it there. Spec: `design/job-card.html`, `design/job.html`.

## 12. Sources

Owner's screenshots (18 Nov): five reference feed cards and one reference job page. Code: `match.ts`, `semantic.ts`, `ingest.ts`, `job-card.tsx`, `jobs/[id]/page.tsx` at commit 75a0e9b.
