# Employers: one real company above its board accounts, and public A–Z company pages — technical design (Phase W)

Version 2, 27 Nov 2026. Version 1 (26 Nov) settled the design; this version adds the build sheets (§10), so each task can be coded from its entry, its sheet and the sections it links.

The owner, 25–26 Nov, made the company the backbone: real employers with A–Z pages people can find, easy to track, good for users and for search. After that come non-tech jobs and the agent and adapters they need. This design covers step 1 only.

The proposals in §11 were accepted by the owner on 27 Nov ("yes plan it end to end and build it").

ARCHITECTURE stays the source of truth:
- W1 copies the decisions into §4 and a new §6.25.
- W4 updates §6.3 and §6.9.
- W7 updates §6.23.

The decision in one line: **an `Employer` is one website domain; every `Company` row (one account on one board) belongs to one employer; names never merge rows on their own; `Job` stays under `Company`.**

`Employer` is not Phase V's `EmployerAccount`. That table holds a user's own login on an employer's ATS, and its `employer` column is a tenant name. The two are not linked in this phase.

---

## 1. Goals and non-goals

**Goals**
- G1. Every `Company` row belongs to exactly one `Employer`, and one employer is one real business, identified by its own website's registrable domain (`razorpay.com`).
- G2. Rows join an employer only when their domains agree.
  - Two businesses with the same name stay apart (Glide, Ghost, Reach, Slate on Ashby, Lever and Workable).
  - A row whose domain we cannot find is its own employer until one is found.
