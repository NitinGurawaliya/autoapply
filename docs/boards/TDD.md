# More boards, employer accounts and discovery at scale — technical design (Phase M)

Version 1, 7 Nov 2026. Draft for the owner: nothing here is decided until §11 is answered. ARCHITECTURE stays the source of truth: each task copies the decisions it lands into ARCHITECTURE (§5, §6.2, a new §6.21 "Employer accounts") and, for the credential rule, into CLAUDE.md's hard rules, in the same change.

Three questions, one ranking. (1) Which boards with public, no-sign-in application forms to add next. (2) How to apply on boards that need an employer account during the application, Workday first. (3) How to grow from about 1,300 watched companies to 50,000 career pages without the ingest or Postgres falling over, for an app meant to reach millions of users. Everything is ranked by **open India-eligible jobs unlocked per task session**, because the audience is Indian tech job seekers.

---

## 1. Goals and non-goals

**Goals**
- G1. More India jobs a right swipe can send: every task in this phase is ranked by open India-eligible jobs it unlocks per session of work (§3.4), measured after it lands by the board report (T97).
- G2. New boards with public forms come in by one recipe (§4.5): a fetcher, a `boards.ts` entry, an adapter on the existing `AtsAdapter`, discovery hosts; one real submit before `APPLY_BOARDS`.
- G3. Boards that need an account (Workday, then SuccessFactors, Darwinbox, Oracle; iCIMS later): the agent creates and signs in to the employer's candidate account in the user's name and email, with a password **we generate per account, store encrypted, and show only to the user** (§3.2, §4.9). Email verification goes to the user first; a mail connection only if the owner agrees (§11).
- G4. Discovery from ~1,300 to 50,000 watched career pages, each slug recorded with where it came from, verified on the board's own public API, rechecked on a schedule (§4.7).
- G5. Ingest and Postgres stay bounded at 50,000 companies and do not grow with users: India-only storage, a fetch cadence by tier, list-then-detail fetches, per-company queue jobs that any number of workers share (§4.8).

**Non-goals**
- Signing in to job boards (Naukri, LinkedIn): Phase K, unchanged.
- Companies' own careers pages on no ATS (part of Tsenta's 50,000): a generic form filler is a different, LLM-heavy problem; later, if ever.
- Solving or outsourcing CAPTCHAs, stealth browsers, residential proxies, minted tokens. A board whose form demands a person gets a person (the handoff, ARCHITECTURE "Human handoff"). Keka's AI read of its image CAPTCHA (`ENABLE_KEKA`) stays the owner's existing call and is not copied to new boards.
- "Sign in with Google / LinkedIn" on employer sites: never; it would need the user's own password for another service.
- Paid company data (TheirStack, BuiltWith, PredictLeads) unless the owner approves a cost (§11).
- Per-user tables at millions of users (`JobJudgement`, `Swipe`, `ApplicationEvent`, `FileBlob`): flagged in §9, designed elsewhere.

---

## 2. Facts the design rests on (research and measurements, 7 Nov 2026)

Full notes and sources in §12.

**Our own numbers (Neon, read-only queries, 7 Nov):**

1. **Watched today:** 1,308 active companies (Keka 482, Greenhouse 314, Ashby 217, Lever 146, Workday 132, Zoho Recruit 17). Open jobs: Greenhouse 20,042 (2,727 India-eligible), Lever 4,467 (808), Workday 3,714 (all India: stored India-only), Keka 3,489 (all India), Ashby 2,258 (446), Zoho 157. **11,341 open India-eligible jobs in all.**
2. **Where the entry-level India jobs are:** open India jobs at intern/entry level: Keka 295, Workday 155, Greenhouse 62, Lever 31, Ashby 8, Zoho 8; with 2 years or less: Keka 611, Workday 368, Greenhouse 251. Workday is the second-largest pool for freshers and we cannot apply to any of it.
3. **India jobs per active company:** Workday 28.1, Zoho 9.2, Greenhouse 8.6, Keka 7.2, Lever 5.5, Ashby 2.1.
4. **Submitted applications per board (all time):** Greenhouse 167 of 291, Keka 117 of 150, Ashby 105 of 176, Lever 0 of 12 (off, hCaptcha). Last 30 days Keka sent the most (117).
5. **Ingest today:** one run over every company every 3 hours (ARCHITECTURE 6.2). 5 Nov: 1,308 companies, 73,044 listings fetched, 35 minutes, 4 companies at a time with a 300 ms pause, 3 failed.
6. **Postgres:** 650 MB. `Job` 41,730 rows, 468 MB: heap 82 MB, TOAST 299 MB (descriptions), `Job_terms_idx` (GIN) 72 MB, other indexes 15 MB: **about 11.2 KB per job row, all in.** Average stored description: Greenhouse 6.3 KB, Ashby 5.9 KB, Workday 4.9 KB, Keka 3.4 KB, Lever 1.8 KB. `FileBlob` 133 MB for 1,257 files and 14 users. `DiscoveryCandidate` 12,468 rows, 3 MB.
7. **Greenhouse stores every job, worldwide:** 86% of its open rows are abroad. Ashby, Workday, Keka and Zoho already store India-eligible jobs only. Users can pick places abroad in the feed (`match.ts`, T80), so abroad rows are not dead weight today, but at 50,000 companies they are most of the table.
8. **The discovery backlog already holds jobs the threshold drops:** companies on a board with 1–2 India jobs (below `MIN_INDIA_JOBS` = 3): Greenhouse 298 companies / 820 India jobs, Zoho 29 / 400, Workday 33 / 48, Lever 18 / 44. **About 1,300 India jobs behind a one-line rule change.** Ashby's bar is already 1.
9. **Discovery today:** daily, one pg-boss job per board, Common Crawl's CDX API host by host over the 6 latest crawls, 400 new slugs checked per run, plus model-proposed names and the India probe (T93). Greenhouse alone took 52 minutes (2 Nov). Crawl yield so far: Greenhouse 6,500 slugs checked, 313 added; Ashby 4,300 checked, 174 added; Workday 783 / 131; Zoho 149 / 16; Lever only 27 slugs in the crawl.

10. **India jobs per system, measured in an open dataset.** The ats-scrapers hosted snapshot (6 Nov 2026: 5,060,096 jobs, 80,390 companies, 64 systems; MIT) read with DuckDB in 20 s; "India" = an Indian place in the location or `country_iso = IN`, "tech" = a title regex (§12). It counts only the companies that dataset knows, so it is a floor, and one day's snapshot: hiring changes week to week, so these numbers rank boards, they do not pick the companies to watch (§3.3).

    | System | India jobs | India tech | Companies with India jobs (of all it knows) | We have today | Biggest India employers |
    |---|---|---|---|---|---|
    | Oracle Recruiting | 41,152 | 5,570 | 178 (986) | — | tenant codes "Hcbt" 10,339, "Eofh" 5,364, Aster DM 2,430, Startek 1,443 (BPO, healthcare: concentrated) |
    | **Workday** | 25,976 | **13,216** | 654 (3,194) | 3,714 jobs, 132 tenants, no apply | Genpact 1,384, PwC 1,907, Amgen 749, Citi 689, Hitachi 682, JLL 548 |
    | **SmartRecruiters** | 10,984 | 5,008 | 187 (1,443) | — (T95) | Weblee 3,579 and Squircle IT 1,744 (staffing), Accor 592, Bosch 490 |
    | **SuccessFactors** | 9,511 | 3,063 | 194 (1,304) | — | EY GDS 2,835, NTT DATA 872, Bajaj Auto 396, Mahindra 391, Yash 309 |
    | **Darwinbox** | 6,757 | 882 | 116 (154) | — | PwC Asia 1,264, AU Small Finance Bank 1,182, YES Bank 684, Kotak Securities 501, SBI Life 467 |
    | Greenhouse | 4,636 | 2,688 | 502 (4,778) | 2,727 jobs, 314 | |
    | Phenom (a front end; applies on Workday or SuccessFactors behind it) | 3,871 | 2,224 | 45 (90) | — | HPE, Thermo Fisher, Cisco, DHL, State Street, Mastercard |
    | Keka | 3,617 | 834 | 167 (185) | 3,489 jobs, 482 (we are ahead) | |
    | Lever | 2,711 | 1,142 | 171 (1,900) | 808 jobs, 146 | Paytm 604, Brillio 155, Meesho 54 |
    | Ashby | 1,089 | 590 | 172 (2,795) | 446 jobs, 217 | |
    | iCIMS | 960 | 416 | 68 (1,908) | — | PepsiCo, Orange, Waters |
    | Recruiterbox, JazzHR, Rippling, Recruitee, BambooHR, Pinpoint, Gem, Jobvite, Breezy, Workable, Teamtailor, Personio | 628, 431, 385, 327, 322, 263, 172, 172, 169, 128, 111, 30 | 20–240 each | 6–70 each | — | |

    Workable is undercounted there (78 of the 4,752 companies it lists were scraped): Workable's own public job search lists **3,841 India jobs** (`jobs.workable.com/api/v1/jobs?location=India`; Apna, Lokal, Zifo, PriceLabs, Fortanix).

