# AGENTS.md — SwipeApply

SwipeApply is a governed AI agent that applies to jobs for a candidate after they swipe right. The goal: a right-swipe ends in a submitted application, end to end, with no human step. Built for the AgentForge hackathon (3 Oct 2026) with the production architecture from day 1: Next.js web + a separate Playwright worker, Postgres (Neon), pg-boss queue, files in Postgres behind a storage interface, Google auth.

ARCHITECTURE.md is the source of truth. If you must deviate, update it in the same change and say why. What to read for a task is fixed in "Docs and the token budget" below: a section, never a whole doc.

## How to work

1. One task per session, picked from the index `docs/TASKS.md`; its full entry is the file the index line links. Mark `[~]` on start and `[x]` when the "Done when" check passes, in the entry first, then on the index line.
2. Tasks touching more than 2 files: explore, write a short plan (files, order), then implement. One-line changes: skip the plan.
3. Run the "Done when" check yourself and paste real output. Never claim a pass without running it.
4. Before finishing: `npm run typecheck && npm run lint`. Fix only what you broke.
5. Small diffs. No refactors outside the task. No libraries beyond the stack unless the task says so.
6. Blocked twice on the same error: write the error, what you tried, and your best guess to `docs/BLOCKERS.md`, then ask.

## Docs and the token budget

The docs are read by section, never whole. Measured 3 Nov: ARCHITECTURE.md is ~24k tokens, a TDD ~12k, the old single task list was ~22k; a task needs ~10k of all that. Budget: **under 15k tokens of docs before the first edit**, and no doc read twice in a session.

Map (what each file is for, and when it is opened):

| File | Holds | Open when |
|---|---|---|
| `AGENTS.md` | rules, process | always (your tool loads this; `CLAUDE.md` and `.cursor/rules/project.mdc` only point here) |
| `docs/TASKS.md` | the index: every task, one linked line | picking the task; never for context |
| `docs/<feature>/TASKS.md`, `docs/tasks/<phase>.md` | full task entries: Do, Design links, Done when, Done line | the one entry you work on |
| `docs/<feature>/TDD.md` | the feature's design | only the sections the entry's Design line links |
| `docs/ARCHITECTURE.md` | source of truth | only the sections the entry or the TDD names |
| `docs/PRD.md` | why the product exists, scope | writing a TDD, or a scope question |
| `docs/DESIGN.md`, `design/` | the UI spec | UI tasks only |
| `docs/INGEST_CONTRACT.md`, `docs/DEPLOY.md` | ingest rules, deploy | a task that touches them |
| `docs/OPERATIONS.md` | gotchas: lessons paid for in production (database, worker restarts, Ashby, dev server) | before a migration, a worker restart or redeploy, Ashby work, or when the dev server will not start |

Read order for a task, and stop as soon as you have what the task needs:

1. The task's entry (follow the link on its index line). Its Do line names the files; its Design line names the sections.
2. The sections it links, by heading: find the heading (`grep -n '^### 4.5'`), read that line range, nothing past the next heading.
3. The ARCHITECTURE sections those name, the same way.
4. The files the Do line names. If it names none, use a read-only helper agent if your tool has one, with the entry as its whole brief, and take back paths and line numbers, not file contents; otherwise search with grep.

Never: read a whole TDD, ARCHITECTURE.md or a task history "for context"; re-read a file you already have; paste a file into the conversation to summarize it.

## Design to tasks (the dev process)

Design docs and the task list are one process. No OpenSpec or other change-folder system: at this size (one owner, one agent session at a time) ARCHITECTURE.md is the spec, the TDD is the design, the task entry is the unit of work.

