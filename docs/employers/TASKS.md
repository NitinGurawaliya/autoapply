# Phase W tasks: employers above board accounts, and public A–Z company pages

This is the task file for [TDD.md](TDD.md) (v2, 27 Nov). Root [docs/TASKS.md](../TASKS.md) lists each Phase W task on one line and links here. This file holds each task's full entry:
- **Do**: the files to change.
- **Design**: the sections the task builds, its build sheet first.
- **Done when**: the check.
- **Done <date>:** a line added once the task lands.

Mark `[~]` / `[x]` here first, then on the root line.

**Order.**
- W0 can go first or any time; it closes a public leak that exists today.
- Then W1 → W2 → W3 → W4: the data and the feed.
- Then W5 → W6 → W7 → W8: the public pages, behind `COMPANY_PAGES` until W8.
- W5 (the drawing) can be done while W2's backfill runs.
- Each task is its own session and its own branch from `origin/main`, merged before the next one starts.

**Session prompt** (paste as is; works on a smaller model):

> Do task Wn from docs/employers/TASKS.md. Read its entry, then the build sheet and the sections its Design line links, nothing more (CLAUDE.md "Docs and the token budget"). Branch from origin/main. Follow the sheet's steps in order. Run its "Done when" check, paste the real output, run `npm run typecheck && npm run lint`, mark the task done with a Done line, commit. If the code differs from the sheet, follow the code and say how in the Done line. Blocked twice on one error: write it to docs/BLOCKERS.md and ask.

**Migrations.** They are hand-written SQL in `prisma/migrations/<stamp>_<name>/migration.sql`, applied with `npx prisma migrate deploy` only. Never `prisma migrate dev`, and never `migrate diff` with the real database as shadow (that wiped Neon on 10 Oct).

<a id="w0"></a>
### [ ] W0 — No Naukri job on a public page
**Do:**
- `src/modules/jobs/public.ts`: `publicJob` gives null for a signed-in source.
- `src/modules/jobs/similar.ts`: excludes signed-in sources.
- `src/app/(app)/jobs/[id]/page.tsx`: no Share button on a Naukri job.
- `scripts/public-sources-test.ts`.

