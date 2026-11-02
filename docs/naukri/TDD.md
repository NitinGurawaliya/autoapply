# Naukri through the user's own account — technical design (Phase K: K1, K2, K4)

Version 2, 3 Nov 2026. Owner's decision of 29 Oct: Naukri and LinkedIn come in through the user's own signed-in account, after Phase J (ARCHITECTURE §6.20, PRD FR10, CLAUDE.md hard rules). This is the full design for the Naukri half. LinkedIn (K3, K5) reuses the same connection, ingest and stepwise-apply shape. ARCHITECTURE stays the source of truth: K1 copies the decisions here into §6.20 when it lands.

Decisions discussed with the owner on 3 Nov and fixed here: **jobs are fetched per user through their own Naukri session (never a crawl of Naukri), stored as ordinary `Job` rows in our Postgres, shared between connected users, shown only to users with a connected account, applied in the user's own session.** Tooling: our Playwright worker; webcmd is for reconnaissance only (§3).

---

## 1. Goals and non-goals

**Goals**
- G1. A user connects their Naukri account by signing in themselves; we never see, type, store or log a password or OTP.
- G2. Naukri jobs that fit the user appear in the same feed, same card, same match tiers and filters, with a "via Naukri" chip.
- G3. A right swipe ends in an application submitted on Naukri with the user's own session, every value with its `source`, Naukri's own confirmation as evidence, every step an `ApplicationEvent`.
- G4. Naukri's screening questions are answered from the answer bank; the ones we cannot answer go to "Needs you" once and are reused.
- G5. Any check by Naukri (CAPTCHA, OTP, "verify it's you", "Access Denied") stops the agent and hands the window to the person. Nothing is bypassed.
- G6. Traffic to Naukri per account stays at a person's pace, bounded by rules in `config/rules.json`.
- G7. Disconnect deletes the saved session at once; account delete and export behave as for every other personal file.

**Non-goals**
- LinkedIn (K3, K5), beyond keeping the shapes reusable.
- Jobs that Naukri sends to a company site on an ATS we have no adapter for (Workday, Darwinbox, careers pages).
- Editing the user's Naukri profile or resume on Naukri; reading anyone else's profile; reading messages.
- Running Naukri on the headless Docker worker (it needs a screen; §4.1).
- Hiding from Naukri's bot detection (stealth browsers, proxies, header minting). Out by principle, not by priority.

---

## 2. Facts the design rests on (research, 3 Nov 2026)

Full notes and sources in §12. The short list:

