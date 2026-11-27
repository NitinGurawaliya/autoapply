# TDD — Hirist on the Naukri pattern (Phase K, K16–K19, owner, 27 Nov 2026)

Tasks: [TASKS.md](TASKS.md). Source of truth once landed: ARCHITECTURE §6.20 ("Hirist"). Naukri's design, which this one reuses: [docs/naukri/TDD.md](../naukri/TDD.md) §13.16 (OTP connect) and §13.17 (shared reader).

## 1. Goals and non-goals

**Goals.** Hirist (hirist.tech, an Info Edge tech-jobs portal) works end to end the way Naukri does:
- Its listings are read once for everyone by our own signed-out reader and stored as ordinary `Job` rows.
- A user connects their own Hirist account with the one-time code Hirist sends to their email or mobile.
- A right swipe on a Hirist job applies through that account, at the site's caps and pace.

**Non-goals.**
- foundit and iimjobs. iimjobs shares Hirist's login and can follow on the same connect later.
- Showing Hirist jobs to users who have not connected Hirist.
- A Hirist listing that applies on a company's own site. It is stored with `applyVia` and refused on swipe, as Naukri's are.

## 2. Facts the design rests on (27 Nov 2026)

From public pages, the site's JavaScript and robots.txt only: no API was called and no one was signed in. The owner checked the login form by hand.

- **Pages.**
  - Skills: `/k/<skill>-jobs`.
  - Free search: `/search/<query>`.
  - Categories: `/c/<cat>-jobs`. Cities: `/it-jobs-in-<city>`.
  - A company: `/<company>-careers`. A job: `/j/<slug>-<id>`.
  - Filters: `minexp`, `maxexp`, `loc` (a numeric id), `posting`.
- **The page's own calls.** The page's Next.js code fetches listings from `gladiator.hirist.tech/job/...` (search, category, keyword search, job detail).
  - There is no signature header.
  - The server can ask for a captcha. The page then shows one and resends with `x-captcha-response`.
  - The HTML itself carries no listings.
- **Fields.**
  - `id`, `title`, `companyData`, `locations`, `minExp`/`maxExp`, `minSal`/`maxSal`/`hideSal`, `createdTime`, `tags` (skills).
  - `applyUrl`, set when the job applies on an external page.
  - The description comes from the detail call.
