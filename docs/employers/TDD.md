# Employers: one real company above its board accounts, and public A–Z company pages — technical design (Phase W)

Version 1, 26 Nov 2026. The owner, 25–26 Nov: the company is the backbone. That means real employers, with A–Z pages people can find, that are easy to track and good for users and for search. After that comes widening to non-tech jobs and building the agent and adapters for them. This design covers step 1 only. ARCHITECTURE stays the source of truth: W1 copies the decisions here into §4 and a new §6.25, W4 updates §6.3 and §6.9, and W7 updates §6.23.

The decision in one line: **an `Employer` is one website domain; every `Company` row (one account on one board) belongs to one employer; names never merge rows on their own; `Job` stays under `Company`.**

---

## 1. Goals and non-goals

**Goals**
- G1. Every `Company` row belongs to exactly one `Employer`, and one employer is one real business, identified by its own website's registrable domain (`razorpay.com`).
- G2. Rows join an employer only when their domains agree. Two businesses with the same name stay apart (Glide, Ghost, Reach, Slate on Ashby, Lever and Workable). A row whose domain we cannot find is its own employer until one is found.
- G3. Every employer has a real name: the 375 Zoho Recruit rows named "Careers" and Workday's coded legal names ("0028 … Private Limited") are fixed from the board page.
- G4. Public pages: `/companies` (A–Z) and `/companies/<slug>` with every open job across the employer's boards. Only employers with open public jobs are listed, Naukri listings are never shown publicly, and search engines can index the pages: `Organization` data on the company page and `JobPosting` on each job's `/j/` page.
- G5. The feed shows one employer's same role once, even when two boards list it. The duplicate guard and the per-company weekly cap count the employer, not the spelling of its name.
- G6. The shape carries the next phase (non-tech roles, §12) without another remodel.