- G3. Every employer has a real name. The 375 Zoho Recruit rows named "Careers" and Workday's coded legal names are fixed from the board page.
- G4. Public pages: `/companies` (A–Z) and `/companies/<slug>` with every open job across the employer's boards.
  - Only employers with open public jobs are listed.
  - Naukri listings are never shown publicly (W0 closes today's leak on `/j/`).
  - Search engines can index the pages: `Organization` data on the company page, `JobPosting` on each job's `/j/` page.
- G5. The feed shows one employer's same role once, even when two boards list it. The duplicate guard and the per-company weekly cap count the employer, not the spelling of its name.
- G6. The shape carries the next phase (non-tech roles, §12) without another remodel.

**Non-goals**
- Non-tech roles themselves: fields and tracks, matching, onboarding, adapters (§12, the follow-on phase).
- Company groups and parents (Tata Steel vs TCS, Bosch's legal entities). One domain is one employer.
- Employer accounts, claims or edits by employers, reviews, ratings, salaries by company, following a company.
- Moving `Job` under `Employer`, or changing `Job`'s `@@unique([source, externalId])`.
- LinkedIn or Crunchbase company data, paid company databases, any crawl of Naukri.
- Merging by an LLM's judgement.
- A new npm package. Everything here uses the stack as it is.

---

## 2. Facts the design rests on (measured and read, 26–27 Nov)

**Our data** (read-only queries on Neon, 26 Nov):

| Board | `Company` rows | with an open job | with a logo | open jobs | open India jobs |
|---|---:|---:|---:|---:|---:|
| Workable | 10,947 | 208 | 10,359 | 1,612 | 1,612 |
| Greenhouse | 8,221 | 572 | 6,145 | 21,830 | 3,402 |
| Ashby | 4,360 | 189 | 4,267 | 1,853 | 543 |
| Zoho Recruit | 2,886 | 83 | 2,779 | 739 | 739 |
| Lever | 2,526 | 211 | 2,220 | 6,760 | 1,263 |
| SmartRecruiters | 1,365 | 151 | 1,216 | 4,241 | 4,241 |
| Keka | 553 | 436 | 474 | 4,189 | 4,189 |
| Workday | 415 | 344 | 412 | 11,221 | 11,176 |
| Naukri | 101 | 101 | 101 | 162 | 162 |
| **All (with mock)** | **31,375** | **2,296** | | **52,609** | **29,327** |

- **Repeated names:**
  - 1,362 normalised names have more than one row (3,212 rows); 1,095 of those names span boards.
  - Among rows with an open job, only 54 names repeat, 8 of them across boards.
  - Only 6 name-and-title pairs are open on two boards today.
  - So the feed has few cross-board duplicates now. The employer matters most for the pages, for the guards (a shared name wrongly joins two businesses) and for the boards and Naukri rows still to come.
- **Generic names:** 375 Zoho Recruit rows, one Lever row and one Greenhouse row are named "Careers" or "Jobs".
- **Missing index:** `Job` has no index that starts with `companyId`. A page or count by company needs one (§4.3).

**Our code** (origin/main `a7a1c0c`, 27 Nov):
- `modules/jobs/logos.ts` already finds a website on its way to a logo, then keeps only the icon URL:
  - `websiteFromHtml` reads Ashby `publicWebsite` and Workable `url`.
  - `ownSiteOf(jobHosts(…))` reads the host the company's job links point to, when it is named like the company.
  - `domainByName` uses Clearbit's free suggest, accepted only with evidence in the company's own postings (`mentionedInJobs`).
  - `siteRoot` and `NOT_OWN_SITE` are also there.
  - `refreshLogos` runs from `worker/handlers/ingest-tick.ts`: 40 companies per tick, 300 ms apart, rows with India jobs first, and a row is marked checked even when its page did not load.
- `modules/jobs/boardSeeds.ts boardFromUrl(text)` turns a board URL into `{ source, slug }`.
- **The feed and the guards key on the name today:**
  - The feed (`match.ts dedupeListings`) keys a role by `roleKey(companyKey(name), title)`.
  - `governance/history.ts` keys the duplicate guard and `max_per_company_per_week` the same way (`countedApplications`, `feedHistory`, `historyFor`).
  - So two businesses called Glide share a cap, while "Razorpay" and "Razorpay Software Private Limited" do not.
- **`lastFetchedAt`:** `jobs/ingest.ts` sets `Company.lastFetchedAt` on every read, failed reads included. `afterIngest` already runs an hourly cleanup step.
- **The `/j/` pages** (Phase U) are public behind `SHARE_LINKS` and `noindex`.
  - `modules/jobs/public.ts publicJob(id)` does not check the source, and `similar.ts` picks from `APPLY_BOARDS`, so **a Naukri job is visible on a public page today**. W0 fixes this.
  - `lib/job-slug.ts` has `jobPath`, `jobIdFromSlug`, `appOrigin` and `absoluteUrl` (from `APP_URL`).
  - `lib/funnel.ts SOURCES = li, x, wa, copy, app`.
- **The proxy:** `src/proxy.ts` lets `/j/` through. Its matcher skips any path with a dot, so a public slug must never contain one, and `/sitemap.xml` and `/robots.txt` bypass it.
- `modules/sources/sites.ts SITES = ["naukri"]`: the signed-in sources.
- Naukri `Company` rows are made in `jobs/ingest.ts` with `active: false`. A Naukri job that sends people to a board keeps that board URL as `applyUrl`, with `applyVia` set.
- **Next 16:** JSON-LD is a `<script type="application/ld+json">` in the page, with `<` escaped as `<` (`node_modules/next/dist/docs/01-app/02-guides/json-ld.md`). Sitemaps split with `generateSitemaps`, at most 50,000 URLs each (`…/03-api-reference/03-file-conventions/01-metadata/sitemap.md`).

**Boards** (public, no-login reads, 26 Nov, 2–3 companies each; §13):

| Board | Where the website is | Seen |
|---|---|---|
| Ashby | board page `__appData.organization.publicWebsite` | 3 of 3 |
| Workable | `GET apply.workable.com/api/v1/accounts/<slug>/` → `url` (also `name`) | 3 of 3 |
| Lever | board page footer link "<Name> Home Page" (`.main-footer-text a`); the header logo link is unreliable | 3 of 3 |
| SmartRecruiters | the newest job's page, header logo link (`header.jobad-header .header-logo a[href]`) | 2 of 2 |
| Keka | `careerportalinfo` → `companyWebsite` (may be empty, missing, or a `careers.` host); `name` | 2 of 4 |
| Zoho Recruit | portal page, entity-encoded JSON `org_info.website`, `org_info.company_name`, `hide_company_name`, `hide_visit_website`; `og:site_name` | 2 of 2 |
| Greenhouse | board page `"logo":{…"href":…}` when set, else the job links' host | 1 of 3 |
| Workday | none (`hiringOrganization.url` and `sameAs` empty) | 0 of 2 |
| Naukri | not read (its terms); a redirect to a board we read joins that board's account | — |

Clearbit's free suggest still answers. For "Razorpay" its first suggestion is `razorpay.com`, followed by four look-alikes, so it is a candidate source, never proof.

**Search engines:**
- Google reads `JobPosting` only on the page of a single job, never on a page listing jobs.
- The description must be visible on that page.
- An expired job drops its markup.
- A company page carries `Organization` data.

---

## 3. Options and decision

**What identifies a real employer**

| Option | Same business on two boards | Two businesses, one name | Verdict |
|---|---|---|---|
| A. Normalised name (today's `companyKey`) | misses "Razorpay" vs its legal name | merges Glide with Glide | No |
| **B. The website's registrable domain, from each board's own page, else evidence** | joins them | keeps them apart | **Chosen** |
| C. An LLM asked "same company?" | often | often | No: not reproducible, no evidence to show |
| D. A paid company database | yes | yes | No: cost and terms; Clearbit's free suggest stays a candidate source |
| E. Owner curation | yes | yes | Only as overrides on top of B |

**Where the employer sits**

| Option | Verdict |
|---|---|
| **A. New `Employer` table, `Company.employerId`; `Job` stays under `Company`** | **Chosen**: no change to ingest, cadence, `(source, slug)` or any `Job` query |
| B. Rename `Company` to `BoardAccount`, make `Company` the employer | No: touches every module and script for no gain |
| C. Only a computed `employerKey` column on `Company` | No: nowhere for a slug, a name, aliases or counts |

---

## 4. Architecture

### 4.1 Components

| File | Holds | Task |
|---|---|---|
| `src/modules/jobs/public.ts`, `similar.ts` | no Naukri job on a public page | W0 |
| `prisma/schema.prisma`, migration `20261127090000_employers` | §4.3 | W1 |
| `src/lib/employer-slug.ts` | `slugBase`, `employerSlug`, `RESERVED_SLUGS` | W1 |
| `src/modules/jobs/domains.ts` | `employerDomain`, `isGenericCompanyName` | W2 |
| `src/modules/jobs/company-facts.ts` | board-page extractors, `fetchCompanyFacts`, `refreshCompanyFacts` | W2 |
| `src/modules/jobs/logos.ts` | exports `jobHosts`, `domainByName`, `mentionedInJobs` (no behaviour change) | W2 |
| `src/modules/jobs/employers.ts` | `linkCompany`, `linkPending`, `refreshEmployer`, `refreshEmployerCounts`, `displayName`, `buildAllEmployers` | W3 |
| `src/worker/handlers/ingest-tick.ts` | facts sweep, then `linkPending` | W2, W3 |
| `src/modules/jobs/after-ingest.ts` | hourly `refreshEmployerCounts` | W3 |
| `src/modules/governance/history.ts`, `src/modules/jobs/match.ts` | `employerKey` | W4 |
| `design/companies.html` | the drawing | W5 |
| `src/modules/jobs/employer-pages.ts` | public reads | W6 |
| `src/app/companies/…`, `src/lib/company-pages-gate.ts`, `src/proxy.ts` | pages and gate | W6 |
| `src/lib/job-posting.ts`, `src/app/j/[slug]/page.tsx`, `src/app/sitemap.ts`, `src/app/robots.ts` | search | W7 |

The web app imports only `modules/jobs` files that load no browser, never `@/modules/apply`: on Vercel every route that reaches it answers 500. It imports `@/modules/sources/sites` directly, not the `sources` index.

### 4.2 Search engines

- **Company pages:** `/companies`, the letter pages and the company pages are indexable, with a canonical URL from `absoluteUrl`. They carry `Organization` (name, `url` = `https://<domain>` when known, `logo`) and `BreadcrumbList`, and no `JobPosting`.
- **Job pages:** an open job's `/j/` page carries `JobPosting` and is indexable when the job is from a public source and its company was read in the last 3 days. Every other job page carries no markup and is `noindex`.
- **`JobPosting` fields** (`src/lib/job-posting.ts`, §10.8). Nothing is inferred to fill a field:
  - `title`; `description` (the stored description, shown on the page); `datePosted`.
  - `hiringOrganization`: employer name, `sameAs` website, `logo`.
  - `jobLocation`, or `jobLocationType: TELECOMMUTE` with `applicantLocationRequirements` India.
  - `employmentType` from `Job.kind`.
  - `baseSalary` only from the board's own pay fields.
- **Sitemap and robots:** `sitemap.ts` lists employers with open public jobs and those jobs, split past 45,000 URLs. `robots.ts` allows `/companies` and `/j/`, disallows the app, and names the sitemaps.

### 4.3 Data model

One migration, hand-written, applied with `npx prisma migrate deploy` only. Never `prisma migrate dev`, and never `migrate diff` with the real database as shadow (it wiped Neon on 10 Oct).

`prisma/schema.prisma`:

```prisma
model Employer {
  id          String    @id @default(cuid())
  slug        String    @unique // /companies/<slug>: [a-z0-9-], 2–60 characters; set once at creation, never changed
  name        String    // display name (§4.4)
  nameBasis   String?   // owner: the owner set it, refreshEmployer leaves it alone
  domain      String?   @unique // registrable domain, "razorpay.com"; null: none found yet (a one-row employer)
  domainBasis String?   // board | redirect | job_links | name_evidence | owner
  logoUrl     String?
  stage       String?   // startup | midsize | mnc: the most common among its rows
  openJobs    Int       @default(0) // open public jobs (§4.9), refreshEmployerCounts
  openIndia   Int       @default(0) // of those, eligibility india | remote_india
  nameKey     String    // sort key: lower-case ASCII of name; its first character is the letter ("0" for a digit)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  companies   Company[]
  aliases     EmployerAlias[]

  @@index([nameKey, openJobs])
  @@index([openIndia])
}

model EmployerAlias {
  slug       String   @id // an old slug (a merged employer's): answers 308 to the employer's slug
  employerId String
  createdAt  DateTime @default(now())
  employer   Employer @relation(fields: [employerId], references: [id], onDelete: Cascade)

  @@index([employerId])
}
```

`model Company` gains, after `keepAbroad`:

```prisma
  // Phase W (docs/employers/TDD.md): the real employer this board account belongs to, and the evidence for it.
  employerId      String?   // null only between a new row's creation and the next linkPending()
  domain          String?   // this row's own website domain (§4.4); null: none found
  domainBasis     String?   // board | redirect | job_links | name_evidence | owner (owner: never overwritten)
  domainCheckedAt DateTime? // the facts sweep's last look; null: never looked
  linkedAt        DateTime? // linkCompany's last run; linkPending picks rows whose domainCheckedAt is newer
  employer        Employer? @relation(fields: [employerId], references: [id], onDelete: SetNull)
```

…and `@@index([employerId])`. `model Job` gains `@@index([companyId, closedAt])`.

`prisma/migrations/20261127090000_employers/migration.sql`:

```sql
-- Phase W, W1: employers above board accounts (docs/employers/TDD.md 4.3). Applied with prisma migrate deploy only.
CREATE TABLE "Employer" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameBasis" TEXT,
    "domain" TEXT,
    "domainBasis" TEXT,
    "logoUrl" TEXT,
    "stage" TEXT,
    "openJobs" INTEGER NOT NULL DEFAULT 0,
    "openIndia" INTEGER NOT NULL DEFAULT 0,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Employer_slug_key" ON "Employer"("slug");
CREATE UNIQUE INDEX "Employer_domain_key" ON "Employer"("domain");
CREATE INDEX "Employer_nameKey_openJobs_idx" ON "Employer"("nameKey", "openJobs");
CREATE INDEX "Employer_openIndia_idx" ON "Employer"("openIndia");

CREATE TABLE "EmployerAlias" (
    "slug" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployerAlias_pkey" PRIMARY KEY ("slug")
);
CREATE INDEX "EmployerAlias_employerId_idx" ON "EmployerAlias"("employerId");
ALTER TABLE "EmployerAlias" ADD CONSTRAINT "EmployerAlias_employerId_fkey"
    FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Company" ADD COLUMN "employerId" TEXT;
ALTER TABLE "Company" ADD COLUMN "domain" TEXT;
ALTER TABLE "Company" ADD COLUMN "domainBasis" TEXT;
ALTER TABLE "Company" ADD COLUMN "domainCheckedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN "linkedAt" TIMESTAMP(3);
CREATE INDEX "Company_employerId_idx" ON "Company"("employerId");
ALTER TABLE "Company" ADD CONSTRAINT "Company_employerId_fkey"
    FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Job_companyId_closedAt_idx" ON "Job"("companyId", "closedAt");
```

Raw SQL that inserts into `Employer` sets `"updatedAt" = now()` itself: Prisma fills `@updatedAt` only in its own calls. `Employer.slug` and `EmployerAlias.slug` share one namespace, so a new slug must be in neither.

### 4.4 Identity rules: domain, name, slug

**Domain** (`domains.ts employerDomain(urlOrHost)`, pure). Returns a domain or null:
1. The input is trimmed. `http(s)://` is added if missing, then it is parsed with `new URL`; a parse failure gives null. The host is lower-cased and `www.` dropped.
2. The registrable domain is kept with `siteRoot` (`careers.toddleapp.com` → `toddleapp.com`; `acme.co.uk` stays).
3. On shared hosting one more label is kept, so `acme.github.io` stays `acme.github.io`. `SHARED_HOSTS` = `github.io vercel.app netlify.app herokuapp.com wixsite.com webflow.io framer.website notion.site blogspot.com wordpress.com carrd.co pages.dev`. `sites.google.com` is refused.
4. These are refused (null):
   - anything `NOT_OWN_SITE` matches;
   - `NOT_EMPLOYER_HOST` = `gmail.com outlook.com hotmail.com yahoo.com linktr.ee linkedin.com facebook.com instagram.com x.com twitter.com youtube.com medium.com wa.me t.me google.com`;
   - an IP address;
   - a host without a dot.

**Evidence, in order** (`fetchCompanyFacts`). The first source that gives an acceptable domain wins:

| Basis | Source | Accepted when |
|---|---|---|
| `owner` | `scripts/employer-set.ts` | always; the sweep never overwrites it |
| `board` | the board page's own website field (§4.5) | `employerDomain` passes |
| `redirect` | a Naukri job's `applyUrl` on a board account we read (§4.7) | that account has a domain |
| `job_links` | `ownSiteOf(await jobHosts(source, slug), name, slugKey(source, slug))` | `ownSiteOf`'s own name test |
| `name_evidence` | `domainByName(name, slugKey, host => mentionedInJobs(source, slug, host))` | its own evidence test |

**Joining.**
- Rows with the same domain are one employer, whatever their names.
- A join whose names share no word (after `plainName`) is still made, and the report lists it.
- Two rows with the same name and different domains are two employers.
- A row without a domain is a one-row employer.

**Name.** `isGenericCompanyName(name)` is true for an empty name or one matching `^(careers?|jobs?|career portal|careers page|job openings|current openings|openings|home|join us)$` after trimming, case ignored. The facts sweep replaces a generic `Company.name` with the board page's name (§4.5) when it has one.

`displayName(rows)` gives the employer's name:
1. `nameBasis = owner` → the name stays as it is.
2. Otherwise each row's name goes through `plainName`; generic names are dropped.
3. The most common wins. Ties go to a row from Ashby, Workable, Keka or Zoho (names the company set itself), then to the shortest.
4. With none left, it is the domain's first label, capitalised.

**Slug** (`lib/employer-slug.ts`, pure):
- `slugBase(name)`: NFKD-normalised, diacritics dropped, lower case, every run of characters outside `[a-z0-9]` becomes one `-`, trimmed of `-`, and cut to 60 characters at the last `-` before 60. Empty → `company`. Under 2 characters, or in `RESERVED_SLUGS` (`browse search new api page a-z all top`) → `<base>-company`.
- `employerSlug(name, domain, taken: Set<string>)`:
  1. `slugBase(name)` if free.
  2. Else `<base>-<domain's first label>` if a domain is known and that is free.
  3. Else `<base>-2`, `-3`, … until free.
  - The result never holds a dot.
- **A slug is set when the employer is created and never changes.** A rename keeps it. A merge turns the loser's slug, and every alias pointing at the loser, into aliases of the survivor.

### 4.5 Where each board names the company's website

`company-facts.ts` reads one page per row, the same address `logos.ts` uses (`BOARD_PAGE`), with the same headers and a 15 s timeout. Its pure extractors are `websiteFromBoardPage(source, page)` and `nameFromBoardPage(source, page)`. Both return the raw string or null; `employerDomain` judges the website.

| Board | Page read | Website (regex or JSON path) | Name |
|---|---|---|---|
| ashby | `https://jobs.ashbyhq.com/<slug>` | `"publicWebsite"\s*:\s*"([^"]+)"` | — (the stored name is the page title) |
| workable | `https://apply.workable.com/api/v1/accounts/<slug>/` (JSON) | `.url` | `.name` |
| lever | `https://jobs.lever.co/<slug>` | `class="main-footer-text"[\s\S]{0,600}?<a[^>]+href="([^"]+)"` | `<title>` without " jobs" |
| smartrecruiters | the newest posting's page (as `fetchLogoUrl` finds it) | `class="[^"]*header-logo[^"]*"[\s\S]{0,400}?<a[^>]+href="([^"]+)"` | that link's `title` |
| keka | `https://<slug>.keka.com/careers/api/organization/default/careerportalinfo` (JSON) | `.companyWebsite` | `.name` |
| zohorecruit | `https://<host>/jobs/Careers` | entities decoded (`&quot;` → `"`), then `"website"\s*:\s*"([^"]+)"`; skipped when `"hide_visit_website"\s*:\s*true` | `"company_name"\s*:\s*"([^"]+)"`, else `og:site_name`; skipped when `"hide_company_name"\s*:\s*true` |
| greenhouse | `https://job-boards.greenhouse.io/<slug>` | `"logo"\s*:\s*\{[^}]*?"href"\s*:\s*"([^"]+)"` | — |
| workday | none | — (`job_links` never helps: every link is on `myworkdayjobs.com`) | — |

- Each regex was taken from 2–3 live pages on 26 Nov. W2 copies a trimmed snippet of one live page per board into `company-facts-test.ts` as the fixture, checked in the browser on the day, not from this table alone.
- A board whose field is missing falls through to `job_links`, then `name_evidence`.
- Staffing firms (Zoho `org_info.type = staffing`) are their own employers, because the firm is who posts the job. Nothing new is stored for it.

### 4.6 Sequence: link a company to its employer

`linkCompany(companyId)` runs in one transaction, inside `pg_advisory_xact_lock(hashtext('employers'))` so two linkers never race on a domain.

```
c = Company (FOR UPDATE); d = c.domain; now = now()
current = c.employerId ? Employer : null
alone   = current && no other Company has current.id
if d is null:
    if current && alone && current.domain is null → touch c.linkedAt; done ("kept")
    e = create Employer(slug = employerSlug(c.name, null), name, nameKey, domain null)
    move c to e; if current && no rows left in current → mergeInto(e, current); done ("created")
target = Employer where domain = d
if target is null:
    if current && alone → current.domain = d, domainBasis = c.domainBasis; done ("domain_set")
    e = create Employer(slug = employerSlug(c.name, d), domain d, domainBasis); move c to e
    if current && no rows left in current → mergeInto(e, current); done ("created")
if target.id = c.employerId → touch c.linkedAt; done ("kept")
move c to target
if current && no rows left in current → mergeInto(target, current)
done ("joined" or "merged")
then refreshEmployer() for target and current (if it still exists); c.linkedAt = now
```

- `mergeInto(survivor, loser)`:
  1. `INSERT EmployerAlias(slug = loser.slug, employerId = survivor.id)`.
  2. `UPDATE EmployerAlias SET employerId = survivor WHERE employerId = loser`.
  3. Delete the loser.
- `refreshEmployer(id)`:
  - `name = displayName(rows)` unless `nameBasis = owner`, with `nameKey` to match.
  - `logoUrl` = the first non-null `Company.logoUrl`, rows with India jobs (`indiaOpen > 0`) first.
  - `stage` = the most common non-null `Company.stage`.
  - The slug is never touched.
- `linkPending(limit = 500)` runs `linkCompany` for rows where `employerId IS NULL OR linkedAt IS NULL OR linkedAt < domainCheckedAt`, rows with India jobs first.
- The ingest tick calls the facts sweep and then `linkPending`, in the background, never two at once (as logos run today).
- `buildAllEmployers()` (W3's first run) does the same set-wise in memory and writes in bulk (§10.4). It runs only while the `Employer` table is empty.
- `refreshEmployerCounts()` is one statement, run hourly from `afterIngest` like the cleanup:

```sql
WITH counts AS (
  SELECT c."employerId" AS id, count(*)::int AS open,
         count(*) FILTER (WHERE j.eligibility IN ('india', 'remote_india'))::int AS india
  FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
  WHERE j."closedAt" IS NULL AND c."employerId" IS NOT NULL
    AND j.source <> ALL(${PRIVATE_SOURCES}::text[])
    AND c."lastFetchedAt" > now() - interval '3 days'
  GROUP BY 1)
UPDATE "Employer" e SET "openJobs" = coalesce(k.open, 0), "openIndia" = coalesce(k.india, 0), "updatedAt" = now()
FROM "Employer" e2 LEFT JOIN counts k ON k.id = e2.id
WHERE e.id = e2.id AND (e."openJobs" <> coalesce(k.open, 0) OR e."openIndia" <> coalesce(k.india, 0));
```

`PRIVATE_SOURCES = [...SITES, "mock"]`, exported from `employers.ts`.

### 4.7 Naukri rows

- A Naukri `Company` row is linked like any other row. Its only evidence is `redirect`: the facts sweep runs `boardFromUrl(job.applyUrl)` on its jobs with `applyVia` set. When that gives a board `Company` with a domain, the Naukri row takes that domain with `domainBasis = redirect`.
- Naukri rows are inactive (`active = false`), so the sweep selects them by source, not by `active` (§10.3 step 4).
- Without a redirect a Naukri row is a one-row employer.
- Names never join a Naukri row to anything.
- Naukri jobs never count in `openJobs` and never appear on a public page. An employer with only Naukri jobs is unlisted, and its slug is a 404.
- In the feed a Naukri job joins its employer's other listings, so the same role on Greenhouse wins (§4.8).

### 4.8 Feed and guards

- `history.ts` gains `employerKey(row: { employerId: string | null; companyId: string })`. It returns `e:<employerId>`, or `c:<companyId>` for a row not yet linked, never the name.
- `countedApplications` selects `c."employerId"` and `j."companyId"`. `appliedRoleKeys`, `feedHistory` and `historyFor` compare employer keys.
- `historyFor` reads the job's company's `employerId` in its one statement, as it reads `companyName` today.
- The feed SQL (`match.ts`, the `FeedRow` select) adds `c."employerId"`, and `FeedRow` gains `employerId: string | null`.
- Every `companyKey(job.company)` in `match.ts` becomes `employerKey(job)`; `roleKey(employerKey(job), job.title)` keys `dedupeListings`.
- `BOARD_RANK` = `{ greenhouse: 0, ashby: 1, lever: 2, smartrecruiters: 3, keka: 4, workday: 5, workable: 6, zohorecruit: 7, naukri: 8, mock: 9 }`.
- `companyKey` stays exported for anything else that uses it. The rule names and messages stay the same.

### 4.9 Public pages: what shows and what never does

- **Public sources:** every source except `PRIVATE_SOURCES`.
- **A job is shown** when it is open, from a public source, and its company's `lastFetchedAt` is within 3 days.
- **An employer is listed** when `openJobs > 0`.
- **`/companies`:** the letter strip (A–Z, then 0–9 as "#") with counts, and the 30 employers with the most `openIndia`.
- **`/companies/browse/<letter>`:** listed employers whose `nameKey` starts with the letter (`0` for digits), by `nameKey`, 200 a page (`?page=2`). An unknown letter is a 404.
- **`/companies/<slug>`:**
  - Header: logo, name, website (when the domain is known), "N open jobs", and the boards it hires through.
  - Jobs: India and remote India first, newest first, then "Outside India"; 50 a page.
  - Each job links to `jobPath({ id, title, company: { name: Company.name } })` + `?s=co` (`Company.name`, so the link is the same canonical the `/j/` page uses).
  - An alias slug answers 308 to the live slug. An unlisted employer is a 404.
- **Never:** `raw`, `questions`, embeddings, anything about users, Naukri jobs or their counts.
- **Freshness:** pages revalidate hourly. The pages hold nothing per user, so they cache well.

### 4.10 Failure handling

- **A board page that does not load:** `domainCheckedAt` is still set (as logos do today), so it is looked at again after 30 days. A row with a domain is looked at again after 180 days.
- **A wrong join** is undone by `employer-set.ts --split <companyId>`: the row gets `domain = null`, `domainBasis = owner` and a one-row employer.
- **A page that fails to read** shows the error state; the app is unaffected.
- **`COMPANY_PAGES` off:** a 404.
- **`linkCompany` failing on one row** (for example a unique clash): logged and skipped; the next tick tries again.

### 4.11 Observability

`scripts/employers-report.ts` prints:
- **coverage:** per board, active rows, rows with jobs listed at the last read, how many of those have a domain, and the split by basis;
- **totals:** employers, multi-row employers, listed employers, open public jobs;
- **names disagree:** joined rows whose plain names share no word;
- **same name, other domain;**
- **one-row employers whose plain name equals a domain employer's** (candidates for the owner);
- **Naukri rows joined by a redirect;**
- **generic names left.**

`--coverage` prints only the first block. The ingest tick logs `facts n found of m` and `linked n (created a, merged b)`.

### 4.12 Security and privacy

- The pages show public postings and public company facts only, through named-column reads.
- No user data appears, and no Naukri listing.
- The reads are plain GETs of public board pages at today's logo pace: no login, no circumvention, no Naukri fetch.
- Overrides are by script; there is no admin UI.

### 4.13 Code map

The table in §4.1, plus the scripts:

| Script | Task |
|---|---|
| `scripts/public-sources-test.ts` | W0 |
| `scripts/employer-slug-test.ts` | W1 |
| `scripts/company-facts-test.ts`, `scripts/company-facts-backfill.ts` | W2 |
| `scripts/employer-link-test.ts`, `scripts/employers-link.ts`, `scripts/employers-report.ts`, `scripts/employer-set.ts` | W3 |
| `scripts/feed-dedupe-test.ts` | W4 |
| `scripts/company-pages-smoke.ts` | W6 |
| `scripts/job-posting-test.ts` | W7 |

### 4.14 Env (ARCHITECTURE §11 additions)

- `COMPANY_PAGES=1` turns the company pages on in production (on in development by default, like `SHARE_LINKS`).
- `FACTS_PER_TICK` (default 40, 0 turns it off).
- `APP_URL` gives canonical and sitemap URLs, as for share links.

---

## 5. UI

- Drawn first, for the owner's approval (W5, `design/companies.html`, with the ui-craft skill), to the house design: mobile-first at 390 px, centred at 480 px, ink with one lime fill, no gradients, no emoji, light and dark.
- `/companies`: title "Companies hiring", the letter strip, and "Most hiring in India" (logo tile, name, "N open jobs").
- Letter page: the same rows, alphabetical, paged.
- Company page:
  - the header (logo tile, name, website as a quiet link, "N open jobs");
  - "Hires through Greenhouse and Workday";
  - job rows like the feed's compact row (role, place chips, "x days ago"), India first, then "Outside India";
  - one prompt: "Let your agent apply", which opens `/sign-in` (signed in, the proxy sends that to `/feed`).
- States:
  - loading skeletons;
  - a letter with no companies ("No companies under Q yet");
  - an error with Try again;
  - a gone or unlisted company is the not-found page with a link to `/companies`.

## 6. API

No new API routes. The pages read through server components (`employer-pages.ts`). `lib/funnel.ts SOURCES` gains `co`.

---

## 7. Testing

Each script prints one PASS or FAIL line per check and a final PASS/FAIL, like `scripts/logos-test.ts`. Tests that write rows use a `stamp` in slugs and delete what they made in `finally`.

| Script | Checks |
|---|---|
| `public-sources-test` (W0) | `publicJob` of a Naukri job is null; `similarJobs` never returns one |
| `employer-slug-test` (W1) | the cases in §10.2 |
| `company-facts-test` (W2) | the cases in §10.3; no network |
| `employer-link-test` (W3) | the cases in §10.4, on throwaway `source = "mock"` rows |
| `feed-dedupe-test` (W4) | the cases in §10.5 |
| `company-pages-smoke` (W6) | HTTP against `npm run dev`, signed out; the cases in §10.7 |
| `job-posting-test` (W7) | `jobPostingJsonLd` cases in §10.8; no network |
| existing | `feed-sql-test`, `guards-test`, `logos-test` stay PASS |

## 8. Rollout

1. W0 any time: it fixes a public leak.
2. W1 on Neon (`migrate deploy`).
3. W2: the backfill in the background, rows with jobs first. About 2,300 rows matter for pages; all 31,375 take a few hours across boards in parallel.
4. W3: build once, then `linkPending` keeps it current. The report goes to the owner.
5. W4.
6. W5: the drawing, approved.
7. W6 and W7, flag off in production.
8. W8, with the owner's OK: `COMPANY_PAGES=1` (and `SHARE_LINKS=1`), then the sitemap goes to Search Console.

Rollback: turn the flag off. The data stays. The feed keys fall back per row.

Each task is a branch from `origin/main` with its own commit, merged to main before the next task starts.

## 9. Risks

- **A wrong join** (an agency's or parent's domain): the board's own field is the main source, the report lists joins whose names disagree, and a split is one command.
- **Coverage:** Greenhouse (1 of 3 samples) and Workday (0 of 2) rarely name a website. Their 572 and 344 employers with jobs lean on `job_links` and `name_evidence`. A row without a domain still gets its own page; it is just never merged.
- **Clearbit's free suggest may go away.** It is the last source, and is used only with evidence.
- **Stale jobs on pages:** only companies read in the last 3 days count. Closed jobs drop their markup.
- **Search quality:** thin pages (an employer with one job, listed per §11 item 5), duplicate content of the employer's own posting (we link the original and add the agent), and Google may not show the jobs at all.
- **Board terms on republishing public postings:** these feeds are public for embedding, and each page links the original. Naukri is never republished.
- **A slug, once public, is forever:** aliases carry every merge.

## 10. Tasks and build sheets

Entries are in [TASKS.md](TASKS.md). Each entry links its sheet below. A sheet is the order of work, the exact names, the test cases and the traps. It does not repeat §4. If a sheet and the code disagree (a function renamed since 27 Nov), follow the code and note it in the Done line.

### 10.1 W0 — No Naukri job on a public page

1. In `src/modules/jobs/public.ts`, `publicJob` returns null when `SITES.includes(job.source)` (import `SITES` from `@/modules/sources/sites`).
2. In `similar.ts`, the candidate query excludes `SITES` (`AND j.source <> ALL(${[...SITES]}::text[])`).
3. In `src/app/(app)/jobs/[id]/page.tsx`, the Share button also requires `!SITES.includes(job.source)`.
4. `scripts/public-sources-test.ts`:
   - makes a mock company and a `source = "naukri"` job, plus a `greenhouse` job with an embedding copied from any embedded job (or the test skips the similar check and says so);
   - asserts `publicJob(naukri)` is null and `publicJob(greenhouse)` is not;
   - asserts no `similarJobs` result has source `naukri`;
   - deletes its rows.

Trap: `similarJobs` may read `APPLY_BOARDS`, which includes Naukri when it is switched on. The exclusion must hold either way.

### 10.2 W1 — Tables and slug

1. Edit `prisma/schema.prisma` as in §4.3, write the migration file exactly as in §4.3, then run `npx prisma generate`.
2. Run `npx prisma migrate status`. It must list only `20261127090000_employers` as not applied. If it lists others, stop and ask.
3. Run `npx prisma migrate deploy`.
4. `src/lib/employer-slug.ts`: export `RESERVED_SLUGS`, `slugBase(name)`, `employerSlug(name, domain, taken)` and `nameKeyOf(name)`. `nameKeyOf` is the NFKD lower-case ASCII with non-alphanumerics removed; empty → `"0"`; a leading digit stays.
5. `scripts/employer-slug-test.ts` cases:
   - "Razorpay" → `razorpay`;
   - "Zoho Corporation Pvt. Ltd." → `zoho-corporation-pvt-ltd` (slugs keep legal words; `plainName` is for display only);
   - "Café Coffee Day" → `cafe-coffee-day`;
   - 80 characters → at most 60 and no trailing `-`;
   - "X" → `x-company`;
   - "Browse" → `browse-company`;
   - "" → `company`;
   - with `taken = {glide}`: ("Glide", "glideapps.com") → `glide-glideapps`, and ("Glide", null) → `glide-2`;
   - with `taken = {glide, glide-glideapps}`: ("Glide", "glideapps.com") → `glide-2`;
   - no result ever contains `.`.
6. ARCHITECTURE: §4 gets the two models and the `Company` columns. A new §6.25 "Employers (Phase W)" holds the decision line from the top of this file and §4.4's rules in five lines.

Traps:
- Never `migrate dev`, never `migrate diff` against Neon.
- The `Job` index locks `Job` writes for its build (seconds). Run it when no ingest burst is due, or accept a short wait.

### 10.3 W2 — Facts: domain and name per row

1. In `logos.ts`, export `jobHosts`, `domainByName`, `mentionedInJobs`, `BOARD_PAGE` and `NOT_OWN_SITE` (no behaviour change; `logos-test` stays PASS).
2. `domains.ts`: `employerDomain(urlOrHost: string): string | null` and `isGenericCompanyName(name: string): boolean`, as in §4.4.
3. `company-facts.ts`:
   - `export type DomainBasis = "board" | "redirect" | "job_links" | "name_evidence" | "owner"`.
   - `export function websiteFromBoardPage(source: string, page: string): string | null`.
   - `export function nameFromBoardPage(source: string, page: string): string | null`.
   - `export async function redirectDomain(companyId: string): Promise<string | null>`: for a Naukri row, its jobs with `applyVia` → `boardFromUrl(applyUrl)` → that board `Company`'s `domain`.
   - `export async function fetchCompanyFacts(company: { id: string; source: string; slug: string; name: string }): Promise<{ domain: string | null; basis: DomainBasis | null; name: string | null }>`. It reads the page (§4.5) and tries board → redirect (Naukri only) → `job_links` → `name_evidence`. `name` is the page's name, or null.
   - `export async function refreshCompanyFacts(options: { limit: number; write: boolean; sources?: string[]; pauseMs?: number; log?: (line: string) => void }): Promise<{ checked: number; withDomain: number; renamed: number }>`.
4. `refreshCompanyFacts` selection:

   ```sql
   SELECT id, source, slug, name FROM "Company"
   WHERE source = ANY($sources) AND "domainBasis" IS DISTINCT FROM 'owner'
     AND (active OR source = ANY($sites))
     AND ("domainCheckedAt" IS NULL
          OR ("domain" IS NULL AND "domainCheckedAt" < now() - interval '30 days')
          OR "domainCheckedAt" < now() - interval '180 days')
   ORDER BY ("indiaOpen" > 0) DESC, (coalesce("lastFetchCount", 0) > 0) DESC, "domainCheckedAt" ASC NULLS FIRST
   LIMIT $limit
   ```

   - `sources` defaults to `[...LOGO_SOURCES, ...SITES]`.
   - Write: `domain`, `domainBasis`, `domainCheckedAt = now()`, and `name` only when `isGenericCompanyName(name)` and the page gave one.
   - Pause `pauseMs` (300) between rows.
5. `ingest-tick.ts`: a facts sweep beside the logo sweep, with its own running flag and `FACTS_PER_TICK`.
6. `scripts/company-facts-backfill.ts [--write] [--limit N] [--source s]`:
   - one loop per source, run with `Promise.all` (different hosts);
   - each loop calls `refreshCompanyFacts({ limit: 200, sources: [s] })` until `checked = 0`, printing a line per batch;
   - run it in the background: `npx tsx scripts/company-facts-backfill.ts --write > %TEMP%\facts.log`.
7. `scripts/employers-report.ts --coverage` (the first block of §4.11). W3 adds the rest.
8. `company-facts-test` cases:
   - each board's extractor on its live snippet (step 9);
   - the board's field missing → null;
   - `employerDomain`: `https://www.Razorpay.com/careers` → `razorpay.com`; `careers.toddleapp.com` → `toddleapp.com`; `acme.co.uk/x` → `acme.co.uk`; `foo.github.io` → `foo.github.io`; `linkedin.com/company/x` → null; `jobs.lever.co/x` → null; `gmail.com` → null; `10.0.0.1` → null; `""` → null;
   - `isGenericCompanyName`: "Careers" true, " jobs " true, "Careem" false;
   - Zoho with `hide_visit_website: true` → no website.
9. Before writing the extractors, open one live page per board in the browser pane (signed out). Copy the 200–600 characters around the field into the test as the fixture, and adjust the §4.5 regex if the page differs. Note any change in the Done line.

Traps:
- Lever's header logo link is the jobs page, not the site; only the footer link counts.
- Keka's website can be `careers.x.com`; `employerDomain` drops the subdomain through `siteRoot`.
- Do not change how logos are found. A logo count before and after goes in the check.
- On Windows a stopped background script can leave node children: kill the tree by PID.

### 10.4 W3 — Linking

1. `employers.ts`:
   - `export const PRIVATE_SOURCES`.
   - `export function displayName(rows: Array<{ name: string; source: string }>, domain: string | null): string`.
   - `export async function linkCompany(companyId: string): Promise<"kept" | "created" | "joined" | "merged" | "domain_set">`.
   - `export async function linkPending(limit = 500): Promise<{ linked: number; created: number; merged: number }>`.
   - `export async function refreshEmployer(employerId: string, tx?: Prisma.TransactionClient): Promise<void>`.
   - `export async function refreshEmployerCounts(): Promise<number>`.
   - `export async function buildAllEmployers(options: { write: boolean }): Promise<{ employers: number; rows: number }>`.
   - Use `$transaction` with the advisory lock from §4.6.
2. `buildAllEmployers` refuses to run when `Employer` has any row. Otherwise:
   1. Load every `Company` (id, source, slug, name, domain, domainBasis, stage, logoUrl, indiaOpen, lastFetchCount).
   2. Group by domain; each null-domain row is its own group.
   3. Sort groups by summed `lastFetchCount` descending, so the bigger employer gets the bare slug.
   4. Per group, compute `displayName`, `employerSlug` (one shared `taken` set), `nameKeyOf`, logo and stage; the id is `crypto.randomUUID()`.
   5. Insert employers in chunks of 1,000 (`createMany`).
   6. Set `Company.employerId` and `linkedAt = now()` in chunks of 1,000 with one `UPDATE … FROM (VALUES …)` each.
   7. Run `refreshEmployerCounts()`.
3. `ingest-tick.ts`: `linkPending()` after the facts sweep in the same background chain. `after-ingest.ts`: `refreshEmployerCounts()` hourly, beside the cleanup, with its own timer.
4. `scripts/employers-link.ts`:
   - `--write` runs `buildAllEmployers` when the table is empty, else `linkPending` in a loop until 0;
   - dry run by default, printing what it would do.
5. `scripts/employers-report.ts`: all of §4.11.
6. `scripts/employer-set.ts` (each prints before and after):
   - `--company <id> --domain <d>`: sets the domain with `owner` basis, then `linkCompany`;
   - `--split <companyId>`;
   - `--employer <slug> --name "<n>"`: sets `nameBasis = owner`.
7. `employer-link-test` cases (mock rows, `domainCheckedAt` set by the test, `linkCompany` called directly):
   1. Two rows, one domain → one employer.
   2. Two rows named Glide, `glideapps.com` and `glide.io` → two employers, slugs `glide` and `glide-…`.
   3. A row without a domain → a one-row employer.
   4. That row gets a domain held by employer E → it joins E, its old slug is an alias of E, and its old employer is gone.
   5. A one-row employer whose row gets a new domain no one holds → same employer, domain set, slug unchanged.
   6. `--split` survives a later `linkCompany`.
   7. A Naukri row with a job whose `applyUrl` is on the test Greenhouse row's board, after `fetchCompanyFacts` (or a direct `redirectDomain` + write) → the Greenhouse row's employer.
   8. `refreshEmployerCounts` counts a fresh open job and leaves out a Naukri job and a job of a company read 4 days ago.
   9. `nameBasis = owner` survives `refreshEmployer`.
8. Done check: on Neon, `employers-link.ts --write`, then the report. Paste totals and the "names disagree" list (first 30 lines), and check Glide, Ghost, Reach and Slate by name.

Traps:
- `createMany` does not fill `@updatedAt` for raw `VALUES`. Use Prisma's `createMany` (it does) or set `updatedAt` yourself.
- Do not run `buildAllEmployers` twice. Its guard is the empty table.

### 10.5 W4 — Feed and guards

1. `history.ts`: add `employerKey`, rewrite `countedApplications`, `appliedRoleKeys`, `feedHistory` and `historyFor` as §4.8 says, and export `employerKey` from `governance/index.ts`.
2. `match.ts`:
   - add `c."employerId"` to the `FeedRow` select (beside `j."companyId", c.name AS company`) and `employerId: string | null` to `FeedRow`;
   - replace the three `companyKey(job.company)` uses with `employerKey(job)`;
   - apply §4.8's `BOARD_RANK`.
3. Search for other `companyKey(` uses (`git grep -n "companyKey("`) and change any that decide a duplicate or a cap.
4. `feed-dedupe-test` cases. The test calls `dedupeListings` directly with built rows; the guard cases use `historyFor` on mock rows with an `Application`.
   1. Employer E has the same title on a greenhouse row and a naukri row → one row kept, the greenhouse one.
   2. Two employers both named "Glide", same title → two rows.
   3. A counted application to E's greenhouse job → `historyFor` on E's naukri job says `duplicateRole`.
   4. 3 applications this week to E across two rows → `companyWeekCount = 3` for a third row of E.
   5. An unlinked row (`employerId` null) never matches another row by name.
5. Run `guards-test` and `feed-sql-test`. Note the owner's feed count before and after (the `scripts/` feed counter the relevance phase used, or the feed API's count for their user).

### 10.6 W5 — Drawing

1. Load the ui-craft skill. Read `docs/DESIGN.md` and the existing `design/share.html` and `design/feed.html` for rows, chips and the header.
2. `design/companies.html`, one file with sections:
   - index;
   - letter page;
   - company page with many jobs;
   - company page with one job;
   - jobs only outside India;
   - a letter with none;
   - not found.
   Each at 390 px and desktop, light and dark, using only the tokens in `src/app/globals.css`.
3. Add one line to `docs/DESIGN.md` naming the file. Show it to the owner; their words of approval go in the Done line.

### 10.7 W6 — Pages

1. Read `node_modules/next/dist/docs/01-app` on caching and revalidation for Next 16 first, and follow how `src/app/j/[slug]` is built (no `(app)` shell, own layout width).
2. `src/lib/company-pages-gate.ts companyPagesEnabled()`, the same shape as `share-gate.ts` with `COMPANY_PAGES`.
3. `src/proxy.ts`, before the signed-in logic: `/companies` and `/companies/…` → `companyPagesEnabled() ? next : 404`. No visitor cookie here.
4. `src/modules/jobs/employer-pages.ts` (named columns only, `PRIVATE_SOURCES` excluded, the 3-day rule in SQL):
   - `letterCounts(): Promise<Array<{ letter: string; count: number }>>`
   - `topEmployers(n = 30): Promise<EmployerRow[]>`
   - `employersByLetter(letter: string, page: number): Promise<{ rows: EmployerRow[]; total: number }>`
   - `employerPage(slug: string, page: number): Promise<{ kind: "page"; employer: EmployerHead; india: JobRow[]; abroad: JobRow[]; total: number } | { kind: "redirect"; slug: string } | null>`
   - `EmployerRow = { slug, name, logoUrl, openJobs, openIndia }`
   - `EmployerHead = EmployerRow & { domain: string | null; boards: string[] }`
   - `JobRow = { id, title, location, remoteType, postedAt, source, companyName }`
5. Pages:
   - `src/app/companies/page.tsx`;
   - `src/app/companies/browse/[letter]/page.tsx` (`letter` is `a`–`z` or `0`; anything else is `notFound()`);
   - `src/app/companies/[slug]/page.tsx` (`permanentRedirect` for an alias, `notFound()` for null);
   - `loading.tsx`, `error.tsx` and `not-found.tsx` in `src/app/companies/`;
   - `generateMetadata` with title, description, `alternates.canonical`, and `robots` index;
   - `Organization` and `BreadcrumbList` JSON-LD per the Next guide (escape `<`).
6. Links to the company page, when `companyPagesEnabled()` and the employer is listed, from `/j/[slug]` (the company name in the header) and from `src/app/(app)/jobs/[id]/page.tsx`. Add `"co"` to `lib/funnel.ts SOURCES`.
7. `company-pages-smoke` (`BASE=http://localhost:3000`, signed out, against `npm run dev` with data from W3). It finds its own fixtures with SQL: a listed multi-board employer, a Naukri-only employer, an alias if any (else it makes one on a throwaway employer and removes it). Checks:
   - `/companies` 200 with letter links;
   - `/companies/browse/q` 200;
   - `/companies/browse/%2E` 404;
   - the multi-board page lists jobs from 2 sources;
   - the Naukri-only slug 404;
   - no response body contains `naukri.com`;
   - the alias gives 308 to the live slug;
   - `/companies/x.y` never reaches a page (the proxy's matcher skips dotted paths, so the route must `notFound()` any slug with a dot);
   - with `COMPANY_PAGES=0` and `NODE_ENV=production`, the gate function returns false (unit check, not HTTP).
8. Screenshots at 390 px, light and dark, against W5's drawing.

Built differently from step 5 (27 Nov): a `loading.tsx` starts the response, so `notFound()` and redirects under it answer 200 (Next's `loading.md`). Existence is therefore settled in a `layout.tsx` (`[slug]/layout.tsx` via `employerRoute`, `browse/[letter]/layout.tsx`), and each loading screen sits below its layout (`[slug]/`, `browse/[letter]/`, and the index in a `(index)` route group, so none wraps another segment). The pages are dynamic (they read `?page=`), so there is no hourly `revalidate`.

### 10.8 W7 — Search

1. `src/lib/job-posting.ts`: `jobPostingJsonLd(job: PostingInput, url: string): Record<string, unknown> | null`, pure. It returns null for a closed job, a private source, or a company not read in 3 days.
   - `PostingInput` = the fields `publicJob` reads, plus `country`, `eligibility`, `kind`, `companyLastFetchedAt`, and `employer: { name, domain, logoUrl } | null`. Extend `publicJob` with those, named columns only.
   - `employmentType` map: `full_time` → `FULL_TIME`, `part_time` → `PART_TIME`, `contract` → `CONTRACTOR`, `internship` → `INTERN`, `temporary` → `TEMPORARY`; anything else is left out.
   - Remote: `remoteType` remote and eligibility `remote_india` → `jobLocationType: "TELECOMMUTE"` and `applicantLocationRequirements: { "@type": "Country", name: "India" }`.
   - Otherwise `jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: <the first comma part of location>, addressCountry: <country as stored, when two letters> } }`.
   - `baseSalary` only when `salaryMin` and `salaryCurrency`: `{ "@type": "MonetaryAmount", currency, value: { "@type": "QuantitativeValue", minValue, maxValue?, unitText: YEAR | MONTH | HOUR } }`.
   - `hiringOrganization: { "@type": "Organization", name, sameAs: https://<domain> (when known), logo }`.
2. `src/app/j/[slug]/page.tsx`:
   - the JSON-LD script when the builder gives one;
   - `robots: { index: true, follow: true }` exactly then, else `noindex` as today;
   - the description must be visible on the page: if `share-sections` shows only a summary, add a "Full posting" section with the stored description (plain text with line breaks, as the app's job page shows it).
3. `src/app/sitemap.ts`:
   - `generateSitemaps()` gives id 0 (`/companies`, letter pages, listed employers) and ids 1…n (open public jobs, 45,000 each, ordered by id; jobs only when `shareLinksEnabled()`);
   - nothing at all when `companyPagesEnabled()` is false.
4. `src/app/robots.ts`:
   - allow `/companies`, `/j/`;
   - disallow `/api/`, `/feed`, `/applications`, `/account`, `/answers`, `/gaps`, `/governance`, `/jobs/`, `/onboarding`, `/mock`, `/dev`, `/sign-in`;
   - `sitemap`: the absolute URL of each generated sitemap, as the Next sitemap doc names them.
5. Update `docs/share/TDD.md` §1 (the noindex non-goal now reads "until Phase W7") and ARCHITECTURE §6.23.
6. `job-posting-test` cases:
   - an open Greenhouse job in Bengaluru with pay → every required property, valid `JSON.parse` of the escaped string;
   - remote India → `TELECOMMUTE` + India;
   - closed → null;
   - naukri → null;
   - read 4 days ago → null;
   - no salary → no `baseSalary`;
   - `kind = gig` → no `employmentType`;
   - a description containing `</script>` → escaped.

### 10.9 W8 — Switch-on

1. With the owner's OK, on production: `COMPANY_PAGES=1` (and `SHARE_LINKS=1` if off), then deploy.
2. Signed out on a phone-width browser: `/companies` → a company → a job → Apply → Google → onboarding → the application. Use the owner's real profile on one real job the agent applies to.
3. Check: `FunnelEvent` has a `view` with `source = co`; the application ends `submitted` (paste its id).
4. The owner submits the sitemap in Search Console and runs Google's Rich Results Test on one job and one company page (screenshots).
5. Run `employers-report.ts` and add it to the weekly board report.

---

## 11. Decisions closed with the owner (27 Nov: "yes plan it end to end and build it")

1. Naukri on public pages: hidden entirely, with no link out and no count.
2. `/j/` pages of open public jobs are indexable and carry `JobPosting`. This reverses Phase U's `noindex` non-goal (W7).
3. Jobs outside India are shown on company pages under "Outside India".
4. URLs: `/companies`, `/companies/browse/<letter>`, `/companies/<slug>`.
5. Employers with one open job are listed.
6. Groups and subsidiaries stay separate by domain; the owner joins them by override only.
7. The owner reviews the report's "names disagree" and "same name, other domain" lists, not every multi-board employer.

## 12. What this sets up: non-tech roles (the follow-on phase, not designed here)

The owner's next step is non-tech jobs: sales, operations, support, finance, healthcare, retail. This design gives that phase:
- one employer to attach an industry to;
- pages that already list every role an employer has (`Job.function = non_tech` jobs are stored today but hidden from most feeds);
- a count of which boards non-tech employers hire through, which picks the next adapters (Darwinbox and SuccessFactors from Phase V, Naukri, others).

The follow-on designs:
- fields and tracks for non-tech roles (taxonomy, `classifyTitle`, `roleFamily`);
- matching without a skills vocabulary;
- onboarding that asks a non-tech candidate the right few things;
- the adapters and agent work those boards need;
- company pages filtered by field.

Its own TDD, after W4.

## 13. Sources

- Read-only queries on the production database, 26 Nov 2026: rows, open jobs, logos per board; repeated names; generic names; Naukri `raw` keys.
- Public board reads, 26 Nov 2026, no login:
  - `boards-api.greenhouse.io/v1/boards/<slug>` and `job-boards.greenhouse.io/<slug>` (stripe, razorpaysoftwareprivatelimited, groww, anthropic);
  - `api.lever.co/v0/postings/<slug>` and `jobs.lever.co/<slug>` (cred, meesho, palantir);
  - `jobs.ashbyhq.com/<slug>` and `api.ashbyhq.com/posting-api/job-board/<slug>` (ramp, notion, linear);
  - `apply.workable.com/api/v1/accounts/<slug>/` (huggingface, cleo-ai, toggl);
  - `api.smartrecruiters.com/v1/companies/<id>/postings` and `jobs.smartrecruiters.com/<id>/<posting>` (BoschGroup, ServiceNow);
  - `<slug>.keka.com/careers/api/organization/default/careerportalinfo` (toddle, accredian, techdome, jupiter);
  - `artingdigital.zohorecruit.in/jobs/Careers`, `zenatta.zohorecruit.com/jobs/Careers`;
  - Workday `…/wday/cxs/<t>/<site>/jobs` and the job JSON (nvidia.wd5, browserstack.wd3);
  - `autocomplete.clearbit.com/v1/companies/suggest?query=Razorpay`.
- Google Search Central, job posting structured data: markup only on a single job's page, the description visible there, expired jobs drop the markup.
- Next 16 docs in `node_modules/next/dist/docs/01-app`: `02-guides/json-ld.md`; `03-api-reference/03-file-conventions/01-metadata/sitemap.md` and `robots.md`.
- Code read on origin/main `a7a1c0c`:
  - `modules/jobs/logos.ts`, `public.ts`, `similar.ts`, `match.ts`, `ingest.ts`, `after-ingest.ts`, `boardSeeds.ts`;
  - `modules/governance/history.ts`, `modules/sources/sites.ts`;
  - `worker/handlers/ingest-tick.ts`, `src/proxy.ts`;
  - `lib/share-gate.ts`, `lib/job-slug.ts`, `lib/funnel.ts`;
  - `app/j/[slug]/page.tsx`, `app/(app)/jobs/[id]/page.tsx`;
  - `docs/share/TDD.md` §1 and §4.
