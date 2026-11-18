# Phase N tasks — a match score the skills decide

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) Phase N lists these one line each. Order N1 → N2 → N3.

<a id="n1"></a>
### [x] N1 — Tracks: no QA or DevOps from tools alone, ML/AI from AI skills
Do: `functions.ts tracksFromProfile` and `SKILL_TRACKS`; `semantic.ts judgeBatch` floor wording; the owner's saved tracks set to the new suggestion.
Design: [4.2 Tracks](TDD.md#42-tracks).
**Done when:** `match-test` PASS; the owner's profile suggests `ml_ai, fullstack, backend, frontend`; typecheck passes.
Done 18 Nov: owner's suggestion now `ml_ai, fullstack, backend, frontend` (was saved `fullstack, backend, frontend, qa`; saved tracks set to it, owner OK); other 9 profiles' saved tracks unchanged. `functions.ts tracksFromProfile`/`SKILL_TRACKS`, `semantic.ts` floor wording, confirm page "Your resume suggests … Use these".

<a id="n2"></a>
### [x] N2 — The score: work 50, skills 40, experience 10
Do: `match.ts` (`skillsPart`, both scorers, `scoreFeatures`/`scoreJob` inputs, the floor rule), `apply/lifecycle.ts candidateScore`, `jobs/[id]/match-sections.tsx`; ARCHITECTURE §6.3.
Design: [4.1 Score](TDD.md#41-score-100) · [5 UI](TDD.md#5-ui).
**Done when:** `match-test`, `score-breakdown-test`, `feed-sql-test` PASS; typecheck and lint pass on touched files.
Done 18 Nov: `match-test` 63 checks PASS (one fixture moved to the candidate's stack, one check added), `score-breakdown-test` PASS (388 cards, 11 profiles), `feed-sql-test` PASS on all 10. Floor needs half the needed skills and two shown; shares count ≥ 3 required / 5 named. `match.ts skillsPart`, `lifecycle.ts`, `match-sections.tsx`, ARCHITECTURE 6.3.

<a id="n3"></a>
### [x] N3 — Measure on real feeds
Do: `scripts/feed-audit.ts` (`--skipped`, per-part columns); audit before and after on every real profile.
Design: [7 Testing](TDD.md#7-testing).
**Done when:** the owner's feed has no QA card without the Track filter, AI / full-stack / backend at the top, and the filler jobs (Training Content Developer, Survey Programmer) under 40; no other profile loses more than half its cards.
Done 18 Nov: owner's feed 0 → 27 cards, all ML/AI, top "AI Governance", "Full Stack — AI & Automation", "AI Engineer" (Motive); skipped list 29 → 3, no QA, filler (Training Content Developer, Survey Programmer, PlantPAx) gone; `feed-audit` 0 off-target on 10 profiles, smallest change 40 → 32 cards. `scripts/feed-audit.ts --skipped`.
