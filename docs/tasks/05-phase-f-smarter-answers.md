# Phase F — Smarter answers (ask only what we cannot know)

Full entries of this phase. The index is [docs/TASKS.md](../TASKS.md). Status is marked here first, then on the index line.


Plan (v2, agreed 9 Oct): retrieve, then verify. Every answered question is stored with its embedding (pgvector in the same Neon database) and the job it was answered for. For each form question: exact/canonical answer → recall the user's 5 closest past questions → one AI verify per form ("same question, same company/city/country/skill?") → hard parameter checks in code for risky questions (work authorization and sponsorship per country, worked-at per company, office per city, sensitive, EEO) → derive with evidence → essay draft (one-time permission) → fit to the form's options → ask, preferably before the run. Similarity alone never fills an answer. Reused/derived answers on by default, each with a badge and its reason. Every step re-runs the replay scoreboard (auto-answer rate up, wrong sensitive answers = 0).

<a id="t49"></a>
### [x] T49 — Embedding experiment (decision gate)
`embed()` in `src/lib/llm.ts`; `scripts/embedding-experiment.ts` prints nearest neighbours and scores for the real users' saved questions, true paraphrases vs look-alike traps. **Done when:** a retrieval cut-off is chosen from the numbers and the traps are shown to need the verify step.
Result (9 Oct, 197 real wordings, `text-embedding-3-small`): true paraphrases score as low as 0.599 ("How did you hear about us?" ~ "How did you learn about this job?"; zip-code wordings 0.718) while traps score as high as 0.834 ("work from our US office" ~ "…London office"). No threshold separates them, so the verify step is required. Retrieval: top 5 candidates with score ≥ 0.54 go to verify.

<a id="t50"></a>
### [x] T50 — Replay scoreboard
`scripts/replay-questions.ts`: leave-one-out replay of every saved wording; % answered without asking, % agreeing with the user (yes/no compared by meaning), wrong sensitive answers. **Done when:** the baseline prints for the real profiles.
Baseline (9 Oct, today's resolver, 3 real users): 237 questions; 62 answered without asking (26 %), of which 25 agree with what the user said (40 %); 175 still asked (74 %); **7 wrong sensitive answers**, all one global `willing_to_relocate` / `work_authorization` answer reused for a different place (Bangalore, Austin, a US-person check). That is the parameter problem T52 fixes; the target is 0.

<a id="t51"></a>
### [x] T51 — pgvector storage and backfill
Extension, `Answer.context`, `Answer.embedding`, `LabelEmbedding` cache; `modules/answers/memory.ts` `remember` / `recall`; answer writes record the job context; `scripts/backfill-embeddings.ts`. **Done when:** recall returns the right neighbours for sample wordings and the backfill ran.
Done 10 Oct: migration `answer_memory` (pgvector on Neon), `modules/answers/memory.ts`; `memory-smoke` PASS (paraphrases recalled first, London office recalls the US-office answer at 0.834 as expected, context kept, changed wording re-embedded); backfill embedded all 343 saved answers. ARCHITECTURE 6.19.

<a id="t52"></a>
### [x] T52 — Retrieve-then-verify in the run
`modules/answers/concepts.ts` (small risky catalog with parameters), `modules/apply/recall.ts` (async pre-pass in the runner, one batched verify per form, code-side checks) feeding `resolveValues`; source `matched`. **Done when:** replay answers the duplicate clusters, trap pairs are not reused, wrong sensitive answers = 0.
Done 10 Oct: replay 26 % → 34 % answered without asking, wrong sensitive answers 7 → 0 (risky questions with a country/company/place now need a verified answer about the same one; the old global answers caused all 7). recall-test PASS (paraphrases reused; US vs London office, UK vs US work authorization, MongoDB vs Thoughtworks, month vs year, yes/no vs open questions refused); recall-smoke PASS (mock form: notice period filled from another wording, `matched` with its basis, submitted without asking). Remaining disagreements are mostly the user's own conflicting answers, for T56.

<a id="t53"></a>
### [x] T53 — AI option mapping
Map a value onto the form's own options when `fitOption` fails; one option or none; sensitive/EEO values never changed. **Done when:** fixture cases pass and "does not fit" prompts drop in replay.
Done 10 Oct: `option-map-test` PASS (10 cases incl. refusals: an unlisted event without "Other", "60 days" with no such option), `option-map-smoke` PASS (mock: "Yes, I am authorized to work" filled as "Authorized", submitted without asking). The replay cannot measure this step (old forms' options were not stored); the mapping is exercised end to end instead.

<a id="t54"></a>
### [x] T54 — Derivation with evidence
Resume dates normalised and per-role skills; residence, previous employers and skill years derived with verified evidence; source `derived`. **Done when:** replay answers those questions with the right basis and zero sensitive/EEO derivations.
Done 10 Oct: replay 34 % → 46 % answered without asking; 0 wrong sensitive answers, 0 derivations on a forbidden kind; 12 derived answers contradict a saved answer and are listed for review (India-based profiles with saved "Yes, I live in the UK / worked at Snowflake"). `derive-test` PASS (18). Simplification: dates are normalised in code and role summaries are matched (model fallback picks existing roles only) instead of re-parsing every resume. Citizenship ("U.S. person") split from work authorization.

<a id="t55"></a>
### [x] T55 — Essay drafts
One-time permission `accept_ai_essays`; `modules/apply/essay.ts` drafts from resume + job only; "best project" saved once and editable; enforce `max_ai_drafts_per_application`. **Done when:** mock run fills an essay as `ai_draft`; a 4th draft is asked; drafts name no employer or school absent from the resume.
Done 10 Oct: `essay-test` PASS (15: detection, grounding check rejects an invented school, one permission question for all essays, "why us" never reused across companies, saved best project reused, the 4th essay asked, live drafts grounded); `essay-smoke` PASS (mock: permission asked once, then "Why this role?" drafted as `ai_draft` and submitted).

Decisions (10 Oct): conflicting saved answers are not reviewed, the newest wins; years-of-experience questions are always derived; essay drafts must also be numerically grounded (done, `essay-test` PASS).

<a id="t56"></a>
### [x] T56 — Ask before the run, fill in one go
Pre-scan Greenhouse `…/jobs/{id}?questions=true` for feed jobs (new `prescan` queue); ask never-seen facts at swipe time; "fill your gaps" screen; mid-run popup only as a de-duplicated fallback. **Done when:** a swiped Greenhouse job with a missing fact asks at swipe time and the run completes with no pause; feed coverage % shows.
Done 10 Oct: `precheck-smoke` PASS (mock: asked before opening the form, no browser; one answer released the other waiting application through the real route; the run then filled straight through; the pre-scan reported the gap, then full coverage). `gaps-test` PASS (two real US Greenhouse jobs' differently worded work-authorization questions → one gap "Are you legally authorized to work in the United States?"; answered via /api/gaps with the country; reused for a third US job, refused for a UK job). Live: the worker's pre-scan of the test account's 20 feed jobs ran end to end. Asked-at-swipe-time means seconds after the swipe, when the worker picks the job up, before any browser opens.

<a id="t57"></a>
### [x] T57 — Badges, basis and audit
`matched` / `derived` badges with their reason on the application page; governance counts answered-from-your-data vs asked. **Done when:** extended applications and governance smokes pass.
Done 10 Oct: "You · reused" and "Worked out" badges; the application page shows "Why: …" under every reused, worked-out or drafted answer; the governance page counts "Answered from your data" today next to "Questions asked". `applications-smoke` and `governance-smoke` extended and PASS.