1. **Naukri's search and job pages render in a plain Chromium window.** The page's own script calls `GET /jobapi/v3/search?…` (listings) and `GET /jobapi/v4/job/<id>` (posting) and gets JSON. The same calls without the page's per-session signature (`nkparam`) answer **406 "recaptcha required"**; from a server or datacenter address Akamai answers **403 "Access Denied"**. We read the responses the page fetched for itself; we never mint, copy or replay the signature.
2. **The listing JSON already says how a job applies:** `companyApplyJob` + `applyRedirectUrl` (applies on the company's own site), `questionnaireIdPresent` (Naukri asks questions after Apply), `mode` (`jp` posted on Naukri, `crawled` copied from a company site). Also `jobId`, `title`, `companyName`, `companyId`, `groupId`, `logoPath`, `jdURL`, `placeholders` (experience, salary, location), `tagsAndSkills`, a 300-character snippet, `createdDate` (ms).
3. **Signed in, Apply has three outcomes** (from the open-source bots; confirmed in K4 recon): applied at once; a chat drawer asking screening questions one at a time; "You have already applied". Jobs may also redirect to the company site.
4. **Naukri's terms** forbid "automated means to crawl and/or scrape content" and say "You undertake not to circumvent" its anti-robot measures; accounts showing "unusual" activity are checked and can be limited. Headless or patched browsers and datacenter hosts are refused; a normal Chrome window on home broadband works; bursts trigger CAPTCHAs and OTP checks. No safe rate is published.
5. **webcmd** (0.7.4, Apache-2.0, installed here) has no Naukri or LinkedIn adapter (its plugin catalog answers 404 today), runs scripts in a QuickJS sandbox where none of our modules can run, keeps cookie jars in a local folder, and its local browser runtime is **CloakBrowser, a stealth Chromium sold on anti-bot patches** — the circumvention in fact 4. Its cloud mode is "not yet stable".
6. Naukri now ships its own **"Neo AI job agent"**. There is no public or partner API for job seekers today; if one appears, it replaces this design's browser work.

---

## 3. Options and decision

| Option | Reads jobs | Applies | Fit | Verdict |
|---|---|---|---|---|
| **A. Our Playwright worker, the handoff Chrome window, the user's own session** | yes | yes | Everything exists (T100 state in storage, 6.17 handoff, person queue, submit guard, screenshots, events) | **Chosen** |
| B. webcmd adapter on its CloakBrowser profile | yes | yes | Stealth runtime; local cookie jars; QuickJS; second browser stack; no adapter exists; cloud unstable | No; recon only |
| C. Naukri's internal JSON API from the worker (app identity, minted `nkparam`) | until it breaks | partly | Circumvention; Akamai refuses our hosts; changes without notice | No |
| D. Third-party scraped data (Apify, TheirStack, jobspipe, Mindcase) | yes, paid, stale | no | Still scraped Naukri; applying still needs the account | No |
| E. Hosted browsers (Browserbase, Steel, Anchor) | yes | yes | Datacenter addresses refused; residential proxies are evasion; session leaves our storage | No |
| F. CDP into the user's own running Chrome | yes | yes | A debug port on the user's browser; laptop-only anyway, which A already is | No |
| G. LLM browser agents (browser-use, Stagehand, computer use) | yes | yes | Non-deterministic on a site that suspends accounts; no `source` per value | No |
| H. Chrome extension | yes | yes | PRD §8 out of scope | Later, if ever |
| I. Official Naukri API | — | — | None for job seekers | Watch |

**Decision.** Option A. Naukri is a *signed-in source*: a `SiteConnection` per user and site, the user's Naukri browser state saved per site through `lib/storage.ts`, a per-user ingest that reads search pages inside the user's own Chrome window, a Naukri adapter that applies in the same window, and new rules in `config/rules.json` for pace and caps. Naukri work runs **only on a worker with a screen** (`canShowWindow()`), in the real Chrome channel, never headless.

**Where the jobs come from and where they live** (owner, 3 Nov): per user, from their own session, 2–3 searches built from their profile, twice a day; results are ordinary `Job` rows in Postgres (the feed, match, swipe, runner and audit all read `Job`); rows are shared between connected users (a listing is public; a second user does not need a second run); Naukri rows are shown only to users whose account is connected. We never crawl Naukri.

---

## 4. Architecture

### 4.1 Components

```
 Browser (user)                       Next.js web (stateless)                    Postgres (Neon)
 ┌─────────────────────┐   HTTPS     ┌──────────────────────────────┐          ┌─────────────────────────┐
 │ /account            │────────────▶│ /api/sources            GET  │          │ SiteConnection          │
 │  Connected job sites│             │ /api/sources/:site/connect   │──writes─▶│ SourceRun               │
 │  [Connect] [Fetch]  │◀──poll 5s───│ /api/sources/:site/disconnect│          │ Job (source=naukri)     │
 │ /feed  "via Naukri" │             │ /api/sources/:site/ingest    │          │ Company (source=naukri) │
 │ /applications/:id   │             │ /api/swipes → lifecycle      │          │ Application, Events     │
 └─────────────────────┘             │ /api/jobs (feed)             │          │ FileBlob (browser-state)│
                                     └──────────────┬───────────────┘          │ pgboss.*                │
                                                    │ enqueue (pg-boss)        └───────────┬─────────────┘
                                                    ▼                                      │
 ┌───────────────────────────────────────────────────────────────────────────────────────┐ │
 │ Worker WITH A SCREEN (the owner's laptop; later a VM with a display)                  │ │
 │  queues: source-connect · ingest-source · apply-handoff (naukri) · apply-person       │◀┘
 │  modules/sources   connect.ts (wait for sign-in), connection.ts (status machine)      │
 │  modules/apply     browser.ts (site-scoped state) · sites/naukri.ts (page reads)      │
 │                    adapters/naukri.ts (Apply + chat drawer) · runner.ts (step loop)   │
 │  modules/jobs      fetchers/naukri.ts (JSON → FetchedJob) · ingest.ts ingestForUser   │
 │  ┌─────────────────────────────────────────────────────────────┐                      │
 │  │ Google Chrome, visible window, one context per run,         │   user signs in /    │
 │  │ storageState = the user's Naukri cookies only               │◀──presses nothing─── │
 │  └─────────────────────────────┬───────────────────────────────┘   else               │
 └────────────────────────────────┼──────────────────────────────────────────────────────┘
                                  │ ordinary page loads, the page's own XHR
                                  ▼
                           www.naukri.com  (Akamai in front)
 Docker worker (no screen): Greenhouse, Lever, unprotected Ashby, company ingest — never Naukri.
```

Rules kept: API routes only enqueue (never a browser); Playwright only under `modules/apply`, only in the worker; modules never import `app/`; all LLM calls through `lib/llm.ts` (the chat drawer's free-text answers go through the existing resolver); only `lib/storage.ts` touches `FileBlob`.

### 4.2 Queues (pg-boss)

| Queue | Payload | Taken by | Concurrency | Expiry / retry |
|---|---|---|---|---|
| `source-connect` (new) | `{userId, site}` | screen workers only | 1 per worker | 15 min, no retry (the user restarts it) |
| `ingest-source` (new) | `{userId, site}` | screen workers only | 1 per worker; `singletonKey = site:userId` | 30 min, no retry |
| `apply-handoff` (existing) | `{applicationId}` | screen workers only | `APPLY_CONCURRENCY`, but one Naukri run per user at a time via `SubmitLock` | 1 h, no retry (the runner retries) |
| `apply-person` (existing) | `{applicationId, person: true}` | screen workers only | as today | as today |
| cron `source-ingest-tick` (new) | `{}` | any worker | — | `SOURCE_INGEST_CRON`, default `0 */8 * * *` UTC; enqueues one `ingest-source` per eligible connection |

`queueFor("naukri")` returns `apply-handoff` (`SCREEN_BOARDS = [...HANDOFF_BOARDS, "naukri"]`). `HANDOFF_BOARDS` itself is unchanged: on Naukri the worker presses Apply (as Ashby's `window` mode); only a check hands the window to the person.

### 4.3 Data model (Prisma additions)

```prisma
model SiteConnection {
  id           String    @id @default(cuid())
  userId       String
  site         String    // naukri | linkedin
  status       String    // connecting | connected | needs_signin | limited | failed | disconnected
  stateKey     String?   // browser-state/<userId>/<site>.json in FileBlob; null unless connected/needs_signin/limited
  accountLabel String?   // the first name Naukri shows in its header ("Connected as …"); nothing else is kept
  consentAt    DateTime  // the account-risk notice accepted
  connectedAt  DateTime?
  lastUsedAt   DateTime? // last run that opened the session
  lastIngestAt DateTime?
  pausedUntil  DateTime? // limited: no run for this user+site until then
  lastError    String?   // a sentence for the UI (lib/explain.ts), never page text
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, site])
}

// One per-user ingest run of a signed-in source (mirrors IngestRun).
model SourceRun {
  id         String    @id @default(cuid())
  userId     String
  site       String
  startedAt  DateTime  @default(now())
  finishedAt DateTime?
  searches   Int       @default(0)
  pages      Int       @default(0)
  listed     Int       @default(0)
  created    Int       @default(0)
  updated    Int       @default(0)
  details    Int       @default(0)
  stopReason String?   // done | budget | needs_signin | challenge | refused | error
  error      String?
  @@index([userId, site, startedAt])
}

model WorkerBeat { … hasScreen Boolean @default(false) }   // the web app knows whether a window can be opened

model Job { … applyVia String? }  // naukri | greenhouse | lever | ashby | keka — which adapter applies; null = the source's own
model Company { … }               // unchanged: source "naukri", slug = String(groupId ?? companyId), active = false, addedBy = "naukri"
```

`Job.raw` for Naukri keeps the listing fields we use (`jobId`, `companyApplyJob`, `applyRedirectUrl`, `questionnaireIdPresent`, `mode`, `wfhType`, `salaryDetail.label`, `tagsAndSkills`), nothing from the user's account. `Job.questions` (existing, T56) caches Naukri's chat questions per job once a run has read them.

The saved browser state is a `FileBlob` with `userId` set, key `browser-state/<userId>/naukri.json`, content type `application/octet-stream`, encrypted (§4.9). The existing `browser-state/<userId>.json` (ATS cookie jar) stays separate.

### 4.4 Connection state machine

```
                 Connect (consent)                 sign-in seen in window
  disconnected ───────────────────▶ connecting ───────────────────────────▶ connected
       ▲                               │ window closed / 10 min                 │
       │                               ▼                                        │ run sees sign-in page / users/self 401
       │                             failed ──Connect again──▶ connecting        ▼
       │                                                                  needs_signin ──Connect again──▶ connecting
       │                                                                        │
       │          Disconnect (from any state): blob deleted, queued Naukri       │ run meets a check / Access Denied
       └──────── applications cancelled ◀───────────────────────────── limited (pausedUntil) ──timer──▶ connected
```

Transitions are made only in `modules/sources/connection.ts` (`setStatus(userId, site, status, patch)`). A connection change is not an application event: it is recorded on `SiteConnection` (`status`, `lastError`, timestamps) and on the `SourceRun` that caused it. When it stops an application, that application gets its own `block` or `error` event with the rule name, which is what the governance page shows.

### 4.5 Sequence: Connect (K1)

```
User           Web (/account)        API                  pg-boss        Screen worker              Chrome window        Naukri
 │ tap Connect ───▶ sheet: notice     │                     │               │                           │                   │
 │ tick "I understand", Open sign-in ─▶ POST connect        │               │                           │                   │
 │                   │           upsert SiteConnection{connecting, consentAt}                            │                   │
 │                   │           send source-connect ─────▶ │ ───────────▶ handler sourceConnect        │                   │
 │                   │◀─ 202 {status: connecting}           │               │ openBrowser(login, uid, {window, site, fresh}) │
 │                   │ poll GET /api/sources every 5 s      │               │ ────────────────────────▶ open nlogin/login ──▶│
 │                   │                                      │               │ push "Sign in to Naukri in the window"          │
 │ signs in (password / OTP / Google) in the window ──────────────────────────────────────────────────▶ │ ────────────────▶ │
 │                   │                                      │               │ waits ≤10 min for: page's own users/self → 200  │
 │                   │                                      │               │   or header shows the account name              │
 │                   │                                      │               │ storageState() → filter naukri.com → encrypt → storage.put(stateKey)
 │                   │                                      │               │ setStatus(connected, {accountLabel, connectedAt}); close window
 │                   │◀─ GET /api/sources → connected, "Connected as Dhanush"                             │                   │
 │ optional: tap "Fetch my Naukri jobs now" ──▶ POST ingest (rateLimit 1/3h) ──▶ send ingest-source      │                   │
```

Details:
- The connect context starts **fresh** (no saved state) so a stale session never masks a failed sign-in.
- "Signed in" is detected from the page's own request to `cloudgateway-mynaukri/…/users/self` answering 200 (a `page.waitForResponse` predicate on the URL path; the body is read only for the first name) or the header's account name. The worker never reads the login form, never types, never reads an OTP box.
- The sheet is disabled with "Start the worker on your computer first" when no `WorkerBeat{hasScreen: true}` beat in the last 5 minutes.
- Test profiles get 403 `test_profile_mock_only` on connect.

### 4.6 Sequence: per-user ingest (K2)

```
cron tick ──▶ for each SiteConnection{status: connected, pausedUntil < now, runs today < runs_per_day}: send ingest-source {userId, site}
                                                                                 (singletonKey site:userId)

Screen worker: handler sourceIngest({userId, site: "naukri"})
  1. SourceRun created; rules.signed_in_sources.naukri loaded
  2. openBrowser("https://www.naukri.com/", userId, {window: true, site: "naukri"})      ← saved state restored
  3. signed in?  no → setStatus(needs_signin), push, stopReason needs_signin, close
  4. searches = planSearches(profile, answers)  (≤ searches_per_run)
       keyword: each track's search phrase (functions.ts) and the current title; location: preferred_location answer else profile.city;
       experience: round(yearsExperience); jobAge=7; sort=f (newest)   e.g. /backend-developer-jobs-in-bengaluru?experience=2&jobAge=7&sort=f
       plus, when the plan has room, the account's own /mnjuser/recommendedjobs page (already tuned to the profile)
  5. for each search, for page 1..pages_per_search:
       readSearch(page, url) → the JSON of the page's own /jobapi/v3/search response (page.goto + waitForResponse)
       pause seconds_between_pages
       page shows a check / Access Denied / sign-in → stop (§4.8); fewer than 20 results → next search
  6. listings → fetchers/naukri.ts normalise → FetchedJob[] with applyKind; drop applyKind = none
  7. readJob() for new applyKind=naukri jobs that are India-eligible, tech, within INGEST_DAYS, ≤ details_per_run, pause between each
  8. upsert Company rows (source naukri, active false); ingestCompany-style write per company: createMany new, rewrite changed (contentHash), embedPendingJobs
  9. SourceRun finished {counts, stopReason}; SiteConnection.lastIngestAt; close window (state saved back)
 10. warmFeeds() for this user (new-match push as today)
```

Normalisation (`modules/jobs/fetchers/naukri.ts`, pure, offline-testable):

| `FetchedJob` field | From |
|---|---|
| `externalId` | `jobId` |
| `title` | `title` |
| `location` | the `location` placeholder ("Hyderabad, Chennai, Bengaluru") |
| `offices` | detail `locations[].label` when fetched |
| `description` | detail description as `plainText`, else the snippet; always appended: `Key skills: <tagsAndSkills>` and `Experience: <min>-<max> years` so tagging and `terms` see them |
| `applyUrl` | `https://www.naukri.com<jdURL>` for `applyKind = naukri`; `applyRedirectUrl` for `applyVia = <board>` |
| `postedAt` | `createdDate` (ms, UTC) |
| `isRemote` | `wfhType === "2"` |
| `raw` | the listing fields listed in §4.3 |

`applyKind` (decided in the normaliser, stored as `Job.applyVia`):
- `companyApplyJob === false` → `naukri` (Naukri's own Apply; `applyVia = null`).
- `companyApplyJob === true` and `applyRedirectUrl` host matches a board's `formHost` in `boards.ts` (Greenhouse, Lever, Ashby, Keka) → stored with `source = naukri`, `applyVia = <board>`, `applyUrl = applyRedirectUrl`; the feed's `roleKey` dedupe folds it with the same role from our own ingest of that company.
- anything else (Workday, Darwinbox, careers pages) → `none`, **not stored**. The feed never offers a job the agent cannot apply to.

Closing: a user's search is not the company's board, so `markClosed` is not called. A Naukri job unseen by any run for 14 days gets `closedAt` (a sweep at the end of each run); a run that sees it again reopens it; the adapter closes a job whose page says it expired. The existing 30-day delete of closed, unswiped jobs applies.

Feed: `applyBoardsFor(userId)` = `APPLY_BOARDS` plus `naukri` when `ENABLE_NAUKRI=1` and the user's connection is `connected`, `needs_signin` or `limited` (they still see their cards; a swipe is refused with the reason). `listFeed`, `boardSupported`, the board filter chips and the runner read it. Cards: `CompanyMark` from `Company.logoUrl` (`img.naukimg.com`, https, no referrer), `boardLabel("naukri") = "Naukri"`, same tiers, same "Why your agent picked it".

### 4.7 Sequence: apply (K4)

```
User swipes right on a Naukri card
  lifecycle.swipeRight: existing rules + source_connected + source_paused + max_applies_per_day_naukri → Application{queued}
  enqueueApply → queueFor("naukri") = apply-handoff

Screen worker: runner.execute(applicationId)
  boardSupported (applyBoardsFor), formUrlAllowed (boards.ts formHost naukri.com), check('start'), isTest guard   ← as today
  + connection connected?  no → block source_not_connected / source_needs_signin / source_paused (with pausedUntil)
  + min_minutes_between_applies_naukri since the user's last Naukri submit_attempt? no → re-enqueue with delay (not an attempt)
  + take SubmitLock(userId) for the whole run (one Naukri run per user at a time)
  "Ask before the run": Job.questions cached from an earlier run of this job → resolveForm → missing → needs_input before any window
  openBrowser(formUrl, userId, {window: true, site: "naukri"})           ← the user's Naukri session, visible
  adapter.inspect(page): page state → signed out | expired | already applied | ready
  markAttempted(); adapter.submit(page): press Apply, watch the page and the page's own apply request
     ├─ applied at once            → SubmitResult{confirmed, evidence} → submitted, sent-<n>.jpg
     ├─ chat drawer                → step loop (below)
     ├─ already applied (after our attempt) → submitted (Naukri recorded the click)
     ├─ redirect to company site   → NotSentError  → failed "applies on the company's site"
     ├─ check (CAPTCHA/OTP/verify) → window handed to the person (announceHandoff, 15 min); setStatus(limited, pausedUntil)
     └─ Access Denied / block page → RefusedError → failed; setStatus(limited, pausedUntil)
  finally: screenshot on failure, state saved back, window closed, lock released
```

**Step loop** (a small, general extension of the runner; LinkedIn Easy Apply uses it in K5):

```ts
// adapter.ts
export interface AtsAdapter {
  …
  /** The form is a dialog that shows one step (one or a few questions) at a time, only after Submit/Apply is pressed. */
  stepwise?: boolean;
  /** stepwise: the questions on screen now (inspect), then advance() after they are filled: true = another step, false = done. */
  advance?(page: Page): Promise<boolean>;
}
```
Runner, when `adapter.stepwise`:
```
press Apply (markAttempted first)
for step in 1..MAX_STEPS (12):
  fields = adapter.inspect(page)                 // the current question(s): label, kind (text | choice | multi | date | number), options, required
  record fields into Job.questions (merge by label) and the application's fields-seen list
  resolved = resolveForm({fields, …})            // bank → matched → derived → default; sensitive never AI; ai_draft only free text, within cap
  if resolved.pending non-empty:                  // a question we cannot answer
      close the window (never hold it), status needs_input, pendingQuestions, push "Needs you"; return
  adapter.fill(page, resolved.values)            // type / pick chips / set date; Naukri's own "Save"/"Send" per step
  if !(await adapter.advance(page)): break
evidence = adapter.confirmation(page) or the captured apply response → submitted
```
Re-run after an answer: the runner is stateless, so it opens the job again and presses Apply again. Naukri either shows the drawer again (now answered from the bank) or says "already applied", which **after our own `submit_attempt`** counts as sent (the application page's story says "Naukri had already recorded it"). K4's first real run records which of the two Naukri does and §6.20 states it.

**Evidence of sending.** The page's own request to Naukri's apply service (under `/cloudgateway-apply/apply-services/…`; the exact operation is recorded in K4 recon) answering 2xx with the applied state, plus the page's "applied" state; the same rule as Ashby's `ApiSubmitSingleApplicationFormAction`. Before `markAttempted` the old retry rules apply; after it, `decideAfterError` is unchanged: a `NotSentError` fails, anything unknown becomes `pending_verification`.

### 4.8 Checks, refusals and pace

| Naukri shows | During | We do | Status |
|---|---|---|---|
| Sign-in page / `users/self` 401 | any | stop; `needs_signin`; push "Sign in to Naukri again from Account" | ingest `stopReason needs_signin`; application `failed` with that sentence (Retry after reconnect) |
| CAPTCHA, OTP box, "verify it's you", "unusual activity" | apply | window stays open and goes to the person (15 min); `limited`, `pausedUntil = now + pause_hours_after_challenge`; push | per handoff outcome |
| same | ingest | stop at once, close; `limited` + pause; push | `stopReason challenge` |
| "Access Denied" / Akamai block page | any | stop; `limited` + pause; push "Naukri refused automated use for now; paused for a day" | `refused` / `failed` |
| "This job has expired" | apply | `Job.closedAt`; failed "no longer open" (as other boards) | `failed` |
| "You have already applied" before our attempt | apply | `blocked already_applied_on_site` | `blocked` |

Pace and caps (`config/rules.json`, validated by `rules.ts`, every stop an event):
```json
"signed_in_sources": {
  "naukri": {
    "searches_per_run": 3, "pages_per_search": 3, "details_per_run": 40, "seconds_between_pages": 4,
    "runs_per_day": 2, "max_applies_per_day": 30, "min_minutes_between_applies": 1, "pause_hours_after_challenge": 24
  }
}
```
New rule names (each a `block` event when it refuses): `source_not_connected`, `source_needs_signin`, `source_paused`, `max_applies_per_day_naukri`, `min_minutes_between_applies_naukri`, `already_applied_on_site`. `lib/rule-text.ts` gets their sentences for the governance page. Numbers chosen by the owner on 3 Nov (30 a day, a minute apart); the general daily cap still applies on top. If the first week on the owner's account meets any check, the first move is halving these, not a code change.

### 4.9 Security and privacy

- **Credentials.** Never seen, typed, stored or logged. The sign-in happens in Chrome; the worker only waits for the signed-in state.
- **The saved session is a credential.** Per site, filtered to `naukri.com` cookies and origins before saving (`browser.ts saveState(site)`), encrypted with AES-256-GCM (node:crypto) under `BROWSER_STATE_KEY` (32 bytes, base64; the worker refuses to connect or run a signed-in source without it), stored through `storage.put` with the user's id. Never in logs, never in `/api/account/export`, deleted on Disconnect and with the account (existing `deleteForUser`). The ATS jar (`browser-state/<userId>.json`) is never loaded into a Naukri context and vice versa.
- **What we read from the account.** Job listings, the user's own first name (`accountLabel`), and the user's own recommended-jobs page. Never other profiles, contacts or messages. `Job.raw` holds listing fields only.
- **Hosts.** The worker opens `www.naukri.com` only for Naukri jobs (`boards.ts formHost`, `urls.ts`), https only; a company-site job carries `applyVia` and is opened only on that board's host.
- **Multi-user.** Every route scopes by `userId`; one `SiteConnection` per user and site; one Naukri run per user at a time; a user's cap never spends another user's.
- **Test profiles** cannot connect a site; the mock-only rule is untouched.
- **Logging.** Run logs carry counts, rule names and status words; no page text, no cookie values, no job seeker data beyond what every board already logs.

### 4.10 Failure handling

| Failure | Handling |
|---|---|
| Worker dies mid-run | Reaper as today: a run cut off before `submit_attempt` is queued again; after it → `pending_verification`. The window dies with the process; state saved at the last close stays |
| No screen worker alive | `ingest-source` jobs expire (30 min) and are re-created by the next tick; applications wait on `apply-handoff` and are failed by the reaper after `PERSON_WAIT_HOURS` (as handoffs); the Account row says "Start the worker on your computer" |
| `BROWSER_STATE_KEY` missing or changed | Decrypt fails → `needs_signin` with "Sign in again"; nothing is guessed |
| Naukri changes its page or JSON | The normaliser's Zod schema fails closed (listing skipped, counted in `SourceRun.error`); the adapter's offline fixture test (`scripts/naukri-adapter-test.ts`) fails before users do; failures leave `fail-<n>.jpg` and the page's error lines |
| Two runs of one user at once | Impossible by construction: `singletonKey` for ingest, `SubmitLock` for apply |
| Budget reached | `stopReason budget`, a `budget` event, the rest waits for the next run |

### 4.11 Observability

- `SourceRun` rows per user and site; `/api/health` adds the last source run and whether a screen worker beat (`hasScreen`) in 5 minutes.
- `scripts/feed-report.ts` gains Naukri counts (jobs stored, per user new matches, applies per day) beside the board numbers.
- Application pages tell the agent's story in words (`lib/explain.ts`, `lib/steps.ts`): "Opened the job in your Naukri window", "Naukri asked 3 questions", "Naukri asked for a check: it's in your window", "Naukri paused automated use for a day".
- Governance page: the new rules' sentences and their blocks.

### 4.12 Code map

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma` (`SiteConnection`, `SourceRun`, `WorkerBeat.hasScreen`, `Job.applyVia`); one migration applied with `migrate deploy` only (never a shadow of the real DB) |
| Rules | `config/rules.json` `signed_in_sources`; `modules/governance/rules.ts` (schema, the new `swipe_right`/`start` checks); `lib/rule-text.ts` |
| Browser | `modules/apply/browser.ts`: `openBrowser(url, owner, {window, handoff, site, fresh})`, `stateKeyFor(owner, site)`, cookie filter per site, AES-GCM encrypt/decrypt |
| Sources | `modules/sources/{index,connection,connect}.ts`; `app/api/sources/route.ts` (GET), `app/api/sources/[site]/{connect,disconnect,ingest}/route.ts`; `worker/handlers/{sourceConnect,sourceIngest,sourceIngestTick}.ts`; `lib/queue.ts` (`SOURCE_CONNECT_QUEUE`, `INGEST_SOURCE_QUEUE`, `enqueueConnect`, `enqueueSourceIngest`, `SCREEN_BOARDS`, `queueFor`); `worker/index.ts` (screen-only queues, `hasScreen` on the beat); `worker/schedule.ts` (`SOURCE_INGEST_CRON`) |
| Ingest | `modules/apply/sites/naukri.ts` (`readSearch`, `readJob`, `signedIn`, `pageState`: the only Playwright code for reading); `modules/jobs/fetchers/naukri.ts` (JSON → `FetchedJob`, `applyKind`, no Playwright); `modules/jobs/boards.ts` (`naukri` entry: `perUser: true`, `label`, `formHost /^(www\.)?naukri\.com$/`, no `fetch`, no discovery); `modules/jobs/ingest.ts` (`ingestForUser`, the 14-day close); `modules/jobs/match.ts` (`applyBoardsFor`); `lib/board-label.ts` |
| Apply | `modules/apply/adapters/naukri.ts`; `modules/apply/adapter.ts` (`stepwise`, `advance`); `modules/apply/runner.ts` (connection checks, pace check, step loop); `modules/apply/pick.ts`; `modules/apply/lifecycle.ts` (`swipeRight` rules) |
| UI | `app/(app)/account/connected-sites.tsx` (SectionCard, rows, Sheet with the notice, states), `account/page.tsx`; feed chip and filter (`boardLabel`); `lib/explain.ts`, `lib/steps.ts` |
| Checks | `scripts/naukri-listing-test.ts`, `scripts/naukri-adapter-test.ts` (fixtures in `tests/fixtures/naukri/`), `scripts/naukri-connect-smoke.ts`, `scripts/naukri-ingest-smoke.ts`, `scripts/naukri-dry-run.ts`, `scripts/rules-test.ts` additions |

Module interfaces (the contracts the three tasks build to):
```ts
// modules/sources/index.ts
export type Site = "naukri" | "linkedin";
export type ConnectionStatus = "connecting" | "connected" | "needs_signin" | "limited" | "failed" | "disconnected";
export function getConnection(userId: string, site: Site): Promise<SiteConnection | null>;
export function startConnect(userId: string, site: Site): Promise<{ ok: true } | { ok: false; reason: "test_profile" | "no_screen_worker" | "already_connecting" }>;
export function disconnect(userId: string, site: Site): Promise<void>;          // blob deleted, apps cancelled
export function setStatus(userId: string, site: Site, status: ConnectionStatus, patch?: Partial<SiteConnection>): Promise<void>;
export function waitForSignIn(page: Page, site: Site, timeoutMs: number): Promise<{ accountLabel: string | null } | null>;  // worker only

// modules/apply/sites/naukri.ts  (worker only)
export function searchUrl(q: { keyword: string; location: string; experience?: number; jobAge?: number; page?: number }): string;
export function readSearch(page: Page, url: string): Promise<unknown>;        // the page's own /jobapi/v3/search JSON
export function readJob(page: Page, url: string): Promise<unknown>;           // the page's own /jobapi/v4/job JSON
export function pageState(page: Page): Promise<"signed_out" | "check" | "refused" | "expired" | "already_applied" | "ready">;

// modules/jobs/fetchers/naukri.ts  (pure)
export type ApplyKind = "naukri" | "greenhouse" | "lever" | "ashby" | "keka" | "none";
export function fromSearch(json: unknown): Array<FetchedJob & { applyKind: ApplyKind; company: { slug: string; name: string; logoUrl: string | null } }>;
export function withDetail(job: FetchedJob, json: unknown): FetchedJob;

// modules/jobs/ingest.ts
export function ingestForUser(userId: string, site: Site, days: number): Promise<SourceRun>;
export function applyBoardsFor(userId: string): Promise<readonly string[]>;   // match.ts
```

### 4.13 Env (ARCHITECTURE §11 additions)

```
BROWSER_STATE_KEY=                # base64, 32 bytes; required to connect or run any signed-in source
SOURCE_INGEST_CRON=0 */8 * * *    # per-user ingest tick (UTC)
ENABLE_NAUKRI=                    # 1: Naukri in applyBoardsFor for connected users; unset: ingested hidden until K4's real submit
```

---

## 5. UI

- **Account → "Connected job sites"** (SectionCard, rows as the design's Row): Naukri row with `CompanyMark` initials "N", status words — "Not connected" + Connect; "Connected as Dhanush · last fetched 2 h ago" + Fetch now + Disconnect; "Sign in again" (lime "Needs you" treatment) + Connect; "Paused until tomorrow 09:00" with the reason; "Connecting… check the Chrome window" with the agent-status disc.
- **Connect sheet** (the design's Sheet): the notice below, a check row, primary "Open Naukri sign-in", quiet "Not now". Disabled state: "Start the worker on your computer first".
- **Feed:** "via Naukri" chip; "Naukri" in the board filter only for connected users; nothing else changes on the card.
- **Application page:** Naukri's questions listed with source badges and basis; the new sentences for checks and pauses.
- Every new screen state has loading, empty and error forms; ink and lime only; no new primitives expected.

Notice copy (agent voice):
> Your agent will use your Naukri account to find jobs for you and to apply when you swipe right. It reads job listings and your own profile only, never other people's profiles or messages. It applies one job at a time, at a person's pace, and stops the moment Naukri asks for a check. Naukri's terms do not allow automated use, and Naukri may limit or suspend accounts it finds automated. You sign in yourself in a window on your computer; we never see your password or OTP. Disconnect at any time: it deletes the saved sign-in.

---

## 6. API

| Route | Auth | Body / query | Answer |
|---|---|---|---|
| `GET /api/sources` | user | — | `{ sites: [{ site, status, accountLabel, connectedAt, lastIngestAt, pausedUntil, lastError, canConnect, screenWorkerAlive }] }` |
| `POST /api/sources/:site/connect` | user, not test profile | `{ consent: true }` | 202 `{status: "connecting"}`; 403 `test_profile_mock_only`; 409 `no_screen_worker` / `already_connecting` |
| `POST /api/sources/:site/disconnect` | user | — | 200 `{status: "disconnected", cancelled: n}` |
| `POST /api/sources/:site/ingest` | user, connected | — | 202; 429 after 1 per 3 h (`rateLimit("source-ingest:" + userId)`) ; 409 when paused or not connected |
| `POST /api/swipes` | existing | existing | new 409 reasons `source_not_connected`, `source_needs_signin`, `source_paused` (card put back, toast says why) |
| `GET /api/health` | none | — | adds `screenWorker` (last beat with `hasScreen`) and `lastSourceRun` |

---

## 7. Testing

| Check | Kind | Proves |
|---|---|---|
| `scripts/naukri-listing-test.ts` | offline, fixtures captured 3 Nov (`tests/fixtures/naukri/search.json`, `job.json`) | normalisation, `applyKind` for a Naukri job, a Greenhouse-redirect job, a Workday-redirect job; tags: India, experience 1–3, remote from `wfhType`; PASS line |
| `scripts/naukri-adapter-test.ts` | offline, HTML fixtures of the drawer, applied, already applied, expired, signed-out, Access Denied | `pageState`, question parsing (text, chips, multi, date), confirmation detection |
| `scripts/rules-test.ts` (extended) | offline | the new rules refuse and pass as specified, each writing an event |
| `scripts/naukri-connect-smoke.ts` | needs a screen and the owner | connect without typing in our app; a worker restart keeps the session; Disconnect deletes the blob and cancels queued Naukri apps; a test profile is refused |
| `scripts/naukri-ingest-smoke.ts` | needs a screen and the owner | one budgeted run: jobs stored, in the owner's feed with tiers and "via Naukri", budget stop with event, a non-connected user sees none |
| `scripts/naukri-dry-run.ts` | needs a screen and the owner | 3 real jobs: opens signed in, reaches Apply, presses nothing, reports what it would ask |
| Real submit | the owner, a job they want (demo rule) | `submitted` with Naukri's confirmation and screenshot; a question through "Needs you" asked once; the "already applied after our click" behaviour recorded |
| `npm run typecheck && npm run lint`, `scripts/security-test.ts` | always | routes scoped by user; no blob in export |

---

## 8. Rollout

1. K1 lands behind nothing visible but the Account card; no feed change until `ENABLE_NAUKRI=1`.
2. K2 ingests hidden (INGEST_CONTRACT: a new board is hidden until one real submit).
3. K4: real submit by the owner → `ENABLE_NAUKRI=1` on the owner's worker and web → Naukri in `applyBoardsFor` for connected users.
4. Numbers reviewed after a week of the owner's runs (applies per day, checks seen, Access Denied count) before any other user connects; a check in that week halves the caps first.
5. Demo path (PRD §10) is untouched throughout: nothing here runs for Greenhouse jobs.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Naukri limits or suspends the user's account | Said plainly at Connect and accepted; visible real Chrome, own session, a minute between applies, 30 a day, pause on any check; never stealth, proxies or minted headers. The caps are the first thing lowered if a check appears |
| Naukri records the apply on the click, before its questions | `markAttempted` before the click; "already applied" after our attempt = sent; questions cached per job so later users are asked first |
| Drawer or JSON changes | Zod fails closed; fixtures and offline tests; screenshots on failure |
| Only the laptop has a screen | Naukri waits, never runs headless; always-on needs a VM with a display (DEPLOY.md "Docker worker with a screen") |
| Saved session leaks | Per-site, cookies-only, AES-GCM, never exported or logged, deleted on Disconnect |
| Duplicates with our own ATS ingest | `applyVia` + `roleKey` fold; other company-site jobs not stored |
| Wrong searches → empty Naukri feed | Searches come from tracks and preferred locations the user confirmed; the recommended-jobs page is a fallback search; "Fetch now" shows counts |

---

## 10. Tasks

In [TASKS.md](TASKS.md) beside this file: K1, K2, K4 and K4b with their Do, Done-when and the sections of this design each one builds; K3 and K5 (LinkedIn) until their own design exists. Root `docs/TASKS.md` Phase K lists them one line each. Order K1 → K2 → K4, one session each, plan first, check pasted, typecheck and lint.

---

## 11. Decisions closed with the owner (3 Nov)

1. **Who presses Apply:** the worker, in the visible window (as Ashby auto-submit). If the first 10 real applies meet any check, Naukri joins `HANDOFF_BOARDS` (a person presses) with no other change.
2. **Starting numbers:** 30 applies/day on Naukri, 1 minute apart, 2 ingest runs/day of 3 searches × 3 pages (§4.8). Lowered first if checks appear.
3. **Job rows are shared** between connected users; a user without a connection never sees them.
4. **Mock Naukri drawer** (`/mock/naukri`): later, as K4b after K4's real submit; it will change the hard rule from `/mock/greenhouse` to `/mock/*` in CLAUDE.md and PRD §9 when it comes.

No open questions remain for K1–K4.

---

## 12. Research notes and sources

- **Seen in the browser, 3 Nov 2026:** `naukri.com/software-engineer-jobs-in-bengaluru?experience=2` rendered; the page's `GET /jobapi/v3/search?noOfResults=20&…&pageNo=1&experience=2&…` answered 200 with `{noOfJobs, clusters, jobDetails[]}`; a `fetch` of `/jobapi/v4/job/<id>` from the page without the page's own header answered 406 `{"message":"recaptcha required"}`; the job page's own `GET /jobapi/v4/job/301026011205` answered 200 with the posting (`loggedIn:false`, `hideApplyButton`, `applyCount`, `locations`, `keySkills`, `salaryDetail`, `wfhType`, `consultant`, `createdDate`); the job page shows one "Apply" button and links Naukri's "Neo AI job agent" (`/job-apply-agent`); a Cisco listing had `companyApplyJob:true`, `mode:"crawled"`, `applyRedirectUrl` on `cisco.wd5.myworkdayjobs.com`. Terms at `naukri.com/termsconditions`: "Use automated means to crawl and/or scrape content from Naukri.com" (prohibited); "The Site uses technological means to exclude Robots etc. from crawling it and scraping content. You undertake not to circumvent these methods."
- **webcmd:** `webcmd.dev`; `github.com/agentrhq/webcmd` (Apache-2.0; "Profiles are cookie jars; Sessions are independent browser windows"; Webcmd Cloud "not yet stable"); `github.com/agentrhq/webcmd-plugins` (omnisearch, pypi, skyscanner); local `webcmd doctor` (runtime "cloak", CloakBrowser 0.4.5, "stealth Chromium for automation … newest anti-bot patches"); `webcmd plugin search naukri|linkedin` → `[]` with the catalog manifest HTTP 404; the webcmd-usage, webcmd-browser (QuickJS, not Node) and webcmd-adapter-author skills (INTERCEPT fixes "roughly 7-8x as frequent as PUBLIC_API fixes").
- **Naukri access and bots:** `github.com/strelov1/freehire/pull/3261` and `/pull/3290` (406 "recaptcha required" with a browser UA, 403 "Access Denied" otherwise, Akamai blocks datacenter IPs, page cap 150); `github.com/Traverser25/NopeRi` (`nkparam` required, sessions IP-bound, Azure/CI blocked, home broadband works); `github.com/jiyaa8800/naukri-auto-apply-bot` (direct apply, chat apply, multi-step forms; CAPTCHA and OTP "never solved or bypassed"; "Automating Naukri may violate its Terms of Service"); `github.com/pattjoshi/playwright-python-job-search/pull/16` (automated browser → "Access Denied"); `agentco.in/blog/auto-apply-naukri-jobs` ("Twenty applications a night at human pacing is defensible", "two hundred in an hour is a bot signature"); `jobspipe.dev/blog/naukri-api` (no public Naukri API).