**Design:** [10.1 Build sheet](TDD.md#101-w0--no-naukri-job-on-a-public-page) · [2 Facts](TDD.md#2-facts-the-design-rests-on-measured-and-read-2627-nov) (`/j/` pages) · [4.7 Naukri rows](TDD.md#47-naukri-rows).

**Done when:**
- `public-sources-test` PASS.
- `/j/<slug>` of a Naukri job answers 404 signed out on `npm run dev` (curl output pasted).
- typecheck and lint pass.

<a id="w1"></a>
### [ ] W1 — Employer tables and the company's domain columns
**Do:**
- `prisma/schema.prisma` (`Employer`, `EmployerAlias`, the `Company` columns, the `Job` index).
- `prisma/migrations/20261127090000_employers/migration.sql`.
- `src/lib/employer-slug.ts`.
- `scripts/employer-slug-test.ts`.
- ARCHITECTURE §4 and a new §6.25.

**Design:** [10.2 Build sheet](TDD.md#102-w1--tables-and-slug) · [4.3 Data model](TDD.md#43-data-model) · [4.4 Identity rules](TDD.md#44-identity-rules-domain-name-slug) · [3 Options and decision](TDD.md#3-options-and-decision).

**Done when:**
- `npx prisma migrate deploy` applies `employers` on Neon, and `npx prisma migrate status` reports the database up to date.
- `employer-slug-test` PASS.
- `feed-sql-test` PASS.
- typecheck and lint pass.

<a id="w2"></a>
### [ ] W2 — Each board account's own website, and its real name
**Do:**
- `src/modules/jobs/domains.ts`, `src/modules/jobs/company-facts.ts`, and the exports in `logos.ts`.
- The facts sweep in `src/worker/handlers/ingest-tick.ts`.
- `scripts/company-facts-backfill.ts`, `scripts/company-facts-test.ts`.
- `scripts/employers-report.ts --coverage`.
- The backfill run over all rows.

**Design:** [10.3 Build sheet](TDD.md#103-w2--facts-domain-and-name-per-row) · [4.4 Identity rules](TDD.md#44-identity-rules-domain-name-slug) · [4.5 Where each board names the website](TDD.md#45-where-each-board-names-the-companys-website) · [4.7 Naukri rows](TDD.md#47-naukri-rows) · [4.10 Failure handling](TDD.md#410-failure-handling).

**Done when:**
- `company-facts-test` PASS, with one live snippet per board as fixture.
- The backfill has looked at every row.
- `employers-report.ts --coverage` is pasted, and at least 80% of active rows with jobs at their last read hold a domain. Any board below 60% is named with its cause in the Done line.
- Rows named "Careers" or "Jobs" (377 on 26 Nov) are under 20.
- The count of rows with a logo is not lower than before (both numbers pasted).
- `logos-test` PASS.
- typecheck and lint pass.

<a id="w3"></a>
### [ ] W3 — Employers built from the domains, kept linked at every ingest
**Do:**
- `src/modules/jobs/employers.ts`.
- `linkPending` in the ingest tick; hourly `refreshEmployerCounts` in `after-ingest.ts`.
- `scripts/employers-link.ts`, `scripts/employers-report.ts` (full), `scripts/employer-set.ts`, `scripts/employer-link-test.ts`.
- The first build run on Neon.

**Design:** [10.4 Build sheet](TDD.md#104-w3--linking) · [4.6 Sequence: link](TDD.md#46-sequence-link-a-company-to-its-employer) · [4.7 Naukri rows](TDD.md#47-naukri-rows) · [4.11 Observability](TDD.md#411-observability).

**Done when:**
- `employer-link-test` PASS (its 9 cases).
- After `employers-link.ts --write`, no `Company` has a null `employerId` (count pasted).
- The report is pasted: totals, and the first 30 "names disagree" lines.
- Glide, Ghost, Reach and Slate are separate employers unless their domains agree (query output pasted).
- typecheck and lint pass.

<a id="w4"></a>
### [ ] W4 — The feed and the guards count the employer, not the name
**Do:**
- `src/modules/governance/history.ts` (`employerKey`, and the three readers).
- `src/modules/governance/index.ts`.
- `src/modules/jobs/match.ts` (`FeedRow.employerId`, the keys, `BOARD_RANK`).
- `scripts/feed-dedupe-test.ts`.
- ARCHITECTURE §6.3 and §6.9.

**Design:** [10.5 Build sheet](TDD.md#105-w4--feed-and-guards) · [4.8 Feed and guards](TDD.md#48-feed-and-guards).

**Done when:**
- `feed-dedupe-test` PASS (its 5 cases).
- `guards-test` and `feed-sql-test` PASS.
- The owner's feed count before and after is pasted.
- typecheck and lint pass.

<a id="w5"></a>
### [ ] W5 — The company pages, drawn for approval
**Do:**
- `design/companies.html`.
- One line in `docs/DESIGN.md`.
- No app code.

**Design:** [10.6 Build sheet](TDD.md#106-w5--drawing) · [5 UI](TDD.md#5-ui).

**Done when:** the owner approves the drawing (their words quoted in the Done line).

<a id="w6"></a>
### [ ] W6 — `/companies` A–Z and `/companies/<slug>`
**Do:**
- `src/lib/company-pages-gate.ts`, `src/proxy.ts`.
- `src/modules/jobs/employer-pages.ts`.
- `src/app/companies/` (index, `browse/[letter]`, `[slug]`, loading, error, not-found).
- The company link from `/j/` and from the app's job page.
- `"co"` in `lib/funnel.ts`.
- `scripts/company-pages-smoke.ts`.

**Design:** [10.7 Build sheet](TDD.md#107-w6--pages) · [4.9 Public pages](TDD.md#49-public-pages-what-shows-and-what-never-does) · [4.2 Search engines](TDD.md#42-search-engines) · [4.12 Security and privacy](TDD.md#412-security-and-privacy) · [5 UI](TDD.md#5-ui).

**Done when:**
- `company-pages-smoke` PASS.
- Screenshots at 390 px, light and dark, match W5's drawing.
- typecheck and lint pass.

<a id="w7"></a>
### [ ] W7 — Found by search: JobPosting on job pages, sitemap and robots
**Do:**
- `src/lib/job-posting.ts`.
- `publicJob`'s extra fields.
- `src/app/j/[slug]/page.tsx` (JSON-LD, robots, the full posting visible).
- `src/app/sitemap.ts`, `src/app/robots.ts`.
- `scripts/job-posting-test.ts`.
- `docs/share/TDD.md` §1 and ARCHITECTURE §6.23.

**Design:** [10.8 Build sheet](TDD.md#108-w7--search) · [4.2 Search engines](TDD.md#42-search-engines) · [11 Decisions](TDD.md#11-decisions-closed-with-the-owner-27-nov-yes-plan-it-end-to-end-and-build-it) item 2.

**Done when:**
- `job-posting-test` PASS (its 8 cases).
- `/sitemap/0.xml` (or the path the Next doc gives) lists only listed employers.
- One job sitemap lists only open public jobs.
- `/robots.txt` names the sitemaps.
- typecheck and lint pass.

<a id="w8"></a>
### [ ] W8 — End to end and switch-on
**Do:**
- On production with the owner's OK: `COMPANY_PAGES=1`.
- A signed-out path from `/companies` to a sent application.
- The sitemap submitted and the Rich Results Test run, both by the owner.
- `employers-report.ts` added to the weekly board report.

**Design:** [10.9 Build sheet](TDD.md#109-w8--switch-on) · [8 Rollout](TDD.md#8-rollout) · [9 Risks](TDD.md#9-risks).

**Done when:**
- That path ends `submitted` for a real job with the owner's profile (application id pasted).
- A `FunnelEvent` `view` with `source = co` exists.
- The Rich Results Test passes on one job page and one company page (screenshots).
- No Naukri job is reachable signed out.
