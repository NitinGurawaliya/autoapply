# Phase L tasks — resume tailored to each job

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) Phase L lists these tasks one line each and links here; this file holds the full entry per task: Do, the design sections it builds, Done when, and the `Done <date>:` line once it lands. Mark `[~]` / `[x]` here first, then on the root line.

Order L1 → L2 → L3 → L4 → L5 → L6 (L2 and L3 may swap). One session each, plan first, the Done-when check run and its output pasted, `npm run typecheck && npm run lint`. Migrations by hand, applied with `prisma migrate deploy` only (never `migrate dev`/`diff` against Neon). Never log resume text, phones or emails. Owner decisions are closed in TDD §11 (5 Nov): match the user's own style, opt-in, 50/50 split, "Tailored" label.

<a id="l1"></a>
### [ ] L1 — Structured resume (ResumeDoc)
Do: `Profile.resumeDoc`, `resumeDocFrom`, `resumeDocError`, `resumeStyle` in `prisma/schema.prisma` with a hand-written migration, and ARCHITECTURE §4 in the same change; `src/modules/profile/resumeDoc.ts` (Zod schema, `assignIds`, `docText`, `docHash`, `buildResumeDoc(userId)` with the normalised multiset coverage check); `readPdf(bytes) → {text, pages}` exported from `parseResume.ts`; both exported from `src/modules/profile/index.ts`; `scripts/resume-doc-test.ts`.
Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-measured-5-nov-2026) · [4.3 Data model](TDD.md#43-data-model) · [4.4 Building the ResumeDoc](TDD.md#44-building-the-resumedoc-l1) · [4.9 Security](TDD.md#49-security-and-privacy).
**Done when:** `npx tsx scripts/resume-doc-test.ts` (read-only over every profile in the DB, plus `nitin_resume_1.pdf` as an arg) prints PASS with ≥ 9 of 11 resumes over the chosen thresholds (starting at 92 % resume→doc and 95 % doc→resume; per-resume numbers only, no text), and the fixture with a dropped section fails coverage; the chosen thresholds go in the Done line; the migration is applied with `migrate deploy`; typecheck and lint pass.

<a id="l2"></a>
### [ ] L2 — Tailoring plan and the truth checks
Do: `timeoutMs` and `maxTokens` options in `src/lib/llm.ts` `callJson` (existing callers unchanged); `src/modules/apply/tailor/plan.ts` (`planTailoring`, `TailorPlan` schema, prompt); `check.ts` (`applyPlan` with checks N, T, K, L, O, the summary rule with `floor(yearsExperience)` and the structure rules, returning `TailoredDoc`, `changes`, `refused`; no Prisma import); `aliases.ts`; `vocab.ts` (≈400 tech terms); `keywords.ts` (`jobKeywords`, `coverage`); move `mentions` to `src/modules/jobs/mentions.ts` (lower-case contract documented) and import it in `match.ts`; `scripts/tailor-check-test.ts` (offline) and `scripts/tailor-plan-live.ts` (model).
Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-measured-5-nov-2026) · [3 Options and decision](TDD.md#3-options-and-decision) · [4.1 Components](TDD.md#41-components) · [4.5 The tailoring plan](TDD.md#45-the-tailoring-plan-l2) · [4.8 Checks](TDD.md#48-checks-code-tailorcheckts-all-pure).
**Done when:** `tailor-check-test` PASS with ≥ 20 cases. Refused: every invented number, tool, company, out-of-table rename, dropped or reordered role, unlisted summary skill, over-long line, a new tool at the start of a sentence, and "3+ years" for 2.5 years. Kept: alias rename, bullet reorder, promote-from-bullet, faithful rewrite. The feed's existing match check still passes after the `mentions` move. `tailor-plan-live` on 5 real jobs × 2 resumes: 0 whole-plan refusals, refused lines ≤ 15 %, plan p90 ≤ 12 s, keywordsAfter ≥ keywordsBefore on every job (numbers printed, no resume text). Typecheck and lint pass.

<a id="l3"></a>
### [ ] L3 — The user's style, template and PDF renderer
Do: `src/modules/apply/tailor/style.ts` (`extractStyle` with `pdfjs-dist` and `@napi-rs/canvas`, both already installed with `pdf-parse`; confidence and the preview fidelity check); `src/modules/apply/tailor/fonts/` (bundled OFL/Apache fonts and licences); `src/modules/apply/tailor/render.ts` (`renderHtml(doc, header, style)`, `renderPdf(html, dropOrder)` on its own headless Chromium behind one shared launch promise, fit-in-page trimming before a single `page.pdf()`, `closeRenderer()`, read-back with `readPdf`); `scripts/tailor-render-test.ts`, `scripts/tailor-style-test.ts`.
Design: [3 Options and decision (template)](TDD.md#3-options-and-decision) · [4.7 Rendering](TDD.md#47-rendering-l3) · [4.7a The user's style](TDD.md#47a-measuring-the-users-style-l3) · [4.8 Checks: R read back](TDD.md#48-checks-code-tailorcheckts-all-pure).
**Done when:** `tailor-render-test` PASS: a one-page fixture renders to 1 page; read-back ≥ 95 % of doc tokens with name, email, every company and title present; render ≤ 2 s after launch; an over-long fixture is trimmed to its page budget in the defined order; two renders at once share one browser; it passes with `DEMO_HEADED=1` set. `tailor-style-test` prints confidence and fidelity numbers for every stored resume plus `nitin_resume_1.pdf` (no text), classifies the photo-header and two-column fixtures right, and the owner judges original and preview side by side for 10 resumes with at least 7 "look like mine". Typecheck and lint pass.

<a id="l4"></a>
### [ ] L4 — Tailor on every run: doc queue, cache, wait cap, event
Do: `TailoredResume` model (with `version`, `sha256`, `building` status and the User cascade), hand-written migration; `src/modules/apply/tailor/index.ts` (`tailorResume`: write-once row keyed by `userId, jobId, docHash, TAILOR_VERSION`, waits on a fresh `building` row, never throws, checks the user still exists before `storage.put`); the `resume-doc` queue (`src/lib/queue.ts`, `src/worker/handlers/resume-doc.ts`, singleton per user, also measures the style and renders the preview), enqueued for opted-in users only: from `src/app/api/answers/route.ts` when `tailor_resume` is saved as Yes, from `saveParsedResume` and by the runner; the `tailor_resume` key in `src/modules/answers/keys.ts`; `src/modules/apply/runner.ts` (`chooseArm` from `TAILOR_RESUME`, `TAILOR_SHARE`, the opt-in `tailor_resume` = Yes and `style_unsupported`, start at run start, `TAILOR_WAIT_MS` at `uploadNow`, bytes swapped with the name kept `resume.pdf`, the resume fill row's value, `resume` event with `sha256`, shadow not awaited); `src/worker/index.ts` closes the renderer; `resumeSha256` stored by `src/app/api/mock/submit/route.ts` and `src/app/mock/schema.ts`; `scripts/tailor-smoke.ts`; ARCHITECTURE §6.5, new §6.21, §9 and §11.
Design: [4.2 Queues](TDD.md#42-queues) · [4.3 Data model](TDD.md#43-data-model) · [4.6 Sequence](TDD.md#46-sequence-one-application-l4) · [4.10 Failure handling](TDD.md#410-failure-handling) · [4.11 Observability](TDD.md#411-observability) · [4.12 Code map](TDD.md#412-code-map) · [4.13 Env](TDD.md#413-env-architecture-11-additions).
**Done when:** `tailor-smoke` PASS on `/mock/greenhouse` with a test profile:
- with `TAILOR_RESUME=on` the mock submission's `resumeSha256` equals `TailoredResume.sha256` and the `resume` event says tailored;
- a second run reuses the row (no plan call) and sends the same sha256;
- `TAILOR_WAIT_MS=1` sends the original with reason `late` and the application still submits;
- a profile without a doc sends the original with `doc_building` and gets exactly one `resume-doc` job;
- `shadow` sends the original and the row still appears;
- a profile without `tailor_resume` = Yes is never tailored (arm `off`), and saving Yes enqueues one `resume-doc` job;
- `TAILOR_RESUME=off` writes no `TailoredResume`;
- deleting the test account removes its rows and files.

`scripts/submit-guard-test.ts` and `guess-test` still PASS; typecheck and lint pass.

<a id="l5"></a>
### [ ] L5 — "Resume sent" on the application page, switch on Account
Do: a `resume-sent` component on `src/app/(app)/applications/[id]/page.tsx` (tailored or original, keywords before/after, "What changed", Download, loading/empty/error), its label in `src/lib/event-labels.ts`; Account: "Tailor my resume to each job" switch, off by default (opt-in), writing `tailor_resume` (key from L4), "Preparing a preview" state, Preview link shown when `storage.exists(previewKey)` (new method in `src/lib/storage.ts`), unsupported notice.
Design: [5 UI](TDD.md#5-ui) · [6 API](TDD.md#6-api); `docs/DESIGN.md`, `design/detail.html`.
**Done when:** on the dev server (webpack launch entry):
- a tailored mock application shows the row in light and dark at 390 px, matching the detail patterns, with "What changed" lines and a working download;
- an original-with-reason application shows the grey line;
- an application from before L4 shows no row;
- Preview downloads the preview PDF once the doc is built and is hidden before;
- a profile with `resumeDocError` (including `style_unsupported`) shows the notice and the switch is disabled;
- a new user sees the switch off;
- the switch set to No makes the next run send the original (event `arm: off`).

Typecheck and lint pass.

<a id="l6"></a>
### [ ] L6 — Shadow, measure, switch on
Do: `scripts/tailor-report.ts`; the owner's accounts opt in first; run the laptop worker with `TAILOR_RESUME=shadow` for ≥ 40 real applications (check runs in flight before each restart); the owner reviews 10 tailored PDFs against the originals; then `on` with `TAILOR_SHARE=0.5` (owner, 5 Nov); `docs/PRD.md` FR11 and §8, and the `CLAUDE.md` hard rule ("A tailored resume never adds a fact …").
Design: [7 Testing](TDD.md#7-testing) · [8 Rollout](TDD.md#8-rollout) · [9 Risks](TDD.md#9-risks).
**Done when:** `tailor-report` over the shadow window shows ready-by-upload ≥ 90 %, whole-plan refusals ≤ 5 %, refused lines ≤ 15 %, and 0 read-back failures on supported resumes, with latency p50/p90 printed. The owner finds no untrue line in the 10 reviewed. The worker runs with `TAILOR_RESUME=on`, and the first real tailored submit's `resume` event is pasted. Docs updated.