**Boards with public forms (checked live 7 Nov; details in §12):**

| Board | Jobs API, no sign-in | Slug | Form | Bot check on the form | India |
|---|---|---|---|---|---|
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{id}/postings` (`country=in`); description only per posting | path `jobs.smartrecruiters.com/{Company}` | multi-step "Easy apply" on `jobs.smartrecruiters.com/oneclick-ui/…` | **DataDome** + Cloudflare (curl 403; a real Chromium got through; DataDome can raise its own slider) | strong: Swiggy (190), Freshworks, Bosch |
| Workable | `apply.workable.com/api/v1/widget/accounts/{slug}?details=true` (all jobs with descriptions) | path `apply.workable.com/{slug}`, some on custom domains | one page | **Cloudflare Turnstile** | real: 3,841 India jobs in its search |
| Recruitee | `{slug}.recruitee.com/api/offers/` (descriptions, `open_questions`) | subdomain or custom domain | one page | **hCaptcha** from Recruitee's own CDN | none found |
| BambooHR | `{slug}.bamboohr.com/careers/list`, `/careers/{id}/detail` (`formFields`) | subdomain | one page | reCAPTCHA flag in the page, not seen rendering | weak |
| Rippling | `ats.rippling.com/api/v2/board/{slug}/jobs` + detail with `activeJobApplication` questions | path | `…/apply?step=application` | **Turnstile, managed** | Rippling's own |
| Dover | `app.dover.com/api/v1/careers-page-slug/{slug}` → jobs → detail with `application_questions` | path `jobs.dover.com/{slug}` | not opened | Turnstile script on every page | none |
| Gem | `api.gem.com/job_board/v0/{slug}/job_posts/` (Greenhouse-like) | path `jobs.gem.com/{slug}` | inline on the job page | **none** (`CAPTCHA_REQUIRED=false`, per board) | none found |
| Teamtailor | `{site}/jobs.json` (JSON Feed) | subdomain or custom domain | plain form POST | **none**, but the form counts keystrokes and pastes | none found |
| **Darwinbox** | `{slug}.darwinbox.in/ms/candidateapi/job?page=1&limit=100` + `job/{id}` (description); no sign-in (Porter 68 jobs, MakeMyTrip 64, Airtel 56 on 7 Nov) | subdomain | Apply goes to a **sign-in page**: an account per employer (email and password, or Google/LinkedIn), a **code at sign-up**; the apply endpoint answers 401 without one | **Turnstile** | very high: Airtel, MakeMyTrip, Porter, 1mg, Cars24, Delhivery |
| **Zoho Recruit** (form; ingest exists) | as today, the portal's hidden `#jobs` JSON | subdomain `.in`, `.com`, `.eu` | guest form, no sign-in, no email code | **image text CAPTCHA**, required | high: CTC and notice-period fields |
| Jobvite | `app.jobvite.com/CompanyJobs/Xml.aspx?c={companyId}` (id read once from `jobs.jobvite.com/{slug}/jobs`) | path | `jobs.jobvite.com/{slug}/job/{id}/apply`, a consent step first | invisible reCAPTCHA v2 | moderate: Nutanix, Egnyte |
| Personio | `{slug}.jobs.personio.de/xml` | subdomain | `…/job/{id}/apply` | Turnstile | negligible |
| Pinpoint | `{slug}.pinpointhq.com/postings.json` (date only in each job page's JSON-LD) | subdomain | `…/applications/new` | per-company flag (off on the sample) | low |
| BreezyHR | `{slug}.breezy.hr/json` (no description) | subdomain | `…/p/{id}/apply` | none found | low |
| JazzHR | `app.jazz.co/feeds/export/jobs/{slug}` | subdomain `{slug}.applytojob.com` | the job page | reCAPTCHA v2 checkbox, visible | very low |
| Polymer | `api.polymer.co/v1/hire/organizations/{slug}/jobs` + detail with the whole form | path | `jobs.polymer.co/{slug}/{id}` | invisible reCAPTCHA v2 | none (84 slugs) |
| Freshteam | 404 on every slug | — | — | — | **being shut down** (renewals stopped 7 Jun 2026): dropped |

No sign-in or emailed code appeared on any of these forms. Every official "apply API" (SmartRecruiters Application API, Workable, Teamtailor) needs a partner or employer key.

**Employer-account systems (live checks and the vendors' shipped JavaScript, 7 Nov):**

| System | Jobs API, no sign-in | Account | Password | Email step | Bot checks |
|---|---|---|---|---|---|
| **Workday** | CXS `POST {t}.wdN.myworkdayjobs.com/wday/cxs/{t}/{site}/jobs` (we use it, T99) | one per employer tenant | yes: email, password, confirm; rules per tenant | an activation **link**, if the tenant turns verification on; no one-time-code strings in the bundle | no third-party CAPTCHA; its own invisible checks on sign-in and sign-up (a hidden decoy field, a 500 ms minimum, a transparent click layer over Submit, `isUserHuman()`); Cloudflare's `__cf_bm` in front |
| **Oracle Recruiting (CE)** | REST `…/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=CX_n,…` and `…Details` | per tenant, by email or phone | **none: passwordless** | a **6-digit code** by email or SMS on every visit; 5 wrong codes lock for 30 minutes; the identity lasts 4 hours | invisible hCaptcha where the site turns it on |
| **SuccessFactors** | career-site `sitemap.xml` (Wipro: 6,652 job URLs) and RSS `/services/rss/job/?keywords=(india)`; company id and data centre in the page | one per company | yes, rules per company (Wipro: 6–20, a letter and a digit or symbol) | per company: a code, a link, or none | optional CAPTCHA, set separately for sign-up and sign-in |
| iCIMS | JSON only on Jibe-built sites (`{careers-host}/api/jobs?location=India`); classic portals are HTML and their host names cannot be guessed | one per company portal | yes (or social sign-in) | a link | **invisible hCaptcha on the email step** |

11. **Workday is moving off passwords.** On 13 Oct 2026 it announced the *Workday Candidate Profile*: one profile reused across Workday employers, sign-in by email and a one-time code, no password, general availability "early calendar 2027" (regions and employer opt-in not stated). Oracle is already passwordless. **The email step, not the password, is the core problem of every account system.**
12. **How others do it.** Tsenta applies from its cloud with a user-set "application password" (advised to be used nowhere else) and gives each user a **private Tsenta inbox address** used on applications and forwarded to the user; an optional Gmail/Outlook connection "reads verification codes, not your mail". Kombo's "AI Apply" makes a new account per application with a unique proxy email, handles codes itself, and stores no password (the candidate gets in later by "Reset password"). The open-source Workday tools and the autofill extensions (Simplify, Jobright) type email and password and leave the terms box, the email step and Submit to the person.
13. **Terms.** No vendor-wide candidate terms for Workday or Oracle; each employer's own site terms apply (JPMorgan's have no automation clause). iCIMS's own site terms ban "any robot, spider or other automatic device" (whether that reaches customer portals is unclear). Some employers' terms forbid accounts made "by automated means".

**Discovery sources (checked 7 Nov):**

14. **Common Crawl's CDX API** (what discovery uses today) answered 504 all day and blocks addresses for up to 24 hours when pushed. Its **columnar index** (Parquet on `data.commoncrawl.org`) works with DuckDB, anonymously: 52 s to read one crawl's 300 file footers, then 5–11 s per host. One crawl (2026-43) gave Workday 1,667 tenants, Workable 3,666, Greenhouse `job-boards` 3,022 (+329 EU), Ashby 1,106, Personio 916, Recruitee 630, Teamtailor 602, SmartRecruiters 554, Keka 187, Darwinbox 25. One crawl holds about a third of the known boards: take the union of many, and treat a slug missing from a crawl as "not new", never "gone".
15. **Lever blocks Common Crawl** (robots.txt; `jobs.lever.co` answers its crawler 403): Lever slugs come from `jobs.eu.lever.co`, the Wayback CDX (419 pages, slow, flaky) and the lists below. `boards.greenhouse.io` shows only as redirects now: read `job-boards.greenhouse.io` and the EU hosts.
16. **Open slug lists** (downloaded): ats-scrapers `ats-companies/` (MIT; Greenhouse 6,031, Workable 4,752, BambooHR 5,632, Workday 3,530, Ashby 3,448, SmartRecruiters 2,747, Personio 2,463, Lever 2,402, iCIMS 2,498, SuccessFactors 1,392, Oracle 1,279, Keka 185, Darwinbox 163); upstreamit (MIT; merged from 13 sources and checked live: Greenhouse 8,299 live, Workday 5,747, Ashby 4,355, Lever 2,628); Hugging Face `latmay/ats-career-page-urls` (CC BY 4.0; 84,064 career URLs labelled by system, updated 5 Nov; about half of its Ashby rows dead); openroles, jobseek, open-ats-feed (MIT). **Avoid:** Feashliaa's lists (CC BY-NC, no commercial use) and a repo shipping a zip shaped like a malware loader (`find-companies-using-ashby-job-boards`). The ats-scrapers repo is MIT; its hosted dataset (`storage.stapply.ai`) states no separate terms, and its rows are employers' listings: we take slugs and company names from it (facts), never its job texts.
17. **Together the lists reach about 40–60k candidate slugs, about half live**: the scale of Tsenta's "50,000+ career pages". Certificate logs give nothing (Keka, Darwinbox, Breezy, Workday use wildcard certificates). Guessing slugs from company names hit 1 in 125 (upstreamit); our own model-proposed names did as badly (`DiscoveryCandidate`: of 206 names the model proposed across five boards, 2 were added).
18. **Vendor search sites:** Workable's `jobs.workable.com/api/v1/jobs` (no sign-in, 171,679 jobs, 3,841 India, company name and website but not the slug). Ashby, Greenhouse, Lever and SmartRecruiters publish no sitemaps of boards.
19. **Aggregators are not a source.** Google for Jobs has no read API and its terms and robots.txt forbid reading results by machine (SERP-scraping APIs are in litigation with Google). Adzuna, Jooble, Careerjet and Talent.com are pay-per-click publisher programmes: links go through their own redirect, attribution required, storage limited, never a link to the employer's ATS. Indian portals (Naukri, foundit, hirist, iimjobs, Instahyre, Cutshort, Wellfound) all forbid automated collection in their terms and apply only signed in: they belong to the signed-in design (Phase K), after this phase.
20. **India company names with websites:** the DPIIT-recognised startup list (236,854 rows with website, on Dataful; licence not stated), YC's open company list (230 India companies, 53 hiring). A website's careers page names its ATS (the same detection the India probe T93 does).

---

## 3. Options and decision

### 3.1 Which boards, and in what order

The test for a board: open India jobs (and India tech jobs) it adds, against the sessions it costs, given its form. Facts 10–13 and the batch tables in §2.

| Board | India jobs (fact 10) | Form | Verdict |
|---|---|---|---|
| Greenhouse, Ashby, Keka, Lever (boards we already apply on) | +1,900, +640, +130, +1,900 over what we hold, plus ~1,300 behind the threshold (fact 8) | adapters exist | **First: seed every known company** (M3). No new adapter. Lever's jobs count once T94 turns it on |
| **Workday** | 25,976 (13,216 tech); 22,000 more than we ingest, none applicable today | account per tenant, link verification, its own invisible checks | **Second**, the largest pool of India tech and fresher jobs (fact 2): vault and email step (M5), adapter (M6). This is K12 of the Naukri plan; one design, this one |
| **SmartRecruiters** | 10,984 (5,008 tech); ~5,700 without the two staffing tenants | public multi-step form behind DataDome | **Third** (T95, already planned): a visible window with the worker's own click, as Ashby; a challenge hands the window over |
| **SuccessFactors** | 9,511 (3,063 tech): EY GDS, NTT DATA, Wipro, Mahindra, Bajaj | account per company; code, link or none | **Fourth**, on M5's account machinery |
| **Darwinbox** | 6,757 (882 tech): banks, insurers, PwC; in its own feeds also Airtel, MakeMyTrip, Porter, Cars24 | an account per employer with a code at sign-up, Turnstile | **Fifth**, on M5's account machinery (the sign-up code through the code sheet); no competitor lists it; 164 known tenants, 278 hosts seen |
| Oracle Recruiting | 41,152 (5,570 tech), concentrated in a few BPO and healthcare tenants | passwordless, a 6-digit code every visit | **Sixth**, only after the email step is automatic (§3.2): a person typing a code for every Oracle apply does not scale |
| Workable | 3,841 (its own search) | one page, Turnstile | Seventh: visible window, as SmartRecruiters |
| Zoho Recruit | 157 today; ~400 behind the threshold | guest form, required image CAPTCHA | Eighth: ingest exists; a **handoff board** (a person types the CAPTCHA and presses Submit), as Keka was designed |
| Freshteam | — | — | **Dropped**: Freshworks is shutting it down |
| Phenom | 3,871 | a front end: it applies on the Workday or SuccessFactors tenant behind it | Not a board: discovery follows its links to that tenant (M4) |
| iCIMS | 960 | account per portal, invisible hCaptcha on the email step, site terms against robots | Later, if M1's numbers move |
| Rippling, Recruitee, BambooHR, JazzHR, Pinpoint, Gem, Teamtailor, Breezy, Jobvite, Personio, Pinpoint, Polymer, Dover, Recruiterbox | under 650 each, 20–240 tech | public; Turnstile (Rippling, Personio), hCaptcha (Recruitee), reCAPTCHA (Jobvite, Polymer; JazzHR visible), none (Gem, Teamtailor, Breezy) | **Later, one task for the lot**, only for those M1 shows adding India jobs every week |

**Bot checks on new boards.** A CAPTCHA that is always shown (Recruitee's hCaptcha) makes the board a handoff board: the worker fills, a person presses Submit. An invisible score (DataDome, Turnstile, Workday's own checks) starts as Ashby did (ARCHITECTURE "Human handoff"): the worker fills only the fields a person sees and clicks in a visible Chrome window; a challenge hands that window to the person; headless workers do not take those boards until the measured challenge rate says they can. Nothing is solved, scored or faked.

### 3.2 Boards that need an employer account

| Option | How | For | Against | Verdict |
|---|---|---|---|---|
| A. Person only | The user creates the account and signs in in the visible window each time; the agent fills after | No credential stored | Needs a screen and a person for every application; does not scale past one laptop | Fallback only (an account that exists already, §4.4) |
| B. One application password the user sets (Tsenta) | The user types a new password once in our app; we store it encrypted and use it for every employer | The user can sign in to any employer with one password | Users reuse real passwords; one leak opens every employer account; our app asks for a password, which our hard rules avoid | No |
| **C. A password we generate per employer account** | 20 random characters per (user, system, tenant), AES-256-GCM in Postgres, the user's own email as the login, "Show password" for the user | No password the user uses anywhere else; one leak opens one employer; the user can still sign in to check status | We hold secrets: a vault, a key, rules | **Chosen** |
| D. A relay email we own as the login (`u123@apply.…`) plus C | We receive every verification mail ourselves | Fully automatic | Recruiters write to our relay; deliverability; the user's identity on the form is not their own email | No |
| E. Leave account boards out | — | No work | Workday is 3,714 India jobs and 155 entry-level ones today, 28 per company, and the MNCs Indian graduates aim for | No |

**Decision (proposed): C.** The agent creates the account with the user's own email and a generated password, only after a right swipe on that employer's job and only under a standing permission asked once ("Create employer accounts for me", §5). The password never leaves the vault except to the worker filling that employer's sign-in form and to the user who asks to see it.

The password is the smaller half. Oracle has none, Workday's coming Candidate Profile has none (fact 11), and `EmployerAccount.secret` is nullable for exactly that: when a system goes passwordless, its rows stop carrying one and nothing else changes.

**The email step** (a verification link on Workday, iCIMS and some SuccessFactors tenants; a 6-digit code on every Oracle visit and some SuccessFactors tenants). It decides whether account boards scale: at a million users, a person in the loop for every new employer, and for every Oracle apply, is millions of interruptions a day.

| Option | How | For | Against | Verdict |
|---|---|---|---|---|
| **1. The user does it** | A link: the run ends `needs_input` with "Verify your email for Acme", the user clicks the link in their inbox and presses "Done", the next run signs in. A code: the app's existing code sheet (`codeRequester`, the browser held 10 minutes, one per user at a time) | Ships with M5; no new access; the user's own email on every application | A person per new Workday employer and per Oracle apply | **First, for every account system** |
| 2. A private relay address per user (Tsenta, Kombo) | The account's email is `u<id>@mail.<our domain>`; our inbound mail service keeps the link or code for minutes and forwards every other mail to the user at once | Fully automatic; the user's inbox is never read | The employer sees our relay as the candidate's email and writes to it; deliverability and forwarding become our job; the user's real email is not on the application | Owner's call (§11 Q3) |
| 3. A forwarding filter to our inbound address | The user adds one Gmail filter (`from:(myworkday.com OR oraclecloud.com OR successfactors …)` → `u<id>@codes.<domain>`); we keep only the link or code | The user's own email stays on the application; we see only ATS mails | Setup on a computer; Gmail asks to confirm the forwarding address; a new inbound mail service | Owner's call (§11 Q3); **recommended** if the owner wants it automatic |
| 4. Gmail / Outlook read access | The user's Google sign-in with `gmail.readonly` | Automatic for Gmail users | A restricted scope: Google's verification and a yearly third-party security assessment; read access to the whole inbox | Not now |

**Decision (proposed):** option 1 ships with the account boards; Oracle waits for 2 or 3 (§3.1). The inbound service for 2 or 3 is one more task (M9) once the owner picks.

### 3.3 Discovery at scale

**What to watch (owner, 7 Nov): every company known to be on a board, not only those with India jobs today.** A board holds thousands of companies, and even a large employer does not have an India opening every week; "companies hiring in India on 6 Nov" is a ranking signal, not the watch list. So discovery keeps every slug that answers on the board's public API, and the cost of watching is kept low by how often each one is read (§4.8), not by leaving companies out.

| Option | Gives | Verdict |
|---|---|---|
| A. The open lists (ats-scrapers, upstreamit, Hugging Face latmay, openroles, jobseek; fact 16) | 40–60k candidate slugs across the systems in §3.1, about half live | **Yes, first** (M3), then re-read monthly (M4) |
| B. Common Crawl columnar index with DuckDB (fact 14) | Hosts and paths per crawl, all boards in one pass; the union of crawls | **Yes** (M4), replacing the CDX loop in `discovery.ts` |
| C. Wayback CDX | Lever (blocked from Common Crawl) and Ashby history | Yes, a one-off backfill, not daily |
| D. Workable's job search (fact 18) | India Workable jobs with company name and website | Yes, with M12: the website's careers link gives the slug |
| E. Harvest from what we already read | ATS links inside descriptions and apply URLs, Phenom career sites' apply links (to their Workday or SuccessFactors tenant), later Naukri's redirect URLs (K13) | **Yes** (M4): new slugs found at no extra request |
| F. Company names → careers page → ATS (T93's probe) | DPIIT startups (236k with websites), YC India | Yes for India, slowly (M4), after its licence is checked |
| G. Model-proposed names, slug guesses | 1 hit in 125 | **Stop** (M4 removes it) |
| H. Certificate logs | nothing (wildcard certificates) | No |
| I. Aggregators, Google for Jobs, Indian portals (fact 19) | jobs behind their own redirects or terms against machines | No; portals come with the signed-in phase |
| J. Paid feeds (TheirStack, BuiltWith) | the same slugs, for money | Not unless A–F fall short (§11) |

**Verification is the only gate.** Every slug from any source is one cheap call to the board's own list API: answers with a board → watched (tier by what it lists); 404 or no board → `not_on_board`, checked again in 90 days; an error → again tomorrow. A source missing a slug never removes it.

### 3.4 The ranking: open India jobs per task session

Sessions are one agent session each (CLAUDE.md "How to work"); the numbers are fact 10's floor, before more discovery. "Applicable" means a right swipe can send it once the task lands.

| Order | Task | India jobs made applicable | India tech | Sessions | India jobs per session | Depends on |
|---|---|---|---|---|---|---|
| 1 | M1 Board measurement, daily | — (the yardstick) | — | 1 | — | — |
| 2 | M2 Watch everything cheaply (tiers, India-only storage, per-company ingest) | — (makes 3 possible) | — | 2 | — | — |
| 3 | M3 Seed every known company on boards we apply on | ~5,900 (Greenhouse +1,900, Lever +1,900 once on, Ashby +640, Keka +130, threshold backlog ~1,300) | ~2,500 | 1 | **~5,900** | M2 |
| 4 | M5 + M6 Employer accounts, Workday | ~26,000 (22,000 more ingested by M3's Workday seed, all applicable) | 13,216 | 1 + 3 | **~6,500** | M2, M3 |
| 5 | M7 SmartRecruiters (T95) | ~5,700 (11,000 with staffing tenants) | ~3,000 | 2 | ~2,900 | M2 |
| 6 | M8 SuccessFactors | 9,511 | 3,063 | 3 | ~3,200 | M5 |
| 7 | M10 Darwinbox | 6,757 | 882 | 2 | ~3,400 (~440 tech) | M5 |
| 8 | M4 Continuous discovery | +30–60% on every board above, every week (estimate) | | 2 | — | M2 |
| 9 | M9 Automatic email step, M11 Oracle | 41,152 | 5,570 | 1 + 2 | high, but concentrated in a few tenants | M5, owner Q3 |
| 10 | M12 Workable | 3,841 | ? | 2 | ~1,900 | M2 |
| 11 | M13 Zoho Recruit apply | ~550 | ? | 1 | ~550 | — |
| 12 | M14 Long tail, M15 iCIMS | under 650 each | | 2 + 3 | under 300 | M1 shows weekly flow |

**Order:** M1 and M2 first because nothing scales without them (seeding 6,000 Greenhouse companies into today's single 3-hourly run would take most of the 3 hours); then M3, the most India jobs soonest; then Workday, SmartRecruiters, SuccessFactors, Darwinbox (the owner's order); M4 runs beside them from M3's lists onward; then Oracle, Workable, Zoho, the long tail. **M1's two weeks of daily numbers after M3 confirm or reorder 5–12** (owner, 7 Nov: a board is judged by its flow of new India jobs a day, not one snapshot).

---

## 4. Architecture

### 4.1 Components

| Component | Where | New or changed |
|---|---|---|
| Board registry | `modules/jobs/boards.ts` | Changed: new entries; `stores` India-only by default (M2); discovery keeps every slug that is a board, whatever its India jobs (M3) |
| Fetchers | `modules/jobs/fetchers/<board>.ts` | New per board; each returns a cheap list and a detail call (§4.8) |
| Adapters | `modules/apply/adapters/<board>.ts` | New per board, on `AtsAdapter` (ARCHITECTURE 6.6) and `adapters/common.ts` |
| Account flow | `modules/apply/account/` (`flow.ts`, `workday.ts`, later `oracle.ts`, `icims.ts`, `successfactors.ts`) | New: create, sign in, verify, wizard steps shared by account boards |
| Employer-account vault | `modules/accounts/` (`vault.ts`, `index.ts`) + `lib/secrets.ts` | New: the only code that reads or writes `EmployerAccount.secret` (as `lib/storage.ts` is for `FileBlob`) |
| Slug sources | `modules/jobs/slugSources/` (`commoncrawl.ts`, `wayback.ts`, `vendor.ts`, `lists.ts`, `probe.ts`, `harvest.ts`) | New: each yields `{board, slug, from}`; replaces the per-host CDX loop inside `discovery.ts` |
| Fetch scheduler | `modules/jobs/cadence.ts` | New: tier and `nextFetchAt` per company (§4.8) |
| Worker handlers | `src/worker/handlers/ingest-tick.ts`, `ingest-company.ts`, `discover-source.ts`, `discover-verify.ts` | New; `ingest` and `discover` stay as manual entry points |
| Board report | `scripts/feed-report.ts` (T97) | Changed: per board and per slug source |

### 4.2 Queues (pg-boss)

| Queue | Sent by | Payload | Concurrency | Notes |
|---|---|---|---|---|
| `ingest-tick` | cron, every 5 min | `{}` | 1 (singleton) | Picks companies with `nextFetchAt <= now()`, oldest first, up to `INGEST_TICK_BATCH` (500), sends one `ingest-company` each with `singletonKey = companyId` |
| `ingest-company` | `ingest-tick`, "Fetch now" | `{companyId}` | `INGEST_CONCURRENCY` per worker (8), and at most `INGEST_PER_HOST` (4) at once per board host across workers (advisory-lock counter, as `rateLimit`) | Replaces the one 35-minute run; any worker takes any company |
| `discover-source` | cron, daily | `{board, source}` | 1 per board | Lists slugs from one source into `DiscoveryCandidate` (`status = listed`) |
| `discover-verify` | `discover-source`, cron hourly | `{board}` | 1 per board, `DISCOVER_RPS` (1/s) per board host | Checks `listed` and due rechecks oldest first |
| `apply`, `apply-handoff`, `apply-person` | unchanged | | | Account boards use them as they are: `apply` when the tenant needs nothing from a person, `apply-person` after a verification or an existing account (§4.6) |

### 4.3 Data model (Prisma additions)

```prisma
model Company {
  // … existing fields …
  tier         String    @default("active")  // active | open | empty | dead (modules/jobs/cadence.ts)
  nextFetchAt  DateTime  @default(now())
  indiaOpen    Int       @default(0)      // open India-eligible jobs at the last fetch
  lastIndiaAt  DateTime?                  // the last time it listed an India job (active for 30 days after)
  listHash     String?                    // hash of the cheap list (ids + updated); unchanged → nothing else fetched
  @@index([nextFetchAt])
}

model DiscoveryCandidate {
  // … existing fields; status gains `listed` (not checked yet); from gains:
  // commoncrawl | wayback | workable | list:<name> | probe | harvest (several sources: comma-joined)
  nextCheckAt DateTime?   // not_on_board +90 d; error +1 d; null once it is a Company (ingest re-validates it)
  @@index([source, status, nextCheckAt])
}

// One row per board per day (M1): the yardstick that orders the boards (§3.4).
model BoardDay {
  day            DateTime @db.Date
  source         String
  companies      Int      // watched, any tier
  active         Int      // tier counts
  open           Int
  empty          Int
  dead           Int
  openIndia      Int      // open India-eligible jobs at the end of the day
  openIndiaTech  Int      // of which function engineering | data_ai
  openIndiaEntry Int      // of which intern | entry, or experienceMin <= 2
  newIndia       Int      // India-eligible jobs first seen that day (the flow that feeds swipes)
  swipesRight    Int
  submitted      Int
  @@id([day, source])
}

// An employer candidate account the agent created or uses for a user (§4.4). One per user, system and tenant.
model EmployerAccount {
  id           String    @id @default(cuid())
  userId       String
  system       String    // workday | successfactors | darwinbox | oracle | icims
  tenant       String    // workday "{tenant}.{wdN}"; SF company id; darwinbox subdomain; oracle "{host}/{siteNumber}"; icims portal host
  email        String    // the user's own email when it was created
  secret       Bytes?    // AES-256-GCM (iv | tag | ciphertext) of the generated password; null for code-only systems (Oracle)
  keyVersion   Int       @default(1)
  state        String    // creating | needs_verification | active | exists_elsewhere | locked | failed
  createdBy    String    // agent | user (exists_elsewhere: the user signs in themselves)
  lastSignInAt DateTime?
  lastError    String?
  createdAt    DateTime  @default(now())
  verifiedAt   DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, system, tenant])
}
```

`Application` gains nothing: the account used is an `ApplicationEvent` (`account_created`, `account_signin`, `verify_asked`, `verify_done`) naming the system and tenant, never the email or password. Size: one `EmployerAccount` row is about 300 bytes; a million users with ten employer accounts each is about 3 GB, the same order as their resumes.

### 4.4 Employer-account state machine

```
(none) ──create──▶ creating ──ok, no check──▶ active
                      │                         ▲
                      ├──verify asked──▶ needs_verification ──user verified──┘
                      ├──"account already exists"──▶ exists_elsewhere ──user signs in in the window──▶ (that run only)
                      └──error──▶ failed (retry from create once; then the application fails with the reason)
active ──sign-in refused──▶ locked? ──"Forgot password" link to the user──▶ needs_verification
```

- `exists_elsewhere`: the user already had an account on that tenant (we do not know its password, and never ask): the application goes to `apply-person`, the window opens on the sign-in page, the user signs in, the agent fills the rest. Nothing is stored. A later option: the agent requests the tenant's password reset and the user pastes a generated password on the reset page; not in this phase.
- `needs_verification` never holds a browser (CLAUDE.md: never hold a browser open while waiting): the run ends `needs_input` with a "Verify your email for Acme" card; the user's "Done" re-enqueues the application, which signs in.
- Codes (Oracle's sign-in code, a Workday one-time code where a tenant uses one) use the existing `codeRequester` path, which may hold the browser 10 minutes, one per user at a time (`SubmitLock`).

### 4.5 Sequence: adding a board with a public form (the recipe)

1. **Fetcher** `fetchers/<board>.ts`: `list(slug)` (cheap: ids, title, location, updated) and `detail(slug, id)` (description, questions when the board publishes them); Zod-validated; `FetchedJob` as INGEST_CONTRACT says.
2. **Registry** entry in `boards.ts`: `stores` (India-only), `formHost`, `slugOf`, `discovery` (`crawlHosts` for the columnar index, `slugFromUrl`, `nameOf`).
3. **Hosts** in `apply/urls.ts` (the worker opens nothing else for the board's jobs).
4. **Adapter** `adapters/<board>.ts`: read the form (from the board's form JSON when it has one, as Keka; else the page), map through synonyms → `FieldMappingCache` → LLM, fill with sources, upload the resume (temp file deleted in `finally`), read required-empty fields before Submit, `markAttempted`, Submit, read the board's own confirmation and refusal words.
5. **Bot checks:** a board whose form carries a CAPTCHA goes into `HANDOFF_BOARDS` (the worker fills, a person presses Submit). A board with an invisible score (reCAPTCHA v3, Turnstile managed) starts as Ashby did: the worker's click in a visible window, a challenge hands the window over.
6. **Prior art first:** read the open-source code for that board (§12, "Open-source references") for its form flow and quirks before writing the adapter; references, never dependencies; MIT code we port is credited in a comment and in `docs/CREDITS.md`; code with no licence is read, never copied.
7. **Checks:** `scripts/<board>-test.ts` (offline fixtures: list, detail, form), `ats-smoke` dry runs on 3 forms of companies hiring in India, one real submit by the owner's profile, then `APPLY_BOARDS`; the board report (T97) gets the row.

### 4.6 Sequence: Workday apply with an employer account

Before anything: the swipe gate as for every board (right swipe, `isTest === false` or the mock, `governance.check('submit')`, the daily cap), plus `create_employer_accounts = Yes` (asked once, §5); without it the swipe is refused with "Workday needs an employer account: allow it in Account" and nothing is recorded.

1. **Queue.** `enqueueApply` routes Workday to `apply` (headless allowed) while M6's measurements show Workday's checks pass headless; otherwise `apply-handoff` (a worker with a screen, the worker's own click, a check hands the window over), as Ashby's routing does.
2. **Open** `{tenant}.wdN.myworkdayjobs.com/{site}/job/…/apply` from `Job.applyUrl`; dismiss cookies (`common.ts`); choose "Apply Manually" (the resume is uploaded on "My Experience", where Workday's own parse fills work history; the agent then corrects it from the resume).
3. **Account.** `vault.accountFor(userId, "workday", tenant)`:
   - none → "Create Account": the user's email, a generated password twice, the tenant's own terms box only under `accept_acknowledgements` (CLAUDE.md, `acknowledgement.ts`); real clicks, a person's pace (Workday's 500 ms minimum is met by filling, never by waiting artificially); the row is written `creating` before the click, `active` or `needs_verification` after. Event `account_created`.
   - `needs_verification` → the run ends `needs_input` ("Verify your email for Acme"), the browser closed (§4.4); the user's "Done" re-enqueues it.
   - `active` → "Sign In" with the stored password. Event `account_signin`.
   - "account already exists" on create → `exists_elsewhere`, the run goes to `apply-person`: the window opens on Sign In and the person signs in; nothing is stored.
4. **Wizard**, one page at a time, each page read from its `data-automation-id` fields and resolved through `resolveForm` (synonyms → `FieldMappingCache` → LLM; sources on every value; guess and send, CLAUDE.md):
   - *My Information*: name, address, phone (resume and profile), "How did you hear" (`job board` / the source).
   - *My Experience*: resume upload (temp file deleted in `finally`), work history and education rows as Keka's `history.ts`, skills, links.
   - *Application Questions*: tenant-specific; sensitive keys from standing answers only; required unknowns guessed or asked as today.
   - *Voluntary Disclosures*: EEO "I do not wish to answer"; the terms acknowledgement under the standing permission.
   - *Self Identify* (disability): "I do not want to answer"; never guessed.
   - *Review*: required-empty fields stop the run before Submit (nothing sent).
5. **Submit.** `markAttempted`, one click; Workday's confirmation ("Application submitted", or the candidate home listing the job as submitted) is `submitted` with its screenshot (password fields never on screen); a refusal on the page is `RefusedError`; anything else after the click is `pending_verification` (ARCHITECTURE 6.17).
6. **Second job at the same tenant:** sign in; Workday keeps My Information and My Experience per tenant, so the run mostly checks and fills the job's own questions.
7. **When Workday's Candidate Profile ships (fact 11):** sign-in by code becomes the `codeRequester` path (option 1) or the inbound address (M9), `secret` stays null for new rows, the wizard is unchanged.

### 4.7 Sequence: discovery at scale

1. **Sources list** (`discover-source`, daily, one job per board and source; M4): each source yields `{board, slug, from}` — the open lists (re-read monthly; their files are pinned by commit or checksum and their licence recorded in `slugSources/lists.ts`), the Common Crawl columnar index (each new crawl once, all boards in one DuckDB pass, about 2 minutes), Wayback for Lever (one-off), Workable's search (M12), harvested links (every ingest run: ATS hosts found in `applyUrl` and descriptions, Phenom apply links). New slugs go into `DiscoveryCandidate` as `listed`; a slug seen again only adds its source.
2. **Verify** (`discover-verify`, hourly, per board at `DISCOVER_RPS`): oldest `listed` first, then due rechecks (`nextCheckAt <= now`): one list call. On the board → a `Company` row (`addedBy = discovery`, name from `nameOf`) in tier `active`, `open` or `empty` by what it lists, whether or not any job is in India; not a board → `not_on_board`, `nextCheckAt` +90 days; error → +1 day, three errors → `not_on_board`.
3. **Throughput:** 1 call a second per board is 86,400 checks a day per board: M3's 30k seed slugs are checked within a day or two without pushing any board.
4. **Re-validation:** dead companies (§4.8) are rechecked monthly by ingest itself; `not_on_board` slugs every 90 days; a slug a fresh source lists again is rechecked at once.
5. **The report** (M1) shows per board and source: listed, checked, on the board, watched by tier, open India jobs, new India jobs a day.

### 4.8 Ingest at 50,000 companies: load and Postgres size

**Today's design does not scale past a few thousand companies.** At the 5 Nov rate (73,044 listings from 1,308 companies in 35 minutes, 4 at a time), 50,000 companies would list about 2.8 million jobs a run and take about 22 hours, against a 3-hour schedule. Stored as Greenhouse stores today (every job worldwide), at 11.2 KB a row, that is tens of GB of mostly abroad jobs.

**Five changes:**

1. **India-only storage on every board (M2).** `stores` defaults to India-eligible (`india`, `remote_india`); abroad jobs only from the companies the owner keeps for abroad seekers (§11 Q1). Greenhouse's open rows fall from 20,042 to about 2,700 on the first run.
2. **Every known company watched, each at its own pace** (`cadence.ts`; owner, 7 Nov):

   | Tier | Rule | Read every | Share at 50k (est.) |
   |---|---|---|---|
   | active | an open India job now, or one seen in the last 30 days | 3 h (as today) | 10% (5,000) |
   | open | open jobs, no India job in 30 days | 24 h | 60% (30,000) |
   | empty | on the board, no open job | 3 days | 20% (10,000) |
   | dead | no open job for 90 days, or the board gone (404) 3 times | 30 days (the re-validation) | 10% (5,000) |

   The tier is recomputed after every read, so a company moves up the moment it posts an India job. Errors back off: the interval doubles per failure up to 7 days; 8 in a row makes it `dead`. After each read `nextFetchAt = now + interval ± 10%` (jitter). Shares are estimated from fact 10 (about 9% of known companies list an India job on a given day); M1 measures them. A swipe re-reads the one posting before apply anyway (ARCHITECTURE 6.16).
3. **List, then detail.** Every fetcher first reads the cheap list; an unchanged `listHash` ends the fetch. Details are fetched only for new or changed postings that are India-eligible by their location line or whose location says nothing (a bare "Remote" needs the description, ARCHITECTURE 6.2). Greenhouse's list without `content=true` is a few KB instead of 6 KB a job.
4. **One queue job per company** (`ingest-company`, §4.2), so N workers share the work, a slow board slows only its own companies, and the per-host cap keeps us polite to each board.
5. **Closed rows go sooner:** closed jobs nobody swiped are deleted after 7 days instead of 30.

**Load (estimates; M1 replaces them with measurements):**

| | 30,000 companies | 50,000 companies |
|---|---|---|
| List calls a day | active 3,000 × 8 + open 18,000 + empty 6,000 ÷ 3 + dead 3,000 ÷ 30 ≈ **44,000** | 5,000 × 8 + 30,000 + 10,000 ÷ 3 + 5,000 ÷ 30 ≈ **74,000** |
| Extra list pages (Workday's 20 a page, India facet only) | ≈ 6,000 | ≈ 10,000 |
| Detail calls (new or changed India postings; today ≈ 800 new India jobs a day from 1,308 companies, `IngestRun.createdEligible`) | ≈ 3,000 | ≈ 5,000 |
| **Requests a day, all boards** | ≈ 53,000 (0.6/s) | ≈ 89,000 (1/s) |
| The busiest board (Greenhouse, ~40% of companies) | ≈ 0.25/s | ≈ 0.4/s; `INGEST_PER_HOST` caps it at 4 at once whatever the backlog |
| Worker time (~0.8 s a call, 8 at once) | ≈ 1.5 h a day of one worker | ≈ 2.5 h a day |
| Without tiers (every company every 3 h) | 240,000 | 400,000, and a run longer than its 3 hours |

No board publishes a rate limit for these public APIs; at under one request a second per board we stay below anything a person browsing a few boards would send, and a 429 halves that host's cap (§4.10).

**Postgres:** India-eligible open jobs on the boards of this phase ≈ 70,000 (Workday 26k, SmartRecruiters 11k, SuccessFactors 9.5k, Darwinbox 6.8k, Greenhouse 4.6k, Workable 3.8k, Keka 3.6k, Lever 2.7k, Ashby 1.1k; fact 10), ≈ 110,000 with Oracle; plus closed rows kept 7 days (+10%) → 77,000–121,000 rows × 11.2 KB ≈ **0.9–1.4 GB for `Job`**, against 468 MB today. `Company` 50,000 × ~0.5 KB ≈ 25 MB; `DiscoveryCandidate` up to 150,000 × ~250 B ≈ 40 MB. Abroad jobs kept only for the companies watched today (§11 Q1) add ≈ 25,000 rows ≈ 0.3 GB; abroad jobs from all 50,000 companies would add millions of rows (tens of GB), which is why storage is India-only. **The Job table and the ingest load grow with companies, never with users**; a million users change nothing in this section.

### 4.9 Security and privacy

- **What we never do:** use or ask for the password of the user's email, Google, LinkedIn or any account they made themselves; sign in with Google/LinkedIn on an employer site; create an account for a job the user did not right-swipe; create an account for a test profile (`isTest` runs only on the mock, §7).
- **The generated password:** 20 characters from `crypto.randomBytes`, one upper, lower, digit and symbol from a set every system accepts (`!@#$%`), regenerated if a tenant's rules refuse it. One per `EmployerAccount`.
- **At rest:** AES-256-GCM (`lib/secrets.ts`), key `ACCOUNT_SECRET_KEY` (32 random bytes, base64) in the worker's and web's env, `keyVersion` on each row for rotation. Only `modules/accounts/vault.ts` calls `lib/secrets.ts`.
- **In use:** the worker decrypts right before typing into the employer's password field on that employer's own host (`formHost` check), never into any other page. Never logged, never in an event, a diagnostic, an error string or a push; password fields are masked in every screenshot (screenshots are taken after sign-in only).
- **Shown to the user:** Account → Employer accounts → "Show password" (POST, rate-limited to 10 an hour, an audit row each time), so the user can sign in to see the status on the employer's site.
- **Delete and export:** deleting the SwipeApply account deletes every `EmployerAccount` row (cascade) and tells the user which employers still hold an account in their name; export lists them, with passwords.
- **CLAUDE.md hard rule (lands with M5):** "Employer accounts: created only after a right swipe on that employer's job and under the user's standing permission; the login is the user's own email and a password we generate per account; stored only through `modules/accounts` (AES-GCM); never logged; typed only on that employer's host; shown only to the user. Never the user's own password for any service; never SSO."

### 4.10 Failure handling

| Failure | What happens |
|---|---|
| A board's list or detail fails | `Company.lastError`, `failedFetches + 1`, `nextFetchAt` backs off (×2, at most 1 day); 8 in a row switches the company off (ARCHITECTURE 6.2 rule kept) |
| A board answers 429 / 403 | That host's cap halves for an hour; its jobs wait, other boards go on |
| A slug source is down (Common Crawl 503, Wayback down) | That `discover-source` job fails and runs tomorrow; other sources go on |
| Account creation refused ("already exists") | `exists_elsewhere`, the application to `apply-person` (§4.4) |
| Verification email never comes | The card stays under "Needs you" with "Send it again" (the agent presses the tenant's resend); `PERSON_WAIT_HOURS` (24) fails the application, nothing sent |
| Sign-in refused with the stored password | One retry; then `locked`, the user is asked to reset (§4.4) |
| The tenant's wizard has a page we do not know | Stop before Submit, screenshot, `failed` with the page title; the step is added to the adapter |
| Anything after `markAttempted` | `pending_verification` as today (6.17); never retried |

### 4.11 Observability

- Board report (T97, extended): per board — slugs listed per source, checked, on the board, watched by tier, open India jobs, entry-level India jobs, swipes, submitted, failed, handed over.
- Ingest: per tick — companies due, fetched, short-circuited by `listHash`, details fetched, created, closed; the oldest overdue `nextFetchAt` (alert past 1 hour).
- Accounts: per system — created, verification asked, median time to verified, sign-ins, `exists_elsewhere`, `locked`.

### 4.12 Code map

| Path | Task | What |
|---|---|---|
| `prisma/schema.prisma` + migrations | M1, M2, M5 | `BoardDay`; `Company` tier fields; `DiscoveryCandidate.nextCheckAt`; `EmployerAccount` (applied with `migrate deploy` only: never a shadow database on Neon) |
| `scripts/board-day.ts`, `scripts/feed-report.ts` | M1 | Daily snapshot (worker cron 23:30 UTC) and the report over a date range |
| `modules/jobs/cadence.ts` | M2 | Tier rules, intervals, back-off, `nextFetchAt` |
| `modules/jobs/ingest.ts` | M2 | `ingestCompany(id)` (one company, list → detail, close and reopen as today); the old `runIngest` loops over it for the manual path |
| `src/worker/handlers/ingest-tick.ts`, `ingest-company.ts`; `src/worker/schedule.ts` | M2 | The tick cron and the per-company queue; `INGEST_CRON` retired |
| `modules/jobs/fetchers/*.ts` | M2, then each board | `list` / `detail` split |
| `modules/jobs/slugSources/*.ts`, `modules/jobs/boardSeeds.ts`, `scripts/discover-boards.ts` | M3, M4 | Seed import for every board (today Greenhouse, Lever, Ashby only), then the daily sources |
| `src/worker/handlers/discover-source.ts`, `discover-verify.ts` | M4 | Replace the per-board `discover` loop |
| `lib/secrets.ts`, `modules/accounts/{vault,index}.ts` | M5 | AES-GCM, the only reader and writer of `EmployerAccount.secret` |
| `modules/apply/account/{flow,workday}.ts`, `modules/apply/adapters/workday.ts` | M5, M6 | Create, sign in, verify; the wizard |
| `src/app/mock/workday/*` | M5 | A mock account board (sign-up, verify, sign-in, a three-page wizard) for test profiles and offline checks |
| `src/app/api/accounts/employers/*`, `src/app/(app)/account/*` | M5 | Employer accounts list, reveal, forget |
| `modules/apply/adapters/{smartrecruiters,successfactors,darwinbox,oracle,workable,zohorecruit}.ts` and their fetchers | M7–M13 | One per board, by §4.5 |
| `lib/queue.ts` | each board | `APPLY_BOARDS`, `HANDOFF_BOARDS`, routing |
| `modules/apply/urls.ts` | each board | Form hosts |
| `config/rules.json` | M5 | `max_accounts_created_per_user_per_day` (10), `max_accounts_created_per_tenant_per_hour` (20, all users) |

### 4.13 Env (ARCHITECTURE §11 additions)

| Name | Default | Used by |
|---|---|---|
| `ACCOUNT_SECRET_KEY` | — (required for account boards) | `lib/secrets.ts`; worker and web |
| `INGEST_TICK_CRON` | `*/5 * * * *` | `ingest-tick` |
| `INGEST_TICK_BATCH` | 500 | `ingest-tick` |
| `INGEST_CONCURRENCY` | 8 | `ingest-company` per worker |
| `INGEST_PER_HOST` | 4 | `ingest-company` across workers |
| `DISCOVER_RPS` | 1 | `discover-verify`, per board host |
| `ENABLE_ACCOUNT_BOARDS` | off | `APPLY_BOARDS` includes Workday (later SuccessFactors, Darwinbox, Oracle) only when on |
| `ACCOUNT_BOARDS_USERS` | — | Comma list of user ids allowed account boards while it rolls out (§8) |
| `INGEST_MODE` | `run` | `tick` switches to per-company ingest (§8); `run` keeps the 3-hourly run until the switch |

---

## 5. UI

All in the existing design (`design/`, DESIGN.md); no new screens beyond one Account section.

- **Feed card:** new boards get their logo chip as T105 did; a Workday, SuccessFactors, Darwinbox or Oracle job carries a small "Employer account" note under the role until the user has allowed accounts.
- **Standing permission**, asked once, on the first right swipe of an account-board job (the same sheet as `accept_acknowledgements`): "Some employers need an account to apply. Let SwipeApply create one in your name with your email and a password it makes for each employer? You can see every account and its password in Account." Yes / No. No keeps those jobs out of the feed (the user can change it in Account).
- **Account → Employer accounts:** company, system (Workday, SuccessFactors, Darwinbox, Oracle), created, state ("Ready", "Verify your email", "You signed in yourself"), "Show password" (sheet, copy button), "Forget". Empty state: "No employer accounts yet." Error state as every list.
- **Needs you:** "Verify your email for Acme (Workday)": what to look for in the inbox, "Done", "Send it again". The code sheet as today for codes.
- **Application page:** events `account_created`, `account_signin`, `verify_asked`, `verify_done` in the timeline as plain lines ("Created your Acme account on Workday").

No change for boards with public forms beyond their logos.

---

## 6. API

| Route | Method | Does |
|---|---|---|
| `/api/accounts/employers` | GET | The user's employer accounts: company, system, state, created, last sign-in (no secrets) |
| `/api/accounts/employers/[id]/reveal` | POST | The password, once, rate-limited, audited |
| `/api/accounts/employers/[id]` | DELETE | Forgets the row (the employer's account stays; the response says so) |
| `/api/applications/[id]/verified` | POST | The user says the email is verified; re-enqueues the application |
| `/api/profile/permissions` | PATCH | Existing standing permissions gain `create_employer_accounts` |

---

## 7. Testing

| Check | Task | Proves |
|---|---|---|
| `scripts/board-day-test.ts` | M1 | The day's counts from fixture rows; one row per board per day, re-runs overwrite |
| `scripts/cadence-test.ts` | M2 | Tier rules, intervals, jitter bounds, back-off, promotion on a new India job, `dead` after 90 days or 3 × 404 |
| `scripts/ingest-scale-smoke.ts` | M2 | 20,000 synthetic companies against a local fake board server: ticks enqueue only due companies, per-host cap held, unchanged lists short-circuit, the oldest overdue `nextFetchAt` stays under 1 hour; prints requests a day and rows written |
| `scripts/ingest-contract-test.ts` (existing) | M2 | Close, reopen, update rules unchanged per company |
| `scripts/board-seeds-test.ts` (existing, extended) | M3, M4 | Every board's slug parsing from list rows and crawl URLs; licence-blocked lists refused |
| `scripts/vault-test.ts` | M5 | Encrypt and decrypt round trip, key version, a wrong key fails closed, the password never appears in events, logs or errors (searches the run's output) |
| `scripts/account-flow-smoke.ts` on `/mock/workday` | M5, M6 | A test profile creates, verifies (the "Done" path), signs in, fills three pages and submits on the mock; a second run signs in; `exists_elsewhere` goes to `apply-person` |
| `scripts/workday-test.ts` | M6 | Offline fixtures of real Workday pages: every `data-automation-id` the wizard reads |
| `ats-smoke` dry runs | each board | 3 forms of companies hiring in India fill and stop before Submit |
| One real submit by the owner's profile | each board | Before `APPLY_BOARDS` |

Test profiles (`isTest`) never create a real employer account: the runner blocks every account board's host for them, as it blocks real forms today (§11 Q6 for the mock rule).

---

## 8. Rollout

1. **M1** first: the snapshot starts before anything changes, so every later task is measured against a baseline.
2. **M2** behind `INGEST_MODE=tick` (default the old run until the tick's first day matches the old run's counts within 2%), then the old cron is removed.
3. **M3** board by board, Greenhouse first (largest list), each import a dry run (counts only) before `--write`; two weeks of M1 numbers after the last import.
4. **M5** with `ENABLE_ACCOUNT_BOARDS` off: vault, mock, permission; **M6** dry runs on 3 tenants; the owner's real submit; then the switch on for the owner only (`ACCOUNT_BOARDS_USERS`), then everyone.
5. Each later board: dry runs, one real submit, `APPLY_BOARDS`.
6. Every task updates ARCHITECTURE in the same change: §5 and §6.2 (boards, ingest), a new §6.21 (employer accounts), §11 (env); M5 also CLAUDE.md's hard rules.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A board blocks our ingest at volume | Under 1 request a second per board, a per-host cap, back-off on 429/403; the board report shows each host's errors daily |
| Employer accounts look like an account farm to an employer | One account per user per tenant, only after a right swipe, the user's own email, a person's pace, `max_accounts_created_per_tenant_per_hour`; the worker never creates an account it will not use at once |
| Workday's invisible checks refuse the worker | Start in a visible window with real clicks (as Ashby); a refusal hands the window over; measure before headless |
| A stored password leaks | One per employer, AES-GCM, key outside the database, never logged; a leak opens one employer account of one user, which the user can reset |
| An employer's terms forbid accounts "by automated means" | The user's standing permission names it; each account is the user's own, created at their request for one job; the owner's call (§11 Q2) |
| Workday's Candidate Profile changes the flow in 2027 | `secret` nullable; the code path exists (option 1); the wizard stays per tenant |
| Seed lists carry dead or wrong slugs (Hugging Face's Ashby rows ~48% dead) | Every slug verified on the board's own API before it is watched; dead ones cost one call every 90 days |
| A list's licence forbids commercial use | Only MIT and CC BY sources; the licence recorded per list in code; Feashliaa's CC BY-NC data never read |
| Storage grows past Neon's plan | India-only storage, 7-day closed rows; M1 records the table size daily; at 2 GB the owner decides plan or partitioning |
| Staffing tenants flood the feed (SmartRecruiters' Weblee, Squircle) | A per-company cap on feed share (existing ranking), and `Company.active = false` by the owner when a tenant is junk |
| Per-user tables at a million users (`JobJudgement` ~1,500 rows a user today, `ApplicationEvent`, `FileBlob`) | Out of this phase; a separate design before 100k users (ARCHITECTURE §12 already moves files to S3/R2) |

---

## 10. Tasks

In [TASKS.md](TASKS.md) beside this file: M1–M15 with their Do, the design sections each builds and Done-when. Root `docs/TASKS.md` Phase M lists them one line each, in the order of §3.4.

---

## 11. Open questions for the owner

Each has a recommendation; the task it blocks is in brackets.

1. **Abroad jobs.** Storage becomes India-eligible only on every board. Keep abroad jobs for the ~460 Greenhouse and Lever companies watched today, so users who pick places abroad still see them (+0.3 GB), or drop abroad jobs everywhere? *Recommended: keep them for today's companies only.* [M2]
2. **Employer accounts.** May the agent create an employer account in the user's name, with their own email and a password we generate per employer, stored encrypted and shown only to them, after a right swipe and under a once-asked permission (option C, §3.2)? This adds a CLAUDE.md hard rule (§4.9). Alternatives: one password the user sets (Tsenta), or no account boards. Same question as the Naukri plan's Q10. *Recommended: C.* [M5, M6, M8, M10, M11]
3. **The email step at scale.** Ship with the user clicking links and typing codes (option 1). For later, pick between a private relay address per user (option 2, Tsenta's and Kombo's way: fully automatic, but employers see our address) and a Gmail forwarding filter to our inbound address (option 3: the user's own email stays on the application, one-time setup). Or stay manual, and Oracle stays out. *Recommended: option 1 now, option 3 next.* [M9, M11]
4. **Workday on the screen worker first.** Workday has its own invisible human checks. Start Workday like Ashby, in a visible window on the worker with a screen, with headless only after measuring? *Recommended: yes.* [M6]
5. **Seed lists.** Use ats-scrapers (MIT), upstreamit (MIT), openroles, jobseek (MIT) and Hugging Face `latmay` (CC BY 4.0, credited in the docs) for company slugs, verifying each on the board's own API? Use the stapply hosted dataset only for counting and slugs, never its job texts? *Recommended: yes to both.* [M3, M4]
6. **The mock rule.** Test profiles may only run against `/mock/greenhouse` today. Widen the CLAUDE.md hard rule to `/mock/*` so `/mock/workday` can test the account flow (the Naukri plan's K4b asks the same)? *Recommended: yes.* [M5]
7. **Neon storage.** The `Job` table grows from 0.47 GB to about 0.9–1.4 GB (1.7 GB with abroad jobs kept). Is the current Neon plan's limit enough, or do we approve the next plan now? [M3]
8. **Task moves.** T95 (SmartRecruiters) moves to M7 and T98 (more slug sources) is superseded by M3 and M4. Both are marked moved in Phase J. T94 (Lever) stays in Phase J and counts Lever's seeded jobs once it lands. *Recommended: yes.* [index]
9. **Non-tech pools.** Darwinbox needs an employer account like Workday, and the dataset's Darwinbox jobs are mostly banking and insurance (882 of 6,757 India jobs are tech; its own feeds also show Airtel, MakeMyTrip and Porter). Keep it fifth, which serves the non-tech users of T85, or move it after Workable? *Recommended: keep it fifth, and let M1's numbers decide.* [M10]
10. **Paid sources and the DPIIT list.** No paid feed (TheirStack and the like) for now. Is downloading the DPIIT startup list (236k companies with websites, on Dataful, licence not stated) fine once its terms are read? *Recommended: no paid feed; DPIIT only with clear terms.* [M4]
11. **Signed-in Indian portals** (Naukri, foundit, hirist, iimjobs, Instahyre) come after this phase, as the owner said on 7 Nov. Nothing in this plan touches them.

---

## 12. Research notes and sources

Full notes, with every fact tagged as live, read from vendor JavaScript, documented, or second-hand, are in the session notes of 7 Nov (`boards-research-A.md`, `boards-research-B.md`, `account-boards-research.md`, `discovery-research.md`, `india-sources-research.md`, `stapply-india-counts.md`). The facts this design uses:

- **Our database, 7 Nov:** read-only queries on Neon covering table sizes (`pg_total_relation_size`), companies and jobs per board, `DiscoveryCandidate` by source and status, the last `IngestRun` rows, and applications per board.
- **India jobs per system:** `storage.stapply.ai/jobhive/v1/manifest.json` and `all.parquet` (snapshot 6 Nov 14:30 UTC), read with DuckDB 2.0 over HTTPS. India means `country_iso='IN'` or a word in `location` matching `india|bengaluru|bangalore|hyderabad|pune|mumbai|chennai|gurgaon|gurugram|noida|new delhi|delhi|kolkata|ahmedabad|kochi|coimbatore|jaipur|chandigarh|thiruvananthapuram|trivandrum|indore|mohali|vadodara|nagpur|bhubaneswar|mysore|mysuru|visakhapatnam`. Tech means a title matching `engineer|developer|software|data|devops|sre|qa|test|machine learning|ml|android|ios|frontend|backend|full stack|cloud|security|architect|programmer|analyst`. Repo: `github.com/kalil0321/ats-scrapers` (MIT; its README states no separate dataset terms).
- **Boards with public forms, checked live with curl and a real Chromium, nothing submitted:** `api.smartrecruiters.com/v1/companies/{id}/postings`; `apply.workable.com/api/v1/widget/accounts/{slug}?details=true`; `jobs.workable.com/api/v1/jobs?location=India`; `{slug}.recruitee.com/api/offers/`; `{slug}.bamboohr.com/careers/list`; `ats.rippling.com/api/v2/board/{slug}/jobs`; `app.dover.com/api/v1/careers-page-slug/{slug}`; `api.gem.com/job_board/v0/{slug}/job_posts/`; `{site}/jobs.json` (Teamtailor).
- **Account systems:** Workday CXS (`nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs`) and Workday's cx-jobs bundle 2026.44.13; Oracle CE REST and the CE bundle 2607.26. Oracle docs: "Email and SMS for candidate identity verification", "Enable candidate autoconfirmation", "Enable email authentication and email reuse" (docs.oracle.com, Talent Management). SAP KBA 3099120 (SuccessFactors verification). iCIMS candidate guide (community.icims.com) and terms (`icims.com/legal/terms-of-use`). Workday Candidate Profile: newsroom.workday.com, 13 Oct 2026. Tsenta: `help.tsenta.com/help/supported-job-sites-and-ats` and its help pages on the application password and inbox. Kombo: `docs.kombo.dev/ai-apply-candidate-account-creation`. Jobscan on Fortune 500 ATS share.
- **Discovery:** Common Crawl `index.commoncrawl.org/collinfo.json` (the CDX API answered 504 all day on 7 Nov) and `data.commoncrawl.org/crawl-data/CC-MAIN-2026-43/cc-index-table.paths.gz`, the columnar index read with DuckDB. Other sources: `crt.sh`; `web.archive.org/cdx`; the GitHub lists `ElliotGbaum/upstreamit`, `datascry/openroles`, `colophon-group/jobseek`, `veresk06/open-ats-feed`, `chrisdothtml/job-scraper` (MIT) and `Feashliaa/job-board-aggregator` (CC BY-NC, not used); `huggingface.co/datasets/latmay/ats-career-page-urls` (CC BY 4.0); `yc-oss.github.io/api/companies/all.json`; `dataful.in/datasets/20873` (DPIIT); TheirStack's data-workflow docs.
- **Aggregators and Indian portals:** `policies.google.com/terms` and `google.com/robots.txt`; serpapi.com pricing and the Google v. SerpApi reporting (The Register, 21 Feb 2026; Search Engine Land); `developer.adzuna.com` terms; `jooble.org/api/about`; Careerjet partners API; `employers.talent.com/publishers`; webdatacommons.org schema.org subsets (2024-12); each portal's robots.txt and terms (hirist, iimjobs, Instahyre, Cutshort, Wellfound, foundit); Info Edge's acquisition of Highorbit Careers (iimjobs, hirist), Business Standard, May 2019.
- **Open-source references (found 7 Nov, not yet read; small or young, so references only):** Workday: `HarshadLambate/workday-autofill` (MIT, pushed 30 Oct 2026; also Lever, Greenhouse), `ishaannarula/job-application-automation` (MIT, work in progress), `simonfong6/auto-apply` (MIT, 2019; Greenhouse, Lever, Workday, Jobvite), `challaharshavardhan/WorkdayJobBot` (no licence: read only; sign-in through the question pages). Several boards: `summitsingh/ai-job-pilot` (MIT; Greenhouse, Ashby, Lever, Workable), `hasaansworld/agentic-apply` (MIT; detects the system, fills, recovers failed submits), `vaibhavarora14/job-application-agent` (MIT), `rajakrishna/easy-apply` (MIT, 2020; SmartRecruiters). Job readers: `devilscrapes/smartrecruiters-jobs-scraper-javascript` (MIT, Node); `kalil0321/ats-scrapers` (MIT, Python, 64 sources including Workday, SuccessFactors, Oracle, iCIMS) for fetch logic to port to TypeScript.
- **Prior Phase J measurements:** `docs/tasks/09-phase-j-more-boards.md` T92, T93, T96, T99.
