# OPERATIONS.md — SwipeApply

Lessons paid for in production. Each one cost real data, a live run or days of tries; follow them before the step they name. Rules and process are in `AGENTS.md`; deploy steps are in `docs/DEPLOY.md`.

## 1. Gotchas

### 1.1 Never use the real database as a Prisma shadow database

Never pass `DATABASE_URL` or `DIRECT_URL` to `--shadow-database-url`, and never run `prisma migrate diff --from-migrations`, `prisma migrate reset` or `prisma db push --force-reset` against the real Neon database. Apply migrations to it only with `npx prisma migrate deploy`.

- Why: on 10 Oct 2026 `prisma migrate diff --from-migrations ... --shadow-database-url <DIRECT_URL>` reset the "shadow" database, which was the real one, and wiped every table. It came back only through Neon point-in-time restore.
- How: for a schema check use a throwaway Neon branch, or skip the check. Count rows before and after any migration command.

### 1.2 Check for live runs before restarting or redeploying the worker

Before restarting, rebuilding or redeploying a worker (`docker rm -f`, a new image, a local `npm run worker` restart), check for applications in `inspecting` or `filling` and for active `apply` jobs in `pgboss.job`. A restart kills a live run.

- Why: on 19 Oct a redeploy 15 s after a swipe killed a live Greenhouse run. A killed run sits "in progress" until the reaper (`src/worker/reaper.ts`, 3 min) re-queues it, and the user sees it stall.
- How: wait for running applications to finish, or tell the user, before restarting. After a restart the worker's first log line must list `apply-handoff` and `apply-person`; "no screen" means the display mounts failed (`docs/DEPLOY.md`, "Docker worker with a screen").

### 1.3 Ashby needs a human Submit

Ashby forms run Google reCAPTCHA on Submit. 19-21 Oct: the worker pressing Submit itself got 1 of 23 through; the handoff (`ASHBY_HANDOFF=1`, a visible Chrome window, the user presses Submit) passed 6 of 6, same IP, same applicant, same jobs.

- How: for Ashby, and for Lever's hCaptcha, build on the handoff. No click workarounds, no faked human input, never solve a CAPTCHA (bot-check evasion). A job that hits a reCAPTCHA challenge is recorded failed with nothing sent.
- Later data (24 Oct, `ASHBY_AUTO_SUBMIT=1`): a single plain click in the visible handoff Chrome sent 4 of 8 with no reCAPTCHA block, and headless Docker sent 2 of 3 with the third challenged. Small samples; the handoff stays the path.

### 1.4 The autoapply-main dev server needs webpack

`autoapply-main`'s `node_modules` is a junction to `..\autoapply\node_modules`. Turbopack (Next 16 `next dev`, `next build`) rejects it ("Symlink [project]/node_modules is invalid, it points out of the filesystem root") and `npm run dev` exits after ~30 s without serving.

- How: in `autoapply-main` run `npx next dev --webpack` (the `dev-webpack` entry in `.claude/launch.json`). For a production build: `npx next build --webpack`, then `npx next start -p 3100` (the `prod-check` entry).