**Non-goals**
- Non-tech roles themselves: fields and tracks, matching, onboarding and adapters (§12, the follow-on phase).
- Company groups and parents (Tata Steel vs TCS, Bosch's legal entities): one domain is one employer, and groups come later if ever.
- Employer accounts, claims, edits by employers, reviews, ratings, salaries by company, and following a company.
- Moving `Job` under `Employer` or changing `Job`'s `@@unique([source, externalId])`.
- LinkedIn or Crunchbase company data, paid company databases, and any crawl of Naukri.
- Merging by an LLM's judgement.

---

## 2. Facts the design rests on (measured and read, 26 Nov)

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

- 1,362 normalised names have more than one row (3,212 rows), and 1,095 of those names span more than one board. Among rows **with an open job** only 54 names repeat, 8 of them across boards. Only 6 name-and-title pairs are open on two boards today. So today's feed has few cross-board duplicates. The employer matters most for the pages, for the guards (where a shared name wrongly joins two businesses) and for the boards and Naukri rows still to come.
- 375 Zoho Recruit rows (plus one Lever and one Greenhouse row) are named "Careers" or "Jobs".
- `Company` is unique on `(source, slug)`. `Job` has no index on `companyId`, so a page or count by company needs one (§4.3).

**Our code** (main at `ea28e9b`):
- `modules/jobs/logos.ts` already finds a website on its way to a logo, then throws the domain away and keeps only the icon URL. It uses `websiteFromHtml` (Ashby `publicWebsite`, Workable `url`), `ownSiteOf` (the host the company's job links point to, when named like the company), `domainByName` (Clearbit's free suggest, accepted only with evidence in the company's own postings), `siteRoot`, and `NOT_OWN_SITE` (ATS, socials, shorteners). `refreshLogos` runs from the ingest tick at a fixed pace.
- The feed (`match.ts dedupeListings`) keys a role by `roleKey(companyKey(name), title)`. `governance/history.ts` keys the duplicate guard and `max_per_company_per_week` by `companyKey(name)`, so two different businesses called Glide share a cap, and "Razorpay" and "Razorpay Software Private Limited" do not.
- Phase U's `/j/<slug>-<id>` job page is public behind `SHARE_LINKS`, carries a "View the original posting" link, and is `noindex` (a Phase U non-goal). `src/proxy.ts` lets `/j/` through, and its matcher skips any path with a dot, so a public slug must never contain one.
- Naukri `Job.raw` holds `applyRedirectUrl`, `companyApplyJob`, `consultant`, `jdURL` and similar keys. A Naukri job that redirects to a board we read names that board's account.

**Boards** (public, no-login reads, 26 Nov, 2–3 companies each; §13):

| Board | Where the website is | Seen |
|---|---|---|
| Ashby | board page `window.__appData.organization.publicWebsite` (the posting API has none) | 3 of 3 |
| Workable | `GET apply.workable.com/api/v1/accounts/<slug>/` → `url` | 3 of 3 |
| Lever | board page footer link "<Name> Home Page" (`.main-footer-text a`); the header logo link is unreliable; the API has none | 3 of 3 |
| SmartRecruiters | a job page's header logo link (`header.jobad-header .header-logo a[href]`); the API's `company` is only `{identifier, name}` | 2 of 2 |
| Keka | `careerportalinfo` → `companyWebsite` (may be empty, missing or a `careers.` host); `socialLinks` type 1 is LinkedIn | 2 of 4 |
| Zoho Recruit | portal page, entity-encoded JSON: `org_info.website`, `org_info.company_name`, `org_info.type` (`staffing` or `internal`), `hide_company_name`; `og:site_name` is the name | 2 of 2 |
| Greenhouse | board page `boardConfiguration.logo.href` when set (can be a careers page), else the job links' host when the company hosts its board; the API has only `name` | 1 of 3 |
| Workday | none: `hiringOrganization.url` and `sameAs` are empty; it gives the legal entity name ("BrowserStack Software Private Limited", "VN01 NVIDIA Vietnam Company Limited") | 0 of 2 |
| Naukri | not read (its terms); a redirect to a board we read joins that board's account (§4.7) | — |

Clearbit's free suggest still answers. For "Razorpay" it gives `razorpay.com` first, then four look-alikes, so it is a candidate source, never proof.

**Search engines:** Google reads `JobPosting` only on the page of a single job, never on a page listing jobs. The description in it must be visible on that page. An expired job loses its markup or its page. A company page carries `Organization` data.

---

## 3. Options and decision

**What identifies a real employer**

| Option | Same business on two boards | Two businesses, one name | Verdict |
|---|---|---|---|
| A. Normalised name (today's `companyKey`) | misses "Razorpay" vs its legal name | merges Glide with Glide | No |
| **B. The website's registrable domain, from each board's own page, else evidence** | joins them | keeps them apart | **Chosen** |
| C. An LLM asked "same company?" | often | often | No: not reproducible, no evidence to show |
| D. A paid company database (Clearbit, Crunchbase, LinkedIn ids) | yes | yes | No: cost and terms; Clearbit's free suggest stays a candidate source only |
| E. Owner curation | yes | yes | Only as overrides on top of B |

**Where the employer sits**

| Option | Verdict |
|---|---|
| **A. New `Employer` table, `Company.employerId`; `Job` stays under `Company`** | **Chosen**: no change to ingest, cadence, `(source, slug)` or any `Job` query; one join to group |
| B. Rename `Company` to `BoardAccount` and make `Company` the employer | No: touches every module and script for no gain |
| C. Only a computed `employerKey` column on `Company` | No: nowhere to keep a slug, a name, aliases or counts |

**Decision.** Option B for identity and A for placement. The domain comes from the board's own page in one read shared with the logo pass. When the board gives none, it comes from the company's own job links, and last from Clearbit's suggest with evidence in its postings, as `logos.ts` already does. A row without a domain is its own employer. The owner can set, split or rename through a script, and the automatic pass never overrides that.

---

## 4. Architecture

### 4.1 Components

1. `modules/jobs/company-facts.ts`: `fetchCompanyFacts(source, slug, name)` reads the board page once and returns `{ logoUrl, domain, basis, boardName }`. The logo code moves here from `logos.ts` unchanged, `refreshLogos` becomes `refreshCompanyFacts`, and the ingest tick calls it at the same pace.
2. `modules/jobs/domains.ts`: `registrableDomain(host)` (`siteRoot` plus the shared-host rule in §4.4), `NOT_EMPLOYER_HOST`, and the per-board extractors (§4.5).
3. `modules/jobs/employers.ts`: `linkCompany(id)`, `linkPending()`, `refreshEmployer(id)`, `refreshEmployerCounts()`, `mergeEmployers(survivor, loser)`.
4. `src/lib/employer-slug.ts`: `employerSlug(name, domain, taken)` and the reserved words.
5. `modules/jobs/employer-pages.ts`: the public reads (index, letter, one employer and its jobs), with named columns only.
6. `src/app/companies/page.tsx`, `browse/[letter]/page.tsx` and `[slug]/page.tsx`, with loading, error and not-found states, public behind `COMPANY_PAGES` (`src/lib/company-pages-gate.ts`, `src/proxy.ts`).
7. The `/j/` page gains `JobPosting` JSON-LD and a link to its company page. `src/app/sitemap.ts` and `src/app/robots.ts` are new.
8. Scripts: `company-facts-backfill.ts`, `employers-link.ts`, `employers-report.ts`, `employer-set.ts`.

The web app imports only `modules/jobs` files that load no browser, never `@/modules/apply` (it 500s on Vercel).

### 4.2 Search engines

- `/companies`, the letter pages and the company pages are indexable, with a canonical URL from the app's public base URL, `Organization` (name, `url` = `https://<domain>`, `logo`) and `BreadcrumbList`. They carry no `JobPosting`.
- An open public job's `/j/` page carries `JobPosting` and is indexable. A closed job, a Naukri job and a job whose company was not read in 3 days carry none and say `noindex`. This reverses Phase U's "noindex" non-goal (owner decision, §11 item 2).
- `JobPosting` fields: `title`; `description` (the posting, shown on the page); `datePosted` (`postedAt`); `validThrough` only when the board gives one; `hiringOrganization` (the employer's name, `sameAs` its website, `logo`); `jobLocation` from the stored place, or `jobLocationType: TELECOMMUTE` with `applicantLocationRequirements` India for remote India; `employmentType` from `Job.kind`; `baseSalary` only from the board's own pay fields. Nothing is inferred to fill a field.
- `sitemap.ts` lists employers with open public jobs and their open public jobs, split into several files past 50,000 URLs. `robots.ts` allows `/companies` and `/j/` and disallows the app, `/api` and `/mock`.

### 4.3 Data model

One migration, `employers`, hand-written SQL applied with `npx prisma migrate deploy` (never `migrate dev`, never `migrate diff` with the real database as shadow).

```prisma
model Employer {
  id          String    @id @default(cuid())
  slug        String    @unique // /companies/<slug>: [a-z0-9-], 60 characters at most, never changed once public
  name        String    // display name (§4.4)
  domain      String?   @unique // registrable domain, "razorpay.com"; null: not found yet (a one-row employer)
  domainBasis String?   // board | job_links | name_evidence | redirect | owner (copied from the deciding row)
  logoUrl     String?
  stage       String?   // startup | midsize | mnc: the owner's seed wins, else the most common among its rows
  openJobs    Int       @default(0) // open public jobs (§4.9), refreshed after ingest; the A–Z pages read it
  openIndia   Int       @default(0)
  nameKey     String    // first letter bucket and sort key: lower-case ASCII of name ("0" for a digit)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  companies   Company[]
  aliases     EmployerAlias[]

  @@index([nameKey, openJobs])
}

model EmployerAlias {
  slug       String   @id // a slug that once answered: 308 to the employer's live slug
  employerId String
  createdAt  DateTime @default(now())
  employer   Employer @relation(fields: [employerId], references: [id], onDelete: Cascade)
}

// Company (one account on one board) gains:
//   employerId      String?   // null only between a new row's creation and the next linkPending()
//   domain          String?   // what this row's own evidence says; may disagree with nothing (§4.4)
//   domainBasis     String?   // board | job_links | name_evidence | redirect | owner
//   domainCheckedAt DateTime? // null: not checked yet (W2's backfill resumes on it)
//   employer        Employer? @relation(fields: [employerId], references: [id])
//   @@index([employerId])
// Job gains @@index([companyId, closedAt]): the company page and the counts read by company.
```

`Company.name` keeps the board's name, fixed in place when it was generic (§4.4). `Employer.slug` and its aliases share one namespace: a new slug may not equal an alias.

### 4.4 Identity rules: domain, name, slug

**Domain**
1. The host is lower-cased, `www.` is dropped, and the registrable domain is kept (`careers.toddleapp.com` → `toddleapp.com`, `acme.co.uk` stays, `siteRoot`).
2. On shared hosting the domain keeps one more label, so `acme.github.io` is not `github.io`. The list: `github.io vercel.app netlify.app herokuapp.com wixsite.com webflow.io framer.website notion.site blogspot.com wordpress.com carrd.co sites.google.com`. No new library; the list sits in `domains.ts`.
3. Never an employer domain: ATS and job boards, socials, link shorteners, mail providers (`NOT_OWN_SITE` plus `gmail.com outlook.com yahoo.com linktr.ee linkedin.com facebook.com instagram.com x.com twitter.com medium.com`).
4. Evidence, in order. The first that gives an acceptable domain wins.

| Basis | Source | Accepted when |
|---|---|---|
| `owner` | `employer-set.ts` | always; never overwritten |
| `board` | the board page's own website field (§4.5) | rules 1–3 pass |
| `redirect` | a Naukri job redirects to a board account we read (§4.7) | that account has an employer |
| `job_links` | the host most of the row's apply links point to (`ownSiteOf`) | named like the company (`ownSiteOf`'s test) |
| `name_evidence` | Clearbit's suggest for the plain name (`domainByName`) | named like the company and the domain appears in the row's own postings |

**Joining.** Rows with the same domain are one employer, whatever their names. A join whose names share no word (after `plainName`) is still made, and it is listed in the report for a look (§4.11). Two rows with the same name and different domains are two employers. A row without a domain is a one-row employer.

**Name.** A generic board name ("Careers", "Jobs", "Career Portal", or empty) is replaced from the board page (Zoho `org_info.company_name` or `og:site_name`, Keka `name`, Workable `name`, Ashby `organization.name`, Workday's `hiringOrganization.name` through `plainName`). The employer's display name comes from, in order:
1. The owner's name.
2. A name the company set itself on Ashby, Workable or Keka.
3. The most common `plainName` among its rows.
4. The shortest.

Names drop legal suffixes and codes (`plainName`), keep their own capitals, and are never translated.

**Slug.**
- The slug is the name in lower-case ASCII with hyphens, 60 characters at most, with no dots.
- If it is taken, the domain's first label is appended (`glide-glideapps`). If that is taken too, `-2`, `-3` and so on.
- Reserved: `browse`, `a-z`, `search`, `new`, `api`, `page`, and any one-character slug.
- A slug never changes once the pages are on (`COMPANY_PAGES`). A rename keeps the slug. A merge turns the loser's slug into an alias of the survivor.

### 4.5 Where each board names the company's website

| Board | Read (already read for the logo, except where marked) | Domain from | Name from |
|---|---|---|---|
| Ashby | board page | `organization.publicWebsite` | `organization.name` |
| Workable | account API | `url` | `name` |
| Lever | board page | footer "Home Page" link | page title |
| SmartRecruiters | newest job's page (already read for the logo) | header logo link | the link's title |
| Keka | `careerportalinfo` | `companyWebsite`, with `careers.` / `jobs.` dropped by rule 1 | `name` |
| Zoho Recruit | portal page | `org_info.website` (unless `hide_visit_website`) | `org_info.company_name`, else `og:site_name` (unless `hide_company_name`) |
| Greenhouse | board page | `boardConfiguration.logo.href`, then `job_links` | the API's `name` through `plainName` |
| Workday | none | `job_links` never helps (all on `myworkdayjobs.com`); `name_evidence` with the legal name through `plainName` | `hiringOrganization.name` of one posting, through `plainName` |
| Naukri | — | `redirect` only | listing `companyName` |

Staffing firms are their own employers, because the firm is who posts the job. Zoho's `org_info.type = staffing` flags them; W2 prints the count in the report and stores nothing new for it.

### 4.6 Sequence: link a company to its employer

```
linkCompany(companyId)                              one transaction, row-locked on the Company
  c = Company; d = c.domain
  if c.domainBasis = owner and c.employerId set and employer.domain = d → done
  if d is null:
      if c.employerId is null → create Employer(name, slug, domain null) and set c.employerId
      done
  e = Employer where domain = d
  if e is null:
      if c's employer exists, has domain null and only c → set its domain = d (it keeps its slug)
      else → create Employer(domain d) and move c to it
  else if c.employerId ≠ e.id:
      old = c's employer; move c to e
      if old has no rows left → mergeEmployers(e, old): old.slug → EmployerAlias(e), delete old
  refreshEmployer(e)                                  name, logo, stage, nameKey (slug untouched once public)
```

- `linkPending()` runs `linkCompany` for rows with `employerId` null or with `domainCheckedAt` newer than their employer's `updatedAt`, 500 per ingest tick.
- `employers-link.ts --write` runs the same over all rows once, after W2's backfill.
- `refreshEmployerCounts()` runs after ingest as one `UPDATE … FROM (aggregate)`. It counts open jobs from public sources whose company was read in the last 3 days.

### 4.7 Naukri rows

- A Naukri `Company` row (`source = naukri`, slug from Naukri's company id) is linked like any row. Its only evidence is `redirect`: when one of its jobs has `applyVia` and an `applyRedirectUrl` on a board account we read, the row takes that account's domain. Without one it is a one-row employer.
- Naukri jobs never count toward `openJobs` and are never shown publicly. An employer with only Naukri jobs is not listed, and its slug is a 404 signed out.
- In the feed a Naukri job joins its employer's other listings, so the same role on Greenhouse wins (§4.8).
- Names never join a Naukri row to an employer.

### 4.8 Feed and guards

- The feed SQL selects `c."employerId"`, and `FeedRow` carries it.
- `dedupeListings` keys on `roleKey(employerKey, title)`, with `employerKey = employerId ?? "company:" + companyId`. A row not yet linked never matches another by name.
- `BOARD_RANK` adds the boards applied today, best first: greenhouse, ashby, lever, smartrecruiters, keka, workday, naukri.
- `governance/history.ts`: `appliedRoleKeys`, `feedHistory` and the swipe-time counts read the employer key through `Application → Job → Company`. The rule names and messages stay the same ("Enough applications to this company").

### 4.9 Public pages: what shows and what never does

- **Public sources:** every source except signed-in ones (`naukri`, later `linkedin`: `SIGNED_IN_SOURCES` in `modules/sources`) and `mock`.
- **Listed employer:** `openJobs > 0`.
- **A job shown** is open, from a public source, and its company was read in the last 3 days.
- `/companies`: letters A–Z and 0–9 with counts, and the 30 employers with the most open India jobs.
- `/companies/browse/<letter>`: employers by name, 200 a page (`?page=`), with logo, name and open job count.
- `/companies/<slug>`: logo, name, website link, "N open jobs", and the boards it hires through. Jobs come India and remote India first, newest first, then "Outside India"; 50 a page. Each job links to `/j/<slug>-<id>?s=co`, where Apply runs Phase U's flow, and boards we cannot apply through show the original posting link there.
- **Never:** `raw`, `questions`, embeddings, anything about users, Naukri jobs or their counts.
- Pages are rendered on the server and revalidated hourly.

### 4.10 Failure handling

- A board page that does not load leaves the domain as it was and `domainCheckedAt` unset, so it is tried again on the next tick. After 30 days it is tried again like a missing logo today.
- A domain that changes (a rebrand) moves the row to the other employer. The old employer, if left empty, becomes an alias.
- A wrong join is undone by `employer-set.ts --split <companyId>`: the row gets `domainBasis = owner`, `domain = null` and a one-row employer.
- If the pages fail to read, they show the error state and the app is unaffected. `COMPANY_PAGES` off is a 404.

### 4.11 Observability

`scripts/employers-report.ts` prints:
- coverage by board and basis;
- employer totals: employers, multi-row employers and listed employers;
- joins whose names share no word;
- same-name employers on different domains;
- one-row employers whose plain name equals a domain employer's name (candidates for the owner);
- Naukri rows joined by a redirect;
- generic names left.

`--coverage` prints the first block only. The weekly board report includes it (W8).

### 4.12 Security and privacy

- The pages show public postings and public company facts only, through named-column reads.
- No user data, no Naukri listing, no IP or visitor details beyond Phase U's funnel cookie on `/j/`.
- The reads are plain GETs of public board pages at today's logo pace. No login, no circumvention, no Naukri fetch.
- Overrides are by script, so there is no admin UI to protect.

### 4.13 Code map

| Path | Change |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/<stamp>_employers/migration.sql` | `Employer`, `EmployerAlias`, `Company` columns, `Job` index (W1) |
| `src/lib/employer-slug.ts`, `scripts/employer-slug-test.ts` | new (W1) |
| `src/modules/jobs/domains.ts`, `company-facts.ts`, `logos.ts` | extractors and the facts pass; `logos.ts` keeps only what the pass needs (W2) |
| `src/worker/handlers/ingest-tick.ts` | `refreshCompanyFacts`, `linkPending` (W2, W3) |
| `scripts/company-facts-backfill.ts`, `company-facts-test.ts` | new (W2) |
| `src/modules/jobs/employers.ts`, `after-ingest.ts` | linking and counts (W3) |
| `scripts/employers-link.ts`, `employers-report.ts`, `employer-set.ts`, `employer-link-test.ts` | new (W3) |
| `src/modules/jobs/match.ts`, `src/modules/governance/history.ts` | employer keys (W4) |
| `scripts/feed-dedupe-test.ts` | new (W4) |
| `design/companies.html`, `docs/DESIGN.md` | drawing (W5) |
| `src/app/companies/**`, `src/modules/jobs/employer-pages.ts`, `src/lib/company-pages-gate.ts`, `src/proxy.ts` | pages (W6) |
| `src/app/j/[slug]/page.tsx`, `src/app/sitemap.ts`, `src/app/robots.ts`, `scripts/job-posting-test.ts` | search (W7) |

### 4.14 Env (ARCHITECTURE §11 additions)

`COMPANY_PAGES=1` turns the company pages on. The public base URL (Phase U's setting) gives canonical and sitemap URLs. Nothing else is new.

---

## 5. UI

- Drawn first, for the owner's approval (W5, `design/companies.html`, with the ui-craft skill), to the house design: mobile-first at 390 px, centred at 480 px, ink with one lime fill, no gradients, no emoji, light and dark.
- `/companies`: a title, the letter strip, and the "Most hiring in India" list (logo tile, name, "N open jobs").
- Letter page: the same rows, alphabetical, with paging.
- Company page:
  - the header (logo tile, name, website as plain text link, "N open jobs");
  - the boards line ("Hires through Greenhouse and Workday");
  - job rows as the feed's compact row (role, place chips, posted "x days ago"), India first and then "Outside India";
  - a sign-in prompt ("Let your agent apply") for signed-out visitors.
- States: loading skeletons, an employer with no open jobs (a 404, not an empty page), a letter with none ("No companies under Q yet"), errors, and an alias (redirect, no screen).

## 6. API

No new API routes. The pages read through server components (`employer-pages.ts`). The `/j/` funnel's `source` gains `co`.

---

## 7. Testing

- `employer-slug-test`: ASCII, length, dots, reserved words, collisions (domain label, then a number), aliases count as taken.
- `company-facts-test`: each board's extractor on a page string copied from a real page (inline, no files), shared hosts, refused hosts, `careers.` dropped, `job_links` only when named like the company, an owner domain never overwritten, generic names replaced.
- `employer-link-test`, on throwaway rows:
  - two boards with one domain → one employer;
  - two Glides on different domains → two employers;
  - no domain → a one-row employer;
  - a domain found later → a merge, with the alias answering;
  - an owner split survives a relink;
  - a Naukri redirect joins its board's employer.
- `feed-dedupe-test`: one employer's role on Greenhouse and Naukri → one card, the Greenhouse one; two Glides → two cards; the guard blocks the same role on the employer's other board.
- `company-pages-smoke` (HTTP, signed out): index, letter, a multi-board employer, a Naukri-only employer is a 404, an alias gives 308, a slug with a dot is refused, the flag off gives a 404.
- `job-posting-test`: required properties present and valid JSON; none on a closed job or a Naukri job.
- Existing: `feed-sql-test`, `guards-test`, `logos-test`.

## 8. Rollout

1. W1 schema on Neon.
2. W2 backfill in the background (31,375 rows at the logo pace: about 3–4 hours; it resumes).
3. W3 link, then the report goes to the owner.
4. W4 feed and guards.
5. W5 drawing approved.
6. W6 pages, flag off.
7. W7 search, flag off.
8. W8 with the owner's OK: `COMPANY_PAGES=1`, then the sitemap goes to Search Console. `SHARE_LINKS` must be on for job links to work.

Rollback: turn the flag off. The data stays; the feed's employer key falls back per row.

## 9. Risks

- **A wrong join** (an agency's or parent's domain on someone else's board): the board's own field is the main source, the report lists joins whose names disagree, and splits are one command.
- **Coverage:** Greenhouse (1 of 3 samples) and Workday (0 of 2) rarely name a website. Greenhouse's 572 and Workday's 344 employers with open jobs lean on `job_links` and `name_evidence`. A row without a domain still gets its own page, just never merged.
- **Clearbit's free suggest may go away.** It is the last source, and only with evidence.
- **Stale jobs on public pages:** only companies read in the last 3 days count, and closed jobs drop their markup.
- **Search quality:**
  - Thin pages (one job): proposed to list them anyway (§11 item 5).
  - Duplicate content of the employer's own posting: we link the original and add the agent.
  - Google may still rank us low or not show the jobs.
- **Board terms on republishing public postings:** these feeds are public for embedding, and each page links the original. Naukri is never republished.
- **A slug, once public, is forever:** the alias table carries every merge.

## 10. Tasks

In [TASKS.md](TASKS.md) beside this file: W1–W8, each with its Do, the sections of this design it builds and its Done when. Root `docs/TASKS.md` Phase W lists them one line each.

## 11. Decisions proposed, for the owner to confirm (26 Nov)

1. **Naukri on public pages:** hidden entirely, with no link-out and no count (proposed). The alternative is a "More on Naukri" link to Naukri's company page.
2. **Index `/j/` job pages** for open public jobs so they carry `JobPosting` (proposed). This reverses Phase U's `noindex` non-goal. Without it the company pages are found but the jobs never appear in Google's job results.
3. **Jobs outside India** on company pages: shown under "Outside India" (proposed), or India only.
4. **URLs:** `/companies`, `/companies/browse/<letter>` and `/companies/<slug>` (proposed).
5. **Employers with one open job** are listed (proposed), or there is a minimum of 2.
6. **Groups and subsidiaries** stay separate by domain (proposed). Bosch's entities or Tata companies are joined only by the owner's override.
7. **Review:** the owner reads only the report's "names disagree" and "same name, other domain" lists (proposed), not every multi-board employer.

## 12. What this sets up: non-tech roles (the follow-on phase, not designed here)

The owner's next step is non-tech jobs: sales, operations, support, finance, healthcare and retail. This design gives that phase:
- one employer to attach an industry to;
- pages that already list every role an employer has (`Job.function = non_tech` jobs are stored today but hidden from most feeds);
- a place to count which boards non-tech employers hire through, which picks the next adapters (Darwinbox and SuccessFactors from Phase V, Naukri, and others).

The follow-on designs:
- fields and tracks for non-tech roles (the taxonomy, `classifyTitle`, `roleFamily`);
- matching without a skills vocabulary;
- onboarding that asks a non-tech candidate the right few things;
- the adapters and agent work those boards need;
- company pages filtered by field.

Its own TDD, after W4.

## 13. Sources

- Read-only queries on the production database, 26 Nov 2026: rows, open jobs, logos per board; repeated names (all rows and open ones); generic names; Naukri `raw` keys.
- Public board reads, 26 Nov 2026 (no login):
  - `boards-api.greenhouse.io/v1/boards/<slug>` and `job-boards.greenhouse.io/<slug>` (stripe, razorpaysoftwareprivatelimited, groww, anthropic);
  - `api.lever.co/v0/postings/<slug>` and `jobs.lever.co/<slug>` (cred, meesho, palantir);
  - `jobs.ashbyhq.com/<slug>` and `api.ashbyhq.com/posting-api/job-board/<slug>` (ramp, notion, linear);
  - `apply.workable.com/api/v1/accounts/<slug>/` (huggingface, cleo-ai, toggl);
  - `api.smartrecruiters.com/v1/companies/<id>/postings` and `jobs.smartrecruiters.com/<id>/<posting>` (BoschGroup, ServiceNow);
  - `<slug>.keka.com/careers/api/organization/default/careerportalinfo` (toddle, accredian, techdome, jupiter);
  - `artingdigital.zohorecruit.in/jobs/Careers` and `zenatta.zohorecruit.com/jobs/Careers`;
  - Workday `…/wday/cxs/<t>/<site>/jobs` and the job JSON (nvidia.wd5, browserstack.wd3);
  - `autocomplete.clearbit.com/v1/companies/suggest?query=Razorpay`.
- Google Search Central, job posting structured data: markup only on the page of a single job, the description visible on that page, expired jobs drop the markup.
- Code read on main `ea28e9b`: `modules/jobs/logos.ts`, `match.ts dedupeListings`, `governance/history.ts`, `src/proxy.ts`, `docs/share/TDD.md` §1 and §4.