1. **A TDD before the work** for any phase or feature that needs research or touches more than two modules, in `docs/<feature>/TDD.md`, with the sections `docs/naukri/TDD.md` has: goals and non-goals, facts the design rests on, options and decision, architecture (components, queues, data model, state, sequences, checks, security, failures, observability, code map, env), UI, API, testing, rollout, risks, a pointer to the tasks, decisions closed with the owner, sources. Numbered headings, because tasks link to them. Tasks under two files need no TDD.
2. **Tasks beside the TDD, in `docs/<feature>/TASKS.md`**, one full entry per task under an anchor (`<a id="k1"></a>`): ID, title, a "Do" line that names the files, a "Design:" line linking the TDD sections it builds, a testable "Done when", and the `Done <date>:` line once it lands. The index `docs/TASKS.md` gets one linked line (`- [ ] [K1 — title](naukri/TASKS.md#k1)`), nothing more. Phases without a TDD keep their entries in `docs/tasks/<phase>.md` the same way. Neither file copies the design.
3. **The task that makes a decision updates ARCHITECTURE.md in the same change.** The TDD never becomes a second source of truth; once a decision is in ARCHITECTURE.md the TDD is history.
4. **A landed task gets a `Done <date>:` line** in its entry: date, what was measured (numbers), what changed (paths), three lines at most. The Done-when output is pasted in the session, not in the doc. That line is the record; nothing else about the session is written anywhere.

Writing back is as cheap as reading: a Done line, a status tick in two places, an ARCHITECTURE section when a decision changed, a `docs/BLOCKERS.md` entry of ten lines (error, tried, best guess) when blocked twice. No session notes, no summaries, no restating the task.

Agents: one session per task, fresh context each time (the entry carries everything). Helper agents only for reading (read-only, a narrow brief, paths back) or for an independent check the task names; never to re-derive what the entry already says. Reconsider change folders only if a second developer or parallel agent sessions work the same phase at once.

## Stack (do not swap)

Next.js 16 App Router (`src/proxy.ts`, not middleware) · TypeScript strict · Tailwind + shadcn/ui · Framer Motion · Prisma + Postgres (Neon) · pg-boss · Playwright (Chromium) · Auth.js v5 + Google · `lib/storage.ts` (Postgres FileBlob driver; S3 later) · OpenAI Chat Completions (`gpt-4o-mini`, `OPENAI_MODEL` to override) · Zod · pdf-parse · tsx.

## Commands

```
npm run dev            # web, http://localhost:3000 (Turbopack)
npx next dev --webpack # web on webpack, port 3000; use this in autoapply-main (docs/OPERATIONS.md)
npx next build --webpack && npx next start -p 3100   # production build, served on port 3100
npm run worker         # pg-boss worker (apply + ingest) — must be running for swipes to do anything
npm run ingest -- --days 7
npm run seed           # upsert Company rows
npm run typecheck && npm run lint
npx prisma migrate dev --name <name>
npx prisma studio
npx playwright test
```

## Hard rules (enforced in code, never only in prompts)

- Submit on a real job form ONLY when: the user right-swiped that job, `profile.isTest === false`, and `governance.check('submit')` passes. Test profiles (`isTest === true`) may only run against `/mock/greenhouse`; the runner blocks any other URL for them.
- Guess and send (owner, 4 Nov): an application goes out rather than waiting on the user. A required question nothing else answers gets the agent's best guess from the resume, profile, the user's own answers and the job (`modules/apply/guess.ts`, ARCHITECTURE 6.19), source `guessed`, shown as "Best guess" with its reason; a guess is never reused as the user's own answer. Never guessed: identity documents and numbers, date of birth, criminal record, signatures, EEO. Every filled value carries `source`: `resume | user | matched | derived | ai_draft | default | guessed` (`matched` = the user's answer to another wording, verified for this job; `derived` = proven by the profile/resume, with the evidence as basis). Only `cover_letter`, `free_text` and essay questions (`modules/apply/essay.ts`, drafted from the resume and job only, without a permission question first; a user who answered No to `accept_ai_essays` writes them) may be `ai_draft`, max `max_ai_drafts_per_application` per application.
- Sensitive keys (`current_ctc expected_ctc salary_expectation notice_period work_authorization needs_sponsorship willing_to_relocate`) are never AI-drafted: pay and notice come from onboarding's standing answers; a per-job authorization, sponsorship or relocation question nothing settles is guessed from citizenship, the job's country and the user's answers (guess and send).
- EEO keys default to "Decline to answer". Never guess gender, race, veteran or disability.
- Required privacy-notice, "my answers are true" and arbitration acknowledgements are ticked only under the user's standing permission (`accept_acknowledgements` = Yes, asked once); without it each is asked. Marketing opt-ins and certifications of facts (work authorization, age, record) are never auto-ticked. See `modules/apply/acknowledgement.ts`.
- Every governance check writes an `ApplicationEvent`. Blocked runs end in `status = blocked` with the rule name.
- Jobs come from public, no-login job APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Keka, Workday, Zoho Recruit) and, from Phase K on, from Naukri and LinkedIn through the user's own signed-in account (ARCHITECTURE §6.20). Phase K starts only after Phase J is done (T94–T97: Lever, SmartRecruiters and Keka in `APPLY_BOARDS`, the board report written). Signed-in sources: the user signs in themselves in the visible browser (handoff); we never ask for, type, store or log their password or OTP; we read only job listings and the user's own profile, never other people's profiles or messages.
- No data in local files: companies, jobs, profiles, answers, applications → Postgres; resumes, screenshots → `lib/storage.ts` (FileBlob table; never the filesystem). Only `lib/storage.ts` touches `FileBlob`. Temp files for Playwright uploads are deleted in `finally`.
- Resumes are personal data: never log resume text, phone numbers or emails.

