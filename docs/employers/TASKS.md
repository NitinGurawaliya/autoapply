# Phase W tasks — Employers: one real company above its board accounts, and public A–Z company pages

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) Phase W lists these tasks one line each and links here; this file holds the full entry per task: Do, the design sections it builds, Done when, and the `Done <date>:` line once it lands. Mark `[~]` / `[x]` here first, then on the root line.

Order: W1 → W2 → W3 → W4 (the data and the feed), then W5 → W6 → W7 → W8 (the public pages, behind `COMPANY_PAGES` until W8). W5 can be drawn while W2's backfill runs. One session each, plan first, the Done-when check run and its output pasted, typecheck and lint. Open questions in [TDD §11](TDD.md#11-decisions-proposed-for-the-owner-to-confirm-26-nov) are closed before W6 and W7 start.

Migrations are hand-written SQL in `prisma/migrations/<stamp>_<name>/migration.sql`, applied with `npx prisma migrate deploy` only: never `prisma migrate dev`, never `migrate diff` with the real database as shadow (it wiped Neon on 10 Oct).

<a id="w1"></a>
### [ ] W1 — Employer tables and the company's domain columns
Do: `Employer` and `EmployerAlias` models and `Company.employerId`, `domain`, `domainBasis`, `domainCheckedAt` in `prisma/schema.prisma`; the hand-written migration `employers`; `src/lib/employer-slug.ts` (`employerSlug(name, domain, taken)`, the reserved words); ARCHITECTURE §4 (data model) and a new §6.25 (employers) record the decisions of TDD §3 and §4.3.
Design: [3 Options and decision](TDD.md#3-options-and-decision) · [4.3 Data model](TDD.md#43-data-model) · [4.4 Identity rules](TDD.md#44-identity-rules-domain-name-slug) · [4.13 Code map](TDD.md#413-code-map).
**Done when:** `npx prisma migrate deploy` applies `employers` on Neon and `npx prisma migrate status` is clean; `employer-slug-test` PASS (ASCII, 60 characters, no dots, reserved words refused, a taken slug gets the domain label, then a number); every existing query still runs (`feed-sql-test` PASS); typecheck and lint pass.

<a id="w2"></a>
### [ ] W2 — Each board account's own website, and its real name
Do: `modules/jobs/company-facts.ts fetchCompanyFacts(source, slug, name)` reads the board page once and returns logo, domain with its basis, and the board's own company name (extractors per board, TDD §4.5, moved out of `logos.ts` with `ownSiteOf`, `domainByName`, `siteRoot`); `refreshLogos` becomes `refreshCompanyFacts` (same pace, same tick, writes `logoUrl` and the domain columns; `basis = owner` is never overwritten); generic names ("Careers", "Jobs", code prefixes) replaced from the board page; `scripts/company-facts-backfill.ts --limit --write --source` resumable on `domainCheckedAt IS NULL`, run in the background over all rows.
Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-measured-and-read-26-nov) · [4.4 Identity rules](TDD.md#44-identity-rules-domain-name-slug) · [4.5 Where each board names the website](TDD.md#45-where-each-board-names-the-companys-website) · [4.10 Failure handling](TDD.md#410-failure-handling).
**Done when:** `company-facts-test` PASS (each board's extractor on a saved page string, a shared host refused, a job-link host accepted only when named like the company, an owner domain kept); the backfill has checked every `Company` row and `scripts/employers-report.ts --coverage` prints, per board, rows checked, rows with a domain and the basis split, with at least 80% of rows that have an open public job holding a domain; rows named "Careers" or "Jobs" (377 on 26 Nov, 375 of them Zoho) are under 20; logos are not fewer than before the change (count pasted before and after); typecheck and lint pass.

<a id="w3"></a>
### [ ] W3 — Employers built from the domains, kept linked at every ingest
Do: `modules/jobs/employers.ts`: `linkCompany(id)` (the company joins the employer with its domain, or makes one; no domain makes a singleton; a later domain merges a singleton and keeps its slug as an alias), `linkPending()` called from the ingest tick, `refreshEmployer(id)` (display name, logo, stage, slug), `refreshEmployerCounts()` (open public jobs, after ingest); `scripts/employers-link.ts --write` builds all employers from W2's domains; `scripts/employers-report.ts` (merges whose names disagree, same name on different domains, singletons whose name matches a domain employer, Naukri rows joined by a redirect); `scripts/employer-set.ts` for the owner's overrides (`--company <id> --domain <d>`, `--split`, `--name`).
Design: [4.4 Identity rules](TDD.md#44-identity-rules-domain-name-slug) · [4.6 Sequence: link](TDD.md#46-sequence-link-a-company-to-its-employer) · [4.7 Naukri rows](TDD.md#47-naukri-rows) · [4.11 Observability](TDD.md#411-observability) · [7 Testing](TDD.md#7-testing).
**Done when:** `employer-link-test` PASS (two boards with one domain are one employer; Glide on Ashby and Glide on Lever with different domains are two; no domain is a singleton; a domain found later merges the singleton and its slug answers as an alias; an owner override survives a relink; a Naukri row that redirects to a Greenhouse board joins that board's employer); after `employers-link.ts --write` no `Company` has `employerId` null; the report is pasted (employers, multi-board employers, merges whose names disagree) and every merge whose names disagree is checked by hand or listed for the owner; Glide, Ghost, Reach and Slate are separate employers unless their domains agree; typecheck and lint pass.

<a id="w4"></a>
### [ ] W4 — The feed and the guards count the employer, not the name
Do: the feed's rows carry `employerId` (`match.ts` feed SQL and `FeedRow`); `dedupeListings` keys on `roleKey(employerId, title)`; `governance/history.ts` (duplicate role and `max_per_company_per_week`) keys on the employer, with `company:<companyId>` for a row not yet linked, never the name; `BOARD_RANK` gains the boards applied today (Workday, SmartRecruiters, Keka, Naukri last); ARCHITECTURE §6.3 and §6.9 updated.
Design: [4.8 Feed and guards](TDD.md#48-feed-and-guards) · [7 Testing](TDD.md#7-testing).
**Done when:** `feed-dedupe-test` PASS (one employer's same role on Greenhouse and Naukri is one card, the Greenhouse one; two employers both named Glide with the same title are two cards; a role applied to through one board blocks the same role on the other board); `guards-test` and `feed-sql-test` PASS; the owner's feed before and after (counts pasted) loses only duplicates; typecheck and lint pass.

<a id="w5"></a>
### [ ] W5 — The company pages, drawn for approval
Do: `design/companies.html`, the A–Z index, one letter page and one company page (many jobs, one job, jobs only outside India, a company whose page is gone), mobile at 390 px and desktop, light and dark, with the ui-craft skill; `docs/DESIGN.md` names the file. No app code.
Design: [5 UI](TDD.md#5-ui).
**Done when:** the owner approves the drawing (their words quoted in the Done line).

<a id="w6"></a>
### [ ] W6 — `/companies` A–Z and `/companies/<slug>`
Do: `src/app/companies/` (index, `browse/[letter]`, `[slug]` with loading, error and not-found), public behind `COMPANY_PAGES` in `src/proxy.ts` and `src/lib/company-pages-gate.ts`; `modules/jobs/employer-pages.ts` (named columns only, public sources only, jobs read in the last 3 days, India first, 50 a page); `Organization` and `BreadcrumbList` JSON-LD; aliases answer 308 to the live slug; each job links to its `/j/` page with `?s=co`; the app's job page and the `/j/` page link to the company page.
Design: [4.1 Components](TDD.md#41-components) · [4.9 Public pages](TDD.md#49-public-pages-what-shows-and-what-never-does) · [4.12 Security and privacy](TDD.md#412-security-and-privacy) · [5 UI](TDD.md#5-ui) · [6 API](TDD.md#6-api).
**Done when:** `company-pages-smoke` PASS (signed out: `/companies` 200 with letters; a letter page lists only employers with open public jobs; a multi-board employer's page lists jobs from both boards; a Naukri-only employer is a 404 and no Naukri job appears on any page; an alias answers 308; a slug with a dot never reaches a page; `COMPANY_PAGES` off is a 404); the pages match W5's drawing at 390 px, light and dark (screenshots); typecheck and lint pass.

<a id="w7"></a>
### [ ] W7 — Found by search: JobPosting on job pages, sitemap and robots
Do: `JobPosting` JSON-LD on the `/j/` page of an open public job (title, full description shown on the page, `datePosted`, `validThrough` when known, `hiringOrganization` with the employer's name, website and logo, `jobLocation` or remote with `applicantLocationRequirements`, `employmentType`, `baseSalary` only from the board's fields); open public jobs indexable, closed and Naukri jobs `noindex` with no JobPosting; `src/app/sitemap.ts` (employers with open jobs and their open jobs, split past 50,000 URLs) and `src/app/robots.ts`; Phase U's "noindex" non-goal and ARCHITECTURE §6.23 updated.
Design: [4.9 Public pages](TDD.md#49-public-pages-what-shows-and-what-never-does) · [4.2 Search engines](TDD.md#42-search-engines) · [11 Decisions](TDD.md#11-decisions-proposed-for-the-owner-to-confirm-26-nov) item 2.
**Done when:** `job-posting-test` PASS (the JSON-LD of an open Greenhouse job has every required property and parses; a closed job and a Naukri job have none and say `noindex`); the sitemap lists only open public jobs and employers with them; Google's Rich Results Test passes on one deployed job page and one company page (screenshots, run by the owner or in the browser pane); typecheck and lint pass.

<a id="w8"></a>
### [ ] W8 — End to end and switch-on
Do: on production with `COMPANY_PAGES=1` (owner's OK first): a signed-out visit from `/companies` to a company, to a job, to Apply, to a sent application; the sitemap submitted in Search Console by the owner; `scripts/employers-report.ts` in the weekly board report.
Design: [8 Rollout](TDD.md#8-rollout) · [9 Risks](TDD.md#9-risks).
**Done when:** the path above ends `submitted` for a real job with the owner's profile (application id pasted); the funnel shows a `view` with source `co`; employers listed and open public jobs counted on the day are pasted; no Naukri job is reachable signed out.
