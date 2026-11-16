# Hand-over: Phase M (more job boards) for another agent

Written 16 Nov 2026 for an agent picking this work up (Cline or any other). It points to the real docs rather than
copying them; read those for detail. Kept on this branch only, at the root (the repo's rules keep session notes out of `docs/`).

## 1. Where the work is

- **Branch `claude/nervous-heisenberg-6e5f28`**, this worktree:
  `C:\Users\USER\Desktop\projects\autoapply\.claude\worktrees\nervous-heisenberg-6e5f28`.
- 23 commits ahead of `main` (latest `b9e6fc0`), `main` merged in on 10 Nov. **Not pushed.**
- **Nothing of Phase M is on `main`**: no `docs/boards/`, no new code. Work on this branch, or branch from it, never from `main`.
- `.env` here is a copy of autoapply-main's and is gitignored; never commit it. `node_modules` is this worktree's own (`npm ci`).

## 2. The product (one paragraph)

SwipeApply: a candidate swipes right on a job and a governed AI agent applies for them, end to end.
- **Stack:** Next.js 16 web (Vercel, runs `main`) plus a separate Playwright worker, Postgres on Neon, the pg-boss queue, files in Postgres behind `lib/storage.ts`, Google sign-in.
- **Rules:** `CLAUDE.md` holds the hard rules. Real submits only after a right swipe, never for test profiles, and only when governance passes. Never guess identity or EEO answers. Sensitive pay and notice answers come from the user's standing answers.
- **Source of truth:** `docs/ARCHITECTURE.md`. Read it by section, never whole; CLAUDE.md "Docs and the token budget" says how.

## 3. What Phase M is

**Goal:** many more boards and companies for Indian tech job seekers, ranked by open India jobs unlocked per task. Two kinds of board:
- **Boards with public forms** (no sign-in) come first.
- **Boards needing an employer account** (Workday, SuccessFactors, Darwinbox) come later.

**Docs:**
- Design: `docs/boards/TDD.md`. Read by heading: §2 facts, §3.1 order, §3.3 discovery, §3.4 ranking, §3.5 bot policy, §4.5 the recipe for adding a board, §11 the owner's decisions of 9 Nov.
- Tasks: `docs/boards/TASKS.md`, one entry per task with Do, Design and "Done when", plus dated progress lines. Index: `docs/TASKS.md` (Phase M section).

**Owner decisions that shape everything** (TDD §11, 9 Nov):
- **Bot checks: "just like Ashby and Keka".** A visible Chrome window, the worker's own click, and a person takes over when a check appears. **Never hide automation or solve checks automatically:** no stealth flags, no solver services.
- India-only storage, except the older Greenhouse and Lever companies (`keepAbroad`).
- 30 submits per IP per hour; a model cap of 150 judgements per user per day.
- Email codes stay manual; account boards use a password the user sets.

## 4. How the boards work (code map)

- **Board registry:** `src/modules/jobs/boards.ts`. One entry per board: fetch, store rule (India-only), the allowed form host, slug rules, and discovery (crawl hosts, name lookup, minimum India jobs).
- **Fetchers:** `src/modules/jobs/fetchers/<board>.ts` read each board's public job API: Greenhouse, Lever, Ashby, Workday, Keka, Zoho Recruit, SmartRecruiters, Workable.
- **Ingest (M2):** `INGEST_MODE=tick`.
  - `src/worker/handlers/ingest-tick.ts` runs every 5 minutes. It embeds new jobs, refreshes feeds, deletes closed jobs older than 7 days, and queues due companies in batch inserts (`lib/queue.ts enqueueIngestCompanies`).
  - `ingest-company` reads one company. Tiers (`cadence.ts`): active every 3 h, open every 24 h, empty every 3 days, dead every 30 days, with back-off on failures.
  - `scripts/ingest-tick-now.ts` does the same read without the worker.
- **Daily board numbers (M1):** `modules/jobs/boardDay.ts`, cron at 23:30 UTC into `BoardDay`; `scripts/feed-report.ts --from/--to`.
- **Discovery and seeding (M3):**
  - `modules/jobs/discovery.ts` and `boardSeeds.ts`, run by `scripts/discover-boards.ts` (`--import <file>`, `--boards`, `--watch-all`, `--from list:<name>`, `--write`; without `--write` it is a dry run).
  - Allowed open lists with their licences: `slugSources/lists.ts` (MIT and CC-BY only; CC-BY-NC is refused).
- **Apply:**
  - `src/modules/apply/runner.ts` runs one application: questions before opening, inspect, resolve answers (`resolveForm.ts`), fill, governance `submit` check, submit, outcome.
  - Adapters live in `adapters/<board>.ts`, registered in `pick.ts`.
  - The boards that appear in the feed and can be swiped (`APPLY_BOARDS` in `modules/jobs/match.ts`): Greenhouse, Ashby, plus Lever, Keka and Workable only with `ENABLE_LEVER`, `ENABLE_KEKA` or `ENABLE_WORKABLE` set to 1.
  - Visible-window boards are listed in `lib/queue.ts HANDOFF_BOARDS` (ashby, keka, lever, workable).
- **Swipe and retry rules:** `modules/apply/lifecycle.ts` (`swipeRight`, `retryApplication`, `cancelApplication`), checked by `modules/governance` (`config/rules.json`: minimum match score 40, 120 a day, 3 per company per week).
- **Worker:** the Docker container `swipeapply-worker` on the owner's laptop. Image `swipeapply-worker:m-tick`, built from this worktree with `docker build -f Dockerfile.worker`. Run flags: `docs/DEPLOY.md` "Docker worker with a screen", plus `-e INGEST_MODE=tick -e ENABLE_LEVER=1 -e ENABLE_KEKA=1 -e ENABLE_WORKABLE=1`.

## 5. Where each task stands (16 Nov)

Open India jobs held, per board (13 Nov):

| Board | Open India jobs |
|---|---|
| Workday | 5,206 |
| Keka | 3,722 |
| Greenhouse | 2,741 |
| SmartRecruiters | 2,245 |
| Lever | 806 |
| Workable | 600 |
| Ashby | 449 |
| Zoho Recruit | 194 |
| **All boards (BoardDay 13 Nov)** | **15,965** (11,341 on 9 Nov) |

| Task | State |
|---|---|
| **M1** daily board numbers | Code done. The worker wrote BoardDay for 11, 12 and 13 Nov itself (on start, as the 23:30 run was missed). Left: confirm against the Done-when, tick it. |
| **M2** watch every company (tick mode) | Code done, deployed 10 Nov. First tick: 899 companies, 0 failed. Left: a full day of tick mode matching within 2%. |
| **M3** seed companies from the open lists | Dry run done: 7,913 live boards, about 2,245 India jobs. **Not written:** the owner said add them after the infrastructure is proven. Command and numbers are in the entry. |
| **M7** SmartRecruiters | **Parked.** DataDome blocks the worker's browser outright, headless and visible; no challenge to hand over. The job reader works. See `docs/BLOCKERS.md`. |
| **M12** Workable | **Blocked at Submit.** Below. |
| M13 Zoho apply, M14 long tail, M4 continuous discovery, M16–M19 | Not started (order in `docs/boards/TASKS.md` top). |
| M5, M6, M8, M10 (accounts) | Later. M9, M11, M15, M20 parked. |

**M12 Workable in detail** (entry in `docs/boards/TASKS.md` plus `docs/BLOCKERS.md`):

What works:
- The reader and discovery: 58 companies, 600 India jobs, found through Workable's own job search.
- The adapter `src/modules/apply/adapters/workable.ts` fills forms correctly:
  - it reads the form from public JSON, `apply.workable.com/api/v1/jobs/<shortcode>/form`;
  - text, Yes/No, multi-choice, phone and MM/DD/YYYY date fields;
  - the resume upload waits until Workable unlocks Submit;
  - every value is read back;
  - Workable's own reply to the submission decides sent or refused.
- `scripts/workable-test.ts` passes, and dry runs pass on 5 live forms.

What blocks it: after Submit, Cloudflare Turnstile shows "Verify you are human" and fails the agent's Chrome **even when a person ticks it** (three ticks, 12 Nov). Nothing was ever sent from the test runs:
- Nitin's Apna application stays `pending_verification`, unconfirmed.
- Nitin's Lokal application was cancelled.

Owner's options, not decided:
1. Read-only: keep the jobs, out of the feed.
2. A hand-over to the person's own normal browser.
3. Workable's partner API.

Small improvements found in other repos, not built yet:
- detect the Cloudflare frame across `page.frames()` and by the text "Verify you are human";
- Workable's success marker `[data-ui='application-success']`;
- "already submitted" or "already received" counts as applied.

## 6. Rules for whoever works on this

- **Real applications go to real employers.** No real submit without the owner's explicit yes for that job and that profile.
  - The test profile used so far is Nitin's, with Nitin's consent relayed by the owner.
  - Test profiles (`isTest`) may only run on `/mock/*`.
  - Dry runs: `scripts/ats-smoke.ts --user <end of user id> <jobId>` fills a live form and never submits.
- **No bot-check evasion,** for any board: no hidden automation, no stealth plugins, no solver services. A check the person can complete is handed over; a board that blocks the browser outright is parked.
- Follow CLAUDE.md "How to work":
  - one task at a time from the entry;
  - run its Done-when yourself;
  - `npm run typecheck && npm run lint` before finishing;
  - mark `[~]` and `[x]` in the entry, then on the index line;
  - add a Done line;
  - when a decision changes, update ARCHITECTURE in the same change.
- Never log resume text, phones or emails; files go through `lib/storage.ts`, never the filesystem.

## 7. Gotchas learned the hard way

- **Database:** never run `prisma migrate diff` with `DIRECT_URL` as the shadow database; it wiped Neon on 10 Oct. Use `npx prisma migrate deploy` only.
- **Before restarting the worker:** check that no application is in `inspecting` or `filling`; a restart kills live runs.
- **Docker Desktop doesn't start on its own** (AutoStart off), so after the laptop restarts the worker is down until Docker is opened.
  - After a restart, stop the container at once and rebuild if the code changed. Its reaper re-queues stale runs within about 3 minutes.
  - Missed ticks aren't replayed; one catch-up tick reads everything overdue.
- **Workable's rate limit:** it answers 429 after about 250 calls in 10 minutes. Discovery pauses 2 s between Workable calls and only treats a 404 as "not a board".
- **Undici:** Node 22's fetch can throw an uncatchable parser assertion; `lib/undici-guard.ts` handles it in the worker and the scripts.
- **Ashby** needs a person's Submit for protected companies (automated 1/23, hand-over 6/6). Build on hand-over, not click tricks.
- **Dev server:** the autoapply-main checkout needs `next dev --webpack` (Turbopack rejects its linked `node_modules`). A fresh worktree may need `npx next typegen` before typecheck passes.
- **Reading `IngestRun` / `BoardDay`:** `ingest-tick-now.ts`, `board-day.ts --day`, and `feed-report.ts` are the ready-made scripts.

## 8. Commands

```
npm run typecheck && npm run lint
npx tsx scripts/workable-test.ts                      # offline Workable checks
npx tsx --env-file=.env scripts/ats-smoke.ts --user <id end> <jobId> --screenshot <png>   # live dry run, no submit
npx tsx --env-file=.env scripts/ingest-tick-now.ts --board workable --all
npx tsx --env-file=.env scripts/discover-boards.ts --import <file> --boards <board>       # dry run; add --write to record
npx tsx --env-file=.env scripts/feed-report.ts --from 2026-11-10 --to 2026-11-16
docker build -f Dockerfile.worker -t swipeapply-worker:m-tick .
```

## 9. Read in this order

1. `CLAUDE.md` (rules and process).
2. `docs/boards/TASKS.md`: the top (order), then the entry of the task you take.
3. `docs/boards/TDD.md`: only the sections the entry's Design line names.
4. `docs/BLOCKERS.md` for M7 and M12.
5. The files the entry's Do line names.