## Code conventions

- Modules in `src/modules/<name>` export through `index.ts`; imported by both `src/app/api/*` and `src/worker/*`. Modules never import from `app/`.
- Playwright code lives only under `src/modules/apply` and runs only in the worker process. API routes enqueue; they never launch a browser.
- All LLM calls go through `lib/llm.ts callJson(schema, system, user, {cacheKey})`. JSON-only prompts validated with Zod. No direct OpenAI calls outside `lib/llm.ts`.
- Field mapping order: synonym regex → `FieldMappingCache` → LLM (then write cache). Standard fields must map without the LLM.
- The runner is stateless and re-runnable from the job URL. Never hold a browser open while waiting for the user.
- Errors: catch at the runner level; `attempt < max_attempts` → `retry` event + re-enqueue; else `failed` + `error` + `error` event. Browser closed in `finally`.
- Prisma `Json` columns: parse/validate with Zod in the module; UI never touches raw JSON.
- Dates stored in UTC; UI shows "x days ago".

## UI rules

- Mobile-first at 390px; centered, max-width 480px on desktop for feed and onboarding.
- The owner's design in `design/` is the spec: every screen matches it exactly, light and dark (colours, type, sizes, radii, shadows, motion). See `docs/DESIGN.md`.
- shadcn/ui components, tokens in `src/app/globals.css`, one accent color (lime, a fill only), no gradients, no emoji in UI.
- Every screen has loading, empty and error states.
- Feed card as in `design/feed.html`: company tile and name, posted time, role, "Why it fits", location and experience chips, lime match badge. Right = apply, left = skip, keyboard ← → too.
- Status in ink and lime only, as the design shows it: in progress = segmented progress plus the stage in words (animated); needs_input = lime "Needs you"; submitted = ink check, "Sent"; failed, blocked, cancelled = "Didn't go through", dashed outline with the reason.
- Source badges as in `design/detail.html` (icon plus outline): resume · you · you · reused · worked out · default solid, AI draft dashed. Reused, worked-out and drafted answers also show why (their basis).

## Testing

- `scripts/*-test.ts` and `*-smoke.ts` are the backend checks; each prints a PASS/FAIL line.
- `tests/smoke.spec.ts` is the end-to-end test on a test profile and the mock form (stretch T22).
- `DEMO_HEADED=1` makes the worker run Playwright headed so the demo shows the browser.

## Env

See `docs/ARCHITECTURE.md` §11. Never commit `.env`. Web uses `DATABASE_URL` (pooled); migrations and pg-boss use `DIRECT_URL`.

## Definition of done for the demo

`docs/PRD.md` §10. If a change makes the demo path (one real Greenhouse job with the presenter's real profile) less reliable, do not make it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