- **Login** (owner's screenshot, 27 Nov). "Login here": one field, "Email or Mobile Number", with "You will receive one time password on this", then a "Get OTP" button.
  - The page also has "Use Password to Login", "Continue with Google" and "Continue with Apple". We use only the OTP path.
- **Apply.** On the portal: Apply, then screening questions (`/job/[id]/screening`), then review (`/review-apply`).
- **Protection.** Plain nginx, with no Akamai or Cloudflare cookies. The app has its own captcha state.
- **robots.txt.** `Crawl-delay: 10`. `/k`, `/c`, `/j` and `/search` are not disallowed.
- **Terms.** They forbid crawling, as Naukri's do (see naukri TDD 13.17 Risks).
- **Scale.** Tech only, about 27k job URLs in the sitemap.

## 3. Options and decision

Hirist follows Naukri: one shared signed-out reader for listings, and each user's own account for applies, decided by the owner on 27 Nov ("following the same principle"). To get there, the Naukri-only seams become a per-site **driver**, so that Hirist is one more driver rather than a copy of every module.

## 4. Architecture

### 4.1 Site drivers
`src/modules/apply/sites/drivers.ts`: `driverOf(site)` returns a `SiteDriver` in three parts.
- **reader:**
  - the front page;
  - how a search is made into a URL;
  - which of the page's own calls carries a search or a job, and how its JSON becomes `SiteListing`s;
  - page size, an empty search, page stops;
  - which listings are worth a job page;
  - the search vocabulary and the company search.
- **login:**
  - the login id (mobile or email);
  - `sendCode`, `enterCode`;
  - signed-in detection;
  - the first name.
- **apply:** read the job page, press Apply, answer, and read the site's reply.

`read.ts` holds the shared `readCall` (wait for the page's own call, map its status: challenge, refused, needs sign-in, error). Naukri's driver wraps today's functions unchanged.

### 4.2 Reading (as naukri 13.17)
- **Buckets.** Search buckets come from users connected to Hirist. Company buckets come from the owner-approved list of 808 names, read on `/<company>-careers`.
- **Running.**
  - The `reader-plan` tick plans both sites. `reader-run` windows are serial across sites, so a Naukri window and a Hirist window never overlap.
  - The proxy owner name is `reader-N-R` with the site in the session hash, so Hirist reads from an address of its own.
- **Caps** (`config/rules.json shared_readers.hirist`):
  - `seconds_between_pages` at least 10, from robots.txt;
  - 120 pages and 100 job pages a day;
  - a pause after a check.

### 4.3 Connect (as naukri 13.16)
- The user types their email or mobile, and the code Hirist sends, in our app. The agent enters both on Hirist's own login page in our window. A captcha there is the user's step, on the streamed page.
- The login id is sealed like Naukri's number and deleted on Disconnect. The code is held in memory for that sign-in only.

### 4.4 Apply (as naukri K4)
- The `apply-site` queue, the gate (connection, daily cap, pace) and the answer engine are unchanged.
- The Hirist driver reads the job page and presses Apply. It answers the screening with the user's answers (sources and the guess rules as everywhere), then reads Hirist's own reply.

### 4.5 Env
- `HIRIST_READER=1` on the worker with a screen.
- `ENABLE_HIRIST=1` on the web and the worker: jobs show to connected users, and connect is offered.
- `ENABLE_HIRIST_APPLY=1` after the owner's first real apply.

The Naukri names stay as they are. `src/lib/site-flags.ts` reads `ENABLE_<SITE>`, `ENABLE_<SITE>_APPLY` and `<SITE>_READER` for every site.

### 4.6 Code map
- **New:**
  - `apply/sites/read.ts`, `drivers.ts`, `hirist.ts` (reader and login), `hiristApply.ts`;
  - `jobs/fetchers/siteListing.ts`, `hirist.ts`;
  - `lib/site-flags.ts`;
  - `app/mock/hirist`;
  - `scripts/hirist-*.ts`.
- **Changed:**
  - `sources/sites.ts`;
  - the reader, ingest, connect, relay, gate and lean code;
  - `runner.ts`;
  - `jobs/{boards,pool,match,ingest}.ts`, `lib/queue.ts`;
  - `config/rules.json`.

## 5. UI
- Account shows a Hirist card beside Naukri's: connect with "Email or mobile number", then the code.
- The feed and job page show "via Hirist" as they show "via Naukri".
- No new screens.

## 6. API
Unchanged: `/api/sources/[site]/*` takes `hirist` once it is in `SITES`.

## 7. Testing
- **Offline, all PASS:**
  - `hirist-listing-test`: JSON to `SiteListing`.
  - `hirist-reader-test`: fake page windows, the incremental stop, the company filter, check to pause and a new address, budgets.
  - `hirist-connect-smoke`: the mock login page.
  - `hirist-mock-smoke`: a test profile applies on `/mock/hirist`.
- **The Naukri checks must still print PASS:** `naukri-reader-test`, `naukri-listing-test`, `naukri-adapter-test`, `naukri-lean-test`.
- **Live, in the screen image:** one reader window, and a dry run on 3 real jobs that presses nothing.

## 8. Rollout
K16 → K17 → K18 → K19, each pushed to `main` and the screen image rebuilt. Flags in the order of 4.5.

## 9. Risks
- Hirist may show its captcha to the reader. The window stops, the reader pauses 24 hours and moves to a new address.
- Hirist's terms forbid crawling.
- The OTP page may change. It is caught by `pageStop` and by a connect that fails with the page's own message.

## 10. Tasks
[TASKS.md](TASKS.md): K16 site drivers, K17 Hirist reader, K18 Hirist connect, K19 Hirist apply.

## 11. Decisions closed with the owner (27 Nov 2026)
1. Hirist follows Naukri's principle: a shared signed-out reader, and applies through the user's own account.
2. Foundit is left out for now.
3. Hirist jobs show only to users who connected Hirist.
4. Connect is by OTP on Hirist's own page ("Email or Mobile Number", "Get OTP"). No password, no Google.
5. Reading and apply are planned together and built in order.

## 12. Sources
- `hirist.tech/robots.txt`, `/terms`, `/k/python-jobs` and its Next.js chunks on `js-static.hirist.tech`, and `new_sitemap_index.xml`, all read 27 Nov.
- The owner's screenshots of Hirist's login form and of myjobb's Hirist connect.
