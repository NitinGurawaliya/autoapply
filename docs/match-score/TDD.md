# Phase N — A match score the skills decide (TDD v1, 18 Nov 2026)

Owner, 18 Nov: "we are giving too much weightage to the exp location and other things… that's why I'm getting so many testing jobs in my feed." Tasks: [TASKS.md](TASKS.md).

## 1. Goals and non-goals
Goals:
- The feed ranks by what the job is and whether the user has what it needs: the work (the agent's verdict and closeness) and the job's skills decide; passing a gate earns nothing.
- A developer's or AI engineer's tracks never include QA or DevOps because their resume lists test runners or cloud tools.
- The breakdown on the job page keeps adding up to the score (Phase M4 invariant).

Non-goals: no new judge prompt (no re-judging every user), no new gates, no change to `min_match_score`, the years ceiling, the unstated cap or the tiers.

## 2. Facts the design rests on (measured 18 Nov, the owner's profile)
- Saved tracks `fullstack, backend, frontend, qa`; title "AI Engineer" (classifies `ml_ai`), 45 skills, 1 year. `qa` came from five test tools (`tracksFromProfile`, three suffice); `ml_ai` is missing because saved tracks win over the suggestion (`tracksOf`).
- The track gate shut out all 84 open entry-level `ml_ai` jobs in India/remote on Greenhouse/Ashby (60 days); the "new" feed was empty, 29 skipped cards remained, 10 of the top 12 QA.
- `trackFloor` raises a job in one of the user's tracks to "close" (good, 20 points, floor 60) and writes "QA / Test work, like yours": code, not the model.
- Experience (14–20) and location (10) are already gates (`bandMiss`, the country filter), so every card got 24–30 points for passing them; "Training Content Developer" and "Survey Programmer" reached 41–47 (minimum 40) with work 17/60 and skills 0.
- Skills were 10 points: the user's own skills the posting names, out of 8, so a QA posting naming Selenium, Pytest and Python scored full.

## 3. Options and decision
- A. Retune the old weights only: still pays for passing gates and still counts the user's skills, not the job's needs.
- B. Drop experience and location points, score skills as coverage of the job's own skills (Phase M2/M3 data), keep the work as the biggest part. **Chosen.**
- C. Re-judge with a stricter prompt: costs a re-judge of every user and the model drifted on batches before (semantic.ts 19 Oct note); not needed once tracks are right.

## 4. Architecture
### 4.1 Score (100)
| Part | Points |
|---|---|
| The work | 50: verdict strong 35 / good 25 / stretch 10 / unjudged 14, plus closeness up to 15. No vector: same track 35, adjacent 20, +5 per skill in the title, max 50 |
| Skills | 40: with labels, 30 × share of required skills the user shows + 10 × share of all named; without, 40 × share of all named; the shares count at least 3 required and 5 named (one known skill is never full marks); a posting naming no tech 15 |
| Experience | 10: asks ≤ yours 10, one more 7, two more 3, not stated 5 |
| Location | none: the country filter and preferred places stay a gate; the place still conditions the verdict floor |

"Shows" is `candidateSkills` (profile skills plus resume text), as on the card. The verdict floor (strong 75, good 60) needs the years to fit, the place to fit, and the user to show at least half the needed skills (required, or all named without labels) and at least two of them; a posting naming no tech gets no floor. The ceiling and the unstated cap stay.

### 4.2 Tracks
`tracksFromProfile`: QA and DevOps come from skills only when no title gave a track; ML/AI also reads LangGraph, OpenAI/Anthropic API, multi-agent systems, AI agents, prompt engineering, pgvector, vector databases. The floor's reason reads "QA work, one of your tracks" rather than "like yours" (new verdicts; cached ones keep their words until the resume or tracks change). The owner's saved tracks are replaced by the new suggestion (owner's OK, 18 Nov).

### 4.3 Data and code map
No schema change. `match.ts` (`skillsPart`, `scoreInBand`, `scoreByMeaning`, `scoreFeatures`/`scoreJob` take the job's skills and `shows`), `apply/lifecycle.ts candidateScore` (same inputs, so a swipe scores as the card), `functions.ts tracksFromProfile`, `semantic.ts judgeBatch` wording, `jobs/[id]/match-sections.tsx` (no location row), `scripts/feed-audit.ts --skipped` and per-part columns.

## 5. UI
"How we got to N" shows three rows (The work /50, Skills /40, Experience /10). Skills note: "You have 3 of its 5 required skills and 2 of 6 nice to have".

## 7. Testing
`match-test`, `score-breakdown-test`, `feed-sql-test` PASS; `feed-audit` before and after on every real profile, plus the owner's skipped cards: no QA card for the owner without the Track filter, AI/full-stack/backend at the top, filler under 40.

## 9. Risks
Fewer cards for users whose jobs name little tech (15-point middle). Jobs whose real needs are outside the vocabulary (SIP, VoIP) score on the terms we know.

## 10. Tasks
N1–N3 in [TASKS.md](TASKS.md).

## 11. Decisions closed with the owner (18 Nov)
1. Weights as 4.1 ("yes build it" on the proposed table). 2. The owner's tracks become ML/AI, full-stack, backend, frontend. 3. No re-judge.
