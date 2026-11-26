# Naukri through the user's own account — technical design (Phase K: K1, K2, K4)

Version 3, 7 Nov 2026 (§13: a million users, the user's own session run from our cloud, decided 23 Nov; version 2, 3 Nov). Owner's decision of 29 Oct: Naukri and LinkedIn come in through the user's own signed-in account, after Phase J (ARCHITECTURE §6.20, PRD FR10, CLAUDE.md hard rules). This is the full design for the Naukri half. LinkedIn (K3, K5) reuses the same connection, ingest and stepwise-apply shape. ARCHITECTURE stays the source of truth: K1 copies the decisions here into §6.20 when it lands.

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
| Sources | `modules/sources/{index,sites,connection}.ts` (no browser); the sign-in wait and the connect run are Playwright, so they live in `modules/apply/sites/{naukri,connect}.ts` (CLAUDE.md: Playwright only under `modules/apply`; corrected in K1); `app/api/sources/route.ts` (GET), `app/api/sources/[site]/{connect,disconnect}/route.ts` (K1), `[site]/ingest/route.ts` (K2); `worker/handlers/{sourceConnect,sourceIngest,sourceIngestTick}.ts`; `lib/queue.ts` (`SOURCE_CONNECT_QUEUE`, `INGEST_SOURCE_QUEUE`, `enqueueConnect`, `enqueueSourceIngest`, `SCREEN_BOARDS`, `queueFor`); `worker/index.ts` (screen-only queues, `hasScreen` on the beat); `worker/schedule.ts` (`SOURCE_INGEST_CRON`) |
| Ingest | `modules/apply/sites/naukri.ts` (`readSearch`, `readJob`, `onSignedInPage`, `pageStop`: the only Playwright code for reading) and `modules/apply/sites/ingest.ts` (`runSourceIngest`, the run; built there in K2 because it drives the window, CLAUDE.md); `modules/jobs/ingest.ts` keeps the database half (`storeSiteListings`, `storeJobs`); `modules/jobs/fetchers/naukri.ts` (JSON → `FetchedJob`, `applyKind`, no Playwright); `modules/jobs/boards.ts` (`naukri` entry: `perUser: true`, `label`, `formHost /^(www\.)?naukri\.com$/`, no `fetch`, no discovery); `modules/jobs/ingest.ts` (`ingestForUser`, the 14-day close); `modules/jobs/match.ts` (`applyBoardsFor`); `lib/board-label.ts` |
| Apply | built in K4 as: `modules/apply/sites/naukriChat.ts` (pure: page state, apply replies, the drawer's question), `modules/apply/sites/naukriApply.ts` (the window: `readJobPage`, `pressApply`, `answer`), `modules/apply/sites/gate.ts` (swipe and run checks, pace); `modules/apply/runner.ts` (`executeOnSite`: its own step loop instead of an `AtsAdapter` with `stepwise`/`advance`, which the drawer's one-question steps did not need); `modules/apply/lifecycle.ts` (`swipeRight` rules) |
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
| Naukri limits or suspends the user's account | Said plainly at Connect and accepted; the user's own session from a residential proxy of their own (owner, 23 Nov, §13.11), a minute between applies, 30 a day, pause on any check; never minted headers or solved CAPTCHAs. The caps are the first thing lowered if a check appears |
| Naukri records the apply on the click, before its questions | `markAttempted` before the click; "already applied" after our attempt = sent; questions cached per job so later users are asked first |
| Drawer or JSON changes | Zod fails closed; fixtures and offline tests; screenshots on failure |
| Only the laptop has a screen | Naukri waits, never runs headless; always-on needs a VM with a display (DEPLOY.md "Docker worker with a screen"); a million users: §13 (the myjobb way, decided 23 Nov) |
| Saved session leaks | Per-site, cookies-only, AES-GCM, never exported or logged, deleted on Disconnect |
| Duplicates with our own ATS ingest | `applyVia` + `roleKey` fold; other company-site jobs not stored |
| Wrong searches → empty Naukri feed | Searches come from tracks and preferred locations the user confirmed; the recommended-jobs page is a fallback search; "Fetch now" shows counts |

---

## 10. Tasks

In [TASKS.md](TASKS.md) beside this file: K1, K2, K4 and K4b with their Do, Done-when and the sections of this design each one builds; K3 and K5 (LinkedIn) until their own design exists; K6–K14 for a million users (§13: the user's own session run from our cloud, decided 23 Nov; the company ATS from our cloud for redirect jobs). Root `docs/TASKS.md` Phase K lists them one line each. Order K1 → K2 → K4, one session each, plan first, check pasted, typecheck and lint.

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
- **Many users on their own devices (7 Nov 2026, §13):** Browserbase plans from third-party summaries (Developer $20/month with 100 browser hours then $0.12/h and 1 GB proxy then $12/GB; Startup $99/month, $0.10/h, about $10/GB): `scrapegraphai.com/blog/browserbase-pricing`, `tinyfish.ai/blog/browserbase-pricing`; India residential proxies about $0.3–8/GB, sticky sessions up to 24 h or 7 days, mobile $10–30/GB: `dataimpulse.com/blog/residential-proxy-pricing-comparison/`, `geonode.com/proxies-by-location/india-proxy`, `soax.com/proxies/locations/india`, `databay.com/blog/how-much-do-residential-proxies-cost`. Not checked against the vendors' own pages; K6 measures page weight.

---

## 13. Naukri for a million users: the user's own session, run from our cloud (decided 23 Nov 2026)

Status: **decided by the owner on 23 Nov (§13.11): the myjobb way**, a connected session run from our cloud behind a residential proxy per user, connected on a phone through a streamed sign-in. §13.2–13.10 are the comparison written 7 Nov, kept as the record of what was weighed. Open questions in §13.15; tasks K6–K14 in [TASKS.md](TASKS.md#k6), after the job boards work.

### 13.1 The problem and the governing constraint

**Scale target (owner, 7 Nov): "a full on app … scale it to million\[s\] of users … not a single system."** Every option below is sized at 1,000,000 active users, and an option that does not survive that number is not chosen, however cheap it is for the first ten.

Today every Naukri window opens on the one worker with a screen (`canShowWindow()`, `WorkerBeat.hasScreen`, §4.1): the owner's laptop. A second user's sign-in window opens on the owner's screen; every account's traffic leaves from one home IP, so N accounts on one address look like an account farm to Akamai (fact 4, §2) and one "Access Denied" (§4.8) pauses everyone; one sleeping laptop stops all of them. It serves one user; it is kept for the owner, development and the mock, and nothing else.

Goals (7 Nov, revised 23 Nov): each user connects Naukri from their phone, signing in themselves; runs need no device of theirs to be on (owner, 23 Nov: users are mobile, no extensions); we never type, store, log or screenshot their password or OTP; the server stays the only source of truth for governance (`gate.ts swipeRefusal` and `runGate`, `check('submit')`, caps and pace from `config/rules.json`, a `source` on every value, an event for every check); the design holds at 1M users. Non-goals: minting Naukri's signature (§3 C), solving any CAPTCHA by code; LinkedIn (K3 and K5 would reuse what this builds).

### 13.2 Load: one user, one million users

| | One user a day | 1M users a day |
|---|---|---|
| Job runs | 2 × (3 searches × 3 pages = 9 search pages + up to 40 job pages) | 2M runs, 18M search pages, up to 80M job pages |
| Applies | up to 30, a minute apart; job page, Apply, 0–6 drawer questions | up to 30M |
| Naukri page loads | ~130 | ~130M |
| Browser time | 30–40 min (2 runs × 4–5 min, 30 applies × 45–60 s) | 30–40M browser-minutes = 0.5–0.67M browser-hours |
| If run server-side | — | **21–28k browsers busy around the clock**; ~40–55k at the Indian daytime peak |
| Page traffic (1.5–2 MB a load, assumed; K6 measures) | ~200 MB | ~200 TB |

The answering chain's LLM calls are the same in every option: at up to 30M applies a day and ~$0.0004 a call (`gpt-4o-mini`, ~2k tokens in), **$1–13k a day depending on how many questions the bank and `Job.questions` already answer**. It is priced once here and left out of the comparison; K11 measures the cache rate.

### 13.3 Option (a): a browser extension in the user's own Chrome

A Manifest V3 extension. It holds no rules and no answers: the server decides every step and the extension is the hands in the user's own browser (a device link, not built: §13.11).
- **Sign-in.** None of ours. Most users are already signed in to Naukri in their Chrome; if not, the extension opens naukri.com's own login page in a tab and the user signs in there as they always do. The extension reads only "signed in, first name" (the header, as `naukri.ts firstNameOf`); it has no content script on the login pages and never reads a password or OTP box.
- **Where the session lives.** In the user's own Chrome, nowhere else. We store no Naukri cookies (the K1 sealed blob, §4.9's largest risk, goes away); Disconnect revokes the device token.
- **IP and bot checks.** Each account runs from its own home or mobile connection, in genuine Chrome: the user's own fingerprint, history and sign-in, no `navigator.webdriver`. No IP concentration at any scale. Points K6 measures: the page's own search and apply replies are read through a read-only tap in the page's world (a wrapped `fetch`/XHR, which Akamai's script may notice; `chrome.debugger` would put a "started debugging this browser" bar on every window, so no); a content-script click is an untrusted event (`isTrusted: false`) which Naukri's Apply handler or Akamai's scoring may refuse; background windows are throttled; `captureVisibleTab` needs the tab visible.
- **At 1M users.** No browser compute on our side. Our side is the device API and the database: ~5k requests a second on average, ~15k at peak (polls paced by the server, ~8 calls an apply, ~50 reports a run); about 30–100 vCPU of stateless API, **~$3–8k a month**. Postgres takes ~30M device tasks, up to 300M application events (if ~10 an apply stays) and up to 360M listing sightings a day; that needs monthly partitions, coalesced "last seen" writes and fewer events per apply: a managed cluster of **~$5–20k a month**. Screenshots, 30M × ~150 KB = 4.5 TB a day, cannot live in `FileBlob`: the S3/R2 driver `lib/storage.ts` already plans, with 30-day expiry (~135 TB kept, **~$2–3k a month**). **Total ~$10–30k a month, ₹0.03–0.08 a user a day**, plus the LLM line in §13.2.
- **Naukri's checks when concentrated.** Not concentrated by IP, but one piece of software on a million accounts has one behaviour signature (the same clicks, timings and tap); Naukri can recognise and refuse all of it with one rule, and 30M applies a day is visible to its recruiters whatever the technique. No option survives Naukri deciding against it (§13.15 Q8).
- **Against.** Needs a computer with Chrome that is on: a right swipe on the phone is applied when that Chrome next runs. Store review and policy (no remotely hosted code; selectors served as data are allowed). Chrome-family only.

### 13.4 Option (b): cloud browsers with a live view, per-user egress IPs

Our worker drives a browser at a vendor (Browserbase, Steel, Hyperbrowser, Anchor) or on our own VMs, over CDP; for sign-in the web app embeds a live view of that browser in the Connect sheet.
- **Sign-in.** The user types password and OTP into a streamed page: every keystroke passes through the vendor and our page. "We never see it" becomes a policy, and the vendor's session recording must be off or the password is in a recording.
- **Where the session lives.** The vendor's persistent context or our sealed blob: a live credential for every user off their device; a breach is a million Naukri accounts.
- **IP and bot checks.** Vendor and cloud addresses are datacenter ranges, which Akamai refuses (fact 1). It works only behind a residential or "ISP" proxy per user, someone else's home line or a datacenter address registered to look like one: the evasion §3 option E rules out and Naukri's terms forbid. Rotating pools also break Naukri's IP-bound sessions (§12, NopeRi).
- **At 1M users.** Compute: 21–28k busy browsers (40–55k at peak). On our own VMs at ~8 headful contexts per 4 vCPU / 16 GB machine (~$0.17 an hour), 2.6–3.5k machines on average: **~$370k a month**; at a vendor, 0.5–0.67M browser-hours a day × $0.10: **~$1.5–2M a month**. Proxies: 200 TB a day × $0.5–4/GB (bulk to retail): **~$3–24M a month**, ₹8–65 a user a day. Per-user sticky IPs: a million Indian residential addresses held all day, from pools that advertise 2.5–15M India IPs in total, shared with every scraper and already scored by Akamai.
- **Naukri's checks when concentrated.** The worst of the three: a million accounts behind a few proxy vendors' ranges, from headless-class infrastructure; one rule blocks everyone, and the proxies make it look like evasion when it happens.
- **Reuse.** The most: ~95% (the Playwright layer as it is, `browser.ts` gains a CDP connect).
- **Verdict.** Does not survive 1M: **$3.5–26M a month**, and the part that makes it work is the part we ruled out. It is the only option that serves phone-only users.

### 13.5 Option (c): a desktop companion app

A tray app the user installs (Node with `playwright-core` and the installed Google Chrome, packaged and signed, or Electron): our screen worker cut down to one user, talking to the same device link as (a), never to Postgres.
- **Sign-in.** As today on the owner's laptop: a visible Chrome window on the user's own computer; `waitForSignIn` unchanged.
- **Where the session lives.** A Chrome profile folder on the user's disk, never uploaded.
- **IP and bot checks.** Their own connection. The browser is Playwright-launched Chrome (automation flags, `navigator.webdriver`), which works on one laptop today; clicks are trusted CDP input.
- **At 1M users.** Server side the same as (a), ~$10–30k a month. Plus signing (Windows ~$100–400 a year, Apple $99), updates pushed to a million installs, per-OS support.
- **Naukri's checks when concentrated.** A million accounts all driven by Playwright-launched Chrome share the most common automation fingerprint there is; Akamai's standard detection finds it without a rule written for us.
- **Reuse.** ~85%: `naukriApply.ts`, `naukriChat.ts`, `naukri.ts` run on the device as they are.
- **Verdict.** Survives on cost; weaker than (a) on detection and on getting installed by millions (an exe from an unknown publisher).

Also rejected: **the user's cookies carried to our cloud** (sessions are IP-bound, traffic back on our addresses, a million live credentials with us); **the screen worker on VMs with displays** (one address per VM for many users: the problem itself, then (b)'s costs).

### 13.6 Option (d): Naukri for discovery, apply on the company's own ATS from our cloud

The model Tsenta (tsenta.com) runs, from its own docs and help center (read 7 Nov): applications run in its cloud on the employer's own application system (about 60: Workday, Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters, Zoho Recruit and others), roles come from 50,000+ company career pages, job boards serve only to find a role, and it never signs in to a job board as the user (no LinkedIn Easy Apply; Naukri is not mentioned anywhere in its docs, help center, supported systems or extension sites). For us: a Naukri listing with `companyApplyJob: true` whose `applyRedirectUrl` is on a board we apply to is applied there, through that board's adapter, from our cloud (K4c), and the company behind it joins our ATS ingest, so its later jobs arrive from the board's public API with no Naukri read at all.
- **Sign-in.** None on Naukri for applying. Greenhouse, Lever, SmartRecruiters and Keka need no account. Workday, where many Indian MNC listings redirect (Cisco in our fixture), needs a candidate account per employer: Tsenta has the user set an "application password" and reads the OTP from the user's connected Gmail or Outlook. For us that is a new decision close to the hard rule that we never ask for, type or store a password (§13.15 Q10); Gmail read access is a Google restricted scope with a yearly third-party security assessment.
- **Where the session lives.** No Naukri session for applying. Workday accounts, if chosen: one encrypted credential per user and employer, with us.
- **IP and bot checks.** Naukri sees none of our applies. The ATSs see our cloud addresses, which they mostly accept today (Greenhouse from the Docker worker), and the load spreads over thousands of employers. Not free of checks: Ashby's automated Submit went through 1 time in 23, so Ashby is a handoff; Workday tenants can add bot checks. Discovery still reads Naukri listings, from users' own runs (K2 today; at scale the extension in read-only mode, 2 runs a day, no Apply); once a company is known its jobs come from the ATS, so Naukri reads grow with new companies, not with users.
- **At 1M users.** The cost is the cost of applying on ATS forms, which the product pays for every board anyway: if all 30M daily applies went to ATS forms at ~1.5 browser-minutes each, ~31k busy headless browsers, **~$0.4–0.6M a month** on our own machines (₹1.1–1.7 a user a day), with no proxies and no device. Lower in practice, since only redirect jobs come this way.
- **The limit.** It cannot apply to jobs that take only Naukri's own Apply (`mode: "jp"`, `companyApplyJob: false`): the jobs posted on Naukri itself, most consultancy and mid-size listings (2 of the 3 in our fixture; no real share measured yet, the database holds no Naukri runs; K6 measures it). Those jobs are what makes Naukri worth having; the redirect jobs are largely jobs we could ingest from the ATS ourselves. Redirects to systems we do not support (iCIMS, SuccessFactors, Taleo, company sites) stay out until there is an adapter.
- **Reuse.** The ATS adapters (Greenhouse, Lever, Ashby handoff, SmartRecruiters, Keka), `boards.ts adapterBoardOfHost`, `Job.applyVia`, `fetchers/workday.ts` (T99, discovery only), `fetchers/naukri.ts` for the redirect URLs, the runner as it is. New: K4c's routing, harvesting companies from redirect URLs into `Company` rows (K13), a Workday apply adapter (K12, the largest piece: account, multi-page wizard, per-tenant variation). `naukriApply.ts` and `naukriChat.ts` are not used.
- **Effort.** K4c 3–4 days; company harvest 2 days; Workday apply 10–15 days, after the account decision.
- **Verdict.** Survives 1M: it is how the rest of SwipeApply already scales, and it serves phone-only users. It does not replace (a) for Naukri's own jobs; it takes every job that has a company ATS off (a)'s load.

### 13.7 Option (e): extension for sign-in, cloud workers for runs

The model myjobb.ai (Infyn Technologies) describes in its privacy policy (myjobb.ai/privacy, read 7 Nov): the user connects each board in a Chrome extension ("I agree & connect"); the extension reads that board's cookies (for Naukri "every cookie currently set on naukri.com", for Foundit, Hirist, IIM Jobs and Instahyre a named list) and sends them to its API, where they are stored "encrypted at rest using AES-256"; cloud workers keep the sessions warm and apply, daily at 6 AM IST, pausing to ask when unsure. It claims 1M users and 400K applications, but the extension has about 2,000 Web Store installs, so the signed-in-board path serves a small part of that number; the claim is no evidence that this path works at 1M. For us: a one-button extension replaces K1's sign-in window, and the K2 and K4 runs move from the screen worker to cloud workers.
- **Sign-in.** The user signs in on naukri.com in their own Chrome; we never see the password or OTP. It fits the letter of the hard rule. The extension needs the `cookies` permission for naukri.com, which reads the HttpOnly session cookies the page itself cannot.
- **Where the session lives.** Copied to us: sealed in `FileBlob` as K1 already does (`lib/sealed.ts`, `browser.ts onlySite`). K1 already treats the saved session as a credential (§4.9); the difference is scale and use. At 1M users we hold a million live Naukri sessions, so a breach is a million account takeovers, and the sessions are used from somewhere the user never was.
- **Session lifetime and keep-warm.** Naukri's sessions are tied to the address they were made on (§12, NopeRi). A cookie made on the user's home line and replayed from our cloud is either refused or answered with an OTP check the user cannot see. "Keep warm" means requests made only to stop a session expiring, the least human traffic there is. When a session dies, the extension can quietly upload fresh cookies on the user's next Naukri visit; that comes close to the silent re-login ARCHITECTURE §6.20 forbids ("an expired session puts the source in `needs_signin`"). Without it, every user is regularly back in `needs_signin`.
- **IP and bot checks at 1M users.** The runs are (b)'s runs: cloud addresses, which Akamai refuses (fact 1), so it works only behind a residential proxy per user, the evasion §3 option E rules out. Naukri sees every account's session hop from a home line to a proxy address and back: the signature of a stolen session, which account-security systems lock first. The risk lands on the users' accounts. myjobb's guide notes Naukri's own cap of 50 applies a day; ours is 30.
- **Cost at 1M users.** As (b) without the live view: 21–28k busy browsers plus proxies, **~$3.5–26M a month**, ₹10–75 a user a day.
- **What of K1 and K2 carries over.** Almost all: `SiteConnection` and `connection.ts`, consent, sealed storage, Disconnect (K1); `sites/ingest.ts`, `fetchers/naukri.ts`, `storeSiteListings`, `SourceRun`, the cron tick (K2); the K4 apply run as it is. Replaced: `sites/connect.ts` and `worker/handlers/sourceConnect.ts` give way to a route that takes the extension's cookies (naukri.com only, Zod-checked, sealed); the `hasScreen` requirement goes; `browser.ts` gains a proxy per user. ~95% reuse.
- **Effort.** ~8–11 days: the extension 2–3, the route 1, cloud runs with per-user proxies 5–7.
- **What it does better than (a).** Applies go out while the user's computer is off. It is the only thing it buys, and it is bought with (b)'s bill and (b)'s proxies.
- **Verdict.** Solves sign-in at scale, not the problem. At 1M users it is (b) with a cheaper sign-in: it does not survive.

### 13.8 Option (f): the extension as a thin executor, at request level

(a) with the page taken out. The user is already signed in to Naukri in their own Chrome, so there is no connect flow. The server decides which job and every answer and keeps governance, as in (a); the extension, from a naukri.com tab of the user's browser (or its service worker, if cookies go with it there, V4), sends the same apply and chatbot requests Naukri's own page sends (K4 recon, 5 Nov: `…/apply-workflow/v1/apply`, `…/botapi/v5/respond`), with the user's cookies, from the user's IP, and relays Naukri's JSON reply to the server as the evidence. NopeRi (github.com/Traverser25/NopeRi, no licence: read, not copied) applies the same way with no browser at all.
- **Sign-in.** None of ours, as (a). We never see a password or OTP.
- **Where the session lives.** The user's Chrome. We store no cookies.
- **IP and bot checks.** Every apply leaves from the user's own address, which matters if Naukri's sessions are bound to an address, as NopeRi's README says ("Naukri fingerprints IPs. Sessions are IP-bound"; V1 checks it). That would also break (b) and (e), whose whole model is replaying the session elsewhere. No untrusted clicks, no background-tab throttling, no selectors to keep up. The new signal: applies posted with no job-page view before them and none of the page's own script running, one client's request pattern on a million accounts, a one-line rule for Naukri. Calling Naukri's private endpoints without its page is also a plainer case of the "automated means" its terms forbid than pressing its button (Q14).
- **The condition.** If the page's apply or chatbot request carries a value the page computes per request (a signed header like the search's `nkparam`, a reCAPTCHA token), the executor would have to make that value itself: the circumvention §3 option C rules out. Then (f) is out and (a) is the route (V2).
- **At 1M users.** No browsers anywhere: per apply 1–3 requests from the user's browser, kilobytes instead of megabytes, seconds instead of a minute. Ours: ~6 device-API calls an apply (permit, relays, result), ~3k requests a second on average, ~9k at peak (~$2–5k a month); the database as (a) (~$5–20k); no screenshots needed, since Naukri's JSON reply is the evidence (Q14). **~$7–25k a month, ₹0.02–0.07 a user a day.**
- **What changes in K1, K2 and K4.** K1: the connect window (`sites/connect.ts`, `worker/handlers/sourceConnect.ts`, `waitForSignIn`) goes; `SiteConnection` stays, set from the extension's signed-in check; the sealed state is unused for device users. K2: becomes discovery by bucket (§13.9); `fetchers/naukri.ts` and `storeSiteListings` stay, the per-user page loop (`sites/ingest.ts`, `sourceIngest.ts`) goes. K4: `naukriApply.ts` (the page, the drawer, `ApplyWatch`) goes; `naukriChat.ts` stays server-side (`readApplyReply`, `optionFor`, `optionsFor`, `dobParts`) and gains a parser for the chatbot's JSON question beside `questionOf`, which reads the DOM; the runner's answer loop (`resolveForm` per question, guess and send), `gate.ts` and the events stay server-side; the mock's two services (`app/mock/naukri/`) already answer these requests and serve the tests.
- **Effort.** ~13–15 days: spike 3, device link 5 (shared), executor 3–4, JSON question parser 2.
- **Beyond Naukri.** Hirist and IIM Jobs are also Info Edge sites (their terms name Info Edge); the same executor likely extends to them, under the same terms (Q15).
- **Verdict.** The cheapest and easiest to scale of all, if V1 and V2 pass. (a) is the same design one level up and the route if they do not.

### 13.9 Discovery at scale: who reads Naukri's listings

K2 reads per user: at 1M users ~130M page loads a day, most of them the same searches. Three ways to read less:

| | (i) Per user, in users' own sessions (K2 today) | (ii) Per bucket, in users' own browsers | (iii) One shared reader on our servers, signed out |
|---|---|---|---|
| How | each user's device runs that user's searches | searches deduped into (keyword, city, experience) buckets; each bucket run once a window by one online device whose user's own search it is; results shared | our server calls Naukri's search API directly, as JobSpy (github.com/speedyapply/JobSpy) does, signed out |
| Reads a day at 1M | ~18M search pages + job pages | thousands of buckets × 9 pages: ~0.1–0.4M | the same, from us |
| Needs a device online | yes | some user in each bucket | no; phone-only users get jobs too |
| Our cost | device API only | device API only | a few servers, plus proxies if Akamai refuses our addresses (fact 1: 403 from datacenter addresses): small at this volume |
| Fits the owner's 3 Nov decision ("fetched per user … never a crawl") | yes | yes: each device reads only its own user's search; duplicates are skipped | **no**: it is the crawl the terms forbid, and it works only by generating the per-session signature (`nkparam`) the search requires, which §2 fact 1 and §3 option C rule out ("we never mint, copy or replay the signature") |

Checked 7 Nov by the planning session: signed out, Naukri's own `/jobapi/v3/search` answered 200 (20 of 288 listings for "java developer, bangalore"); without the page's signature it answers 406. **Recommended: (ii).** It gives most of (iii)'s saving without crawling or making Naukri's signature. (iii) is the owner's call against their own earlier decision and Naukri's terms (Q13); this design does not recommend it and does not describe how the signature is made.

### 13.10 At a million users

(a)–(c), (e) and (f) are priced for Naukri's own Apply; a job that redirects to an ATS goes through (d)'s path in every option, so (d)'s cost is the product's base cost, not an extra.

| | (a) Extension | (b) Cloud browsers | (c) Desktop app | (d) Discovery + ATS in our cloud | (e) Extension sign-in + cloud runs | (f) Thin executor |
|---|---|---|---|---|---|---|
| Browser compute, ours | none | 21–28k busy browsers | none | ATS applies only, up to ~31k headless | 21–28k busy browsers | none, and none on the user's side either |
| Our cost a month (LLM excluded) | ~$10–30k | ~$3.5–26M | ~$10–30k + signing | up to ~$0.4–0.6M, shared with every board | ~$3.5–26M | ~$7–25k |
| Per user a day | ₹0.03–0.08 | ₹10–75 | ₹0.03–0.08 | up to ₹1.1–1.7 | ₹10–75 | ₹0.02–0.07 |
| Egress IPs | 1M users' own | 1M proxies (evasion) | 1M users' own | our cloud, to ATSs only | 1M proxies (evasion) | 1M users' own |
| Concentration Naukri sees | one extension's behaviour | proxy ranges + automation | one automation fingerprint | reads only, no applies | sessions hopping from home lines to proxies: a stolen session's signature | applies with no page view before them |
| Password and OTP | never pass through us | through our streamed page | never pass through us | none for Naukri; Workday accounts need one (Q10) | never pass through us | never pass through us |
| Credentials we hold | none | 1M live sessions | none | Workday accounts, if chosen | 1M live sessions | none |
| Phone-only users | no | yes | no | **yes** | no (connect needs desktop Chrome) | no (applies wait for desktop Chrome) |
| Naukri's own Apply jobs | yes | yes | yes | **no** | yes | yes |
| Reuse of today's code | ~70% | ~95% | ~85% | the ATS adapters as they are | ~95% (K1, K2, K4 as they are) | server side as (a); no page code |
| Effort to first users | 15–19 days | 8–10 days | 15–20 days | 5–6 days; 15–21 with Workday | 8–11 days + proxies | 13–15 days |
| **Survives 1M** | **yes** | **no** | yes, weaker | **yes, for redirect jobs** | **no** | **yes, cheapest, if V1 and V2 pass** |

### 13.11 Decision (owner, 23 Nov 2026): the myjobb way

The owner's words: "our users will be mobile users we have to run it without extensions" and "we will go this by the myjobb way they have already built and proved". Settled the same day:

1. **Runs happen in our cloud, with the user's own Naukri session.** The user connects Naukri once; from then on our workers read and apply with that session, whether or not any device of theirs is on. This is option (e), with (b)'s sign-in added for phones.
2. **Connect: both, phone first.** On a phone, the user signs in to Naukri inside a browser we run, streamed to their screen (§13.12). On a computer, a one-button extension may hand us the session instead (§13.12). The streamed sign-in is the main path and the only one a phone-only user has.
3. **A residential proxy per user, from the start.** Each connected user gets their own sticky residential address in India, ideally in their own city; their sign-in, refreshes, reads and applies all leave from it. Chosen over measuring our own addresses first.
4. **Naukri jobs that apply on a company ATS** keep going through our adapters from our cloud (option (d), K4c, K13, K12): no Naukri session needed for those.

What the owner accepts with it, recorded so no task re-opens it:
- **The password and OTP pass through our stream** as the user's keystrokes. "We never see them" becomes "we never type, store, log, record or screenshot them" (§13.12).
- **We hold every connected user's live Naukri session**, sealed as K1 does, and we keep it alive with Naukri's own refresh until the user disconnects or the refresh fails. ARCHITECTURE §6.20's "never a silent re-login" becomes "a refresh of a session the user connected; a failed refresh puts the source in `needs_signin`".
- **A residential proxy per user is the disguise Naukri's terms forbid** ("You undertake not to circumvent these methods", §2 fact 4). The risk is Naukri limiting or suspending users' accounts; the Connect sheet says so plainly and the user accepts it (as K1's consent does today).
- **Cost** is dominated by proxy traffic, so every run is kept as small as Naukri allows: requests instead of page loads where Naukri's own requests need nothing the page makes (V2), one read per search bucket (§13.9 (ii), done server-side), no page images.
- **§13.3–13.8's verdicts** that closed (b) and (e) and recommended the extension are history; the comparison stays as the record of why.

What does not change: no CAPTCHA is solved by code (a check during sign-in is the user's, in the stream; during a run it pauses the account and asks the user, §4.8); no minting of Naukri's per-session signature (§3 C; a value the page makes is made by the page in a browser, never by our code); caps and pace (30 applies a day, under Naukri's own 50; a minute apart; pause on any check); only listings and the user's own profile are read; test profiles stay on `/mock/naukri`; every check is an event.

### 13.12 Architecture: connect, keep alive, run

```
 Phone (web app)                 Next.js web                  Postgres                     Cloud workers (Linux, display, Chrome)
 ┌──────────────────┐  HTTPS    ┌─────────────────────┐      ┌────────────────────┐       ┌──────────────────────────────────────┐
 │ Account sheet    │──────────▶│ /api/sources/...    │─────▶│ SiteConnection     │◀─────▶│ source-connect: sign-in browser      │
 │ "Connect Naukri" │◀─ WSS ───▶│ /api/sources/stream │◀────▶│ EgressProxy (new)  │       │   through the user's proxy, streamed │
 │  (streamed page) │  frames + │   (relay only)      │      │ FileBlob (sealed   │       │ source-refresh: Naukri's own refresh │
 └──────────────────┘  input    └─────────────────────┘      │   session)         │       │ ingest-source: one bucket, in Chrome │
 Desktop Chrome + extension ── POST /api/sources/naukri/session ──▶ (sealed)       │       │ apply: request level or in Chrome    │
                                                              └────────────────────┘       └───────────────┬──────────────────────┘
                                                                                                           │ every request through
                                                                                                           ▼ the user's own proxy
                                                                                            residential proxy (India, per user) ──▶ naukri.com
```

- **Egress (new; built in K7).** One sticky residential address per connected user, from one provider account (credentials in env, never in the database). No table: residential providers make an address sticky by a session name in the proxy's user name, so each user's name is an HMAC of site and user id (`modules/sources/egress.ts`), the same on every run and different between users, with nothing stored. A table comes only if V1 shows each user needs an address held for months (§13.15 item 2). Every Naukri request for that user (connect, refresh, read, apply) goes through it; nothing for Naukri ever leaves a worker's own address. `browser.ts` opens the user's Chrome context with it; an HTTP client in `modules/apply/sites` uses it for request-level calls. Released on Disconnect. A provider's sticky session lasts 24 hours to 7 days, so whether a session survives the address changing inside the same city is V1; if it does not, the provider plan must hold one address per user for months (priced per address, quote needed).
- **Connect on a phone (streamed sign-in).** `source-connect` (K1's queue) runs on a cloud worker: a fresh Chrome context through the user's proxy, on Naukri's login page, sized to the phone. The worker sends the page as a screencast (Chrome DevTools `Page.startScreencast`) to the web app over a WebSocket relay, and the user's taps and keys come back as input events. The worker never reads the login form, never types, never reads the OTP box, as K1; the relay passes input through without logging; screencast frames are never stored, and no screenshot is taken while the window is on the login pages. Sign-in is detected as K1 does (`waitForSignIn`), then the state is filtered to naukri.com and sealed (K1's `lib/sealed.ts`, `browser-state/<userId>/naukri.json`). The session is born on the address it will be used from, which is what an address-bound session needs. "Sign in with Google" works (a real Chrome, not a WebView), though Google may ask for an extra check from a new address; that check is the user's, in the stream.
- **Connect on a computer (extension).** A one-button Chrome extension: the user, signed in to Naukri in their own Chrome, presses "Connect Naukri", agrees, and the extension posts that browser's naukri.com cookies to `POST /api/sources/naukri/session` (paired to their SwipeApply account by a one-time code; Zod-checked; naukri.com only; sealed at once; nothing else read). That session was born on the user's home address; if V1 shows sessions are bound to an address, the extension path is dropped and desktop users use the streamed sign-in too.
- **Keep alive.** `source-refresh` (new queue): before each run, and on a schedule only if V7 shows the refresh token dies unused, the worker calls Naukri's own refresh with the sealed session through the user's proxy and seals the result. A refused refresh is `needs_signin`, a push, and the next run waits for a new connect. Never more often than Naukri's own page would refresh.
- **Reads.** §13.9 (ii) on cloud workers: searches deduped into (keyword, city, experience) buckets; each due bucket is read once a window in Chrome, with the session of one connected user whose own search it is, through that user's proxy, so the page makes its own signature; job pages only for jobs not yet stored. `fetchers/naukri.ts`, `storeSiteListings` and `SourceRun` as K2.
- **Apply.** K4's run, in the cloud: `swipeRefusal`, `runGate` (cap, pace), `check('submit')`, then either request level (Naukri's own apply and chatbot requests, with the sealed session through the user's proxy, if V2 shows they carry nothing the page makes) or in Chrome (K4's page run as it is). Each chatbot question through `resolveForm`; Naukri's reply is the evidence (`readApplyReply`), with a screenshot only on browser runs. A check, a refusal or "Access Denied" pauses that user (`limited`, §4.8) and asks them in the app; the next run waits.
- **Mobile UX.** Account → Naukri → "Connect": the consent sheet (what we read, what we send, that Naukri may limit accounts it finds automated, that we run from a home address in their city), then the streamed sign-in fills the sheet; "Connected as <first name>". A paused or signed-out account shows the reason and "Connect again".

### 13.13 What carries over from today's code

| Kept | Changed | New |
|---|---|---|
| `modules/sources` (`connection.ts`, `sites.ts`), the state machine (§4.4), `SourceRun` | `sites/connect.ts`: the window streams to the phone and runs through the proxy | `EgressProxy` and the proxy client |
| K1's sealed session (`lib/sealed.ts`, `browser.ts onlySite`, Disconnect) | `browser.ts`: per-user proxy; cloud workers with a display take `source-connect`, `ingest-source` and Naukri applies | the screencast relay (`/api/sources/stream`) and the streamed sheet |
| `sites/naukri.ts` (`waitForSignIn`, `readSearch`, `readJob`, `pageStop`) | `sites/ingest.ts`: per bucket, not per user | `source-refresh` and Naukri's refresh call |
| `naukriChat.ts`, `naukriApply.ts` (browser runs), `gate.ts`, `resolveForm` and the answer chain | `runner.ts executeOnSite`: request level beside the page run | a chatbot-JSON question parser beside `questionOf` (request level) |
| `fetchers/naukri.ts`, `storeSiteListings`, the feed, `/mock/naukri` | `worker/handlers/sourceIngest.ts`: bucket leases | the connect extension (desktop) |

Nothing from the device-link design (old §13.12) is built.

### 13.14 Path to a million users

| Stage | Users | What changes | Gate to the next stage |
|---|---|---|---|
| 0, today | 1 (owner) | the screen worker on the laptop | — |
| 1, K6–K10 | the owner, then ~20 | checks on the owner's account; per-user proxy; streamed sign-in; refresh; cloud runs; the desktop extension | real applies from 20 accounts for a week with checks per account counted |
| 2 | ~1k | buckets (K14); request-level apply if V2 allows; proxy traffic per user measured | proxy GB a user a day measured, account checks under the owner's limit |
| 3, K11 | 10k–100k | load test; workers autoscaled; partitions as §13.10 | measured limits |
| 4 | 1M | whatever K11 shows; proxy provider contracts at volume | — |

Starts after the job boards work is done (owner, 7 Nov), as Phase K always has.

### 13.15 Open questions for the owner

Answered 23 Nov: Q1 (phone users: yes, streamed sign-in), Q12 (applies while the computer is off: yes, the myjobb way), the proxy question (per-user residential, from the start). Q3, Q5 and Q7 belonged to the extension design and fall away. Q5 and Q6 answered 27 Nov: see 13.17. Still open:

1. **Proxy provider and budget.** Which provider, and what monthly ceiling? Request-level runs cost roughly 2–5 MB a user a day in proxy traffic (~$1–20 a day per thousand users); browser runs ~200 MB (~$100–800 a day per thousand). V2 decides which.
2. **Address-bound sessions (V1).** If a Naukri session does not survive its address changing, each user needs one address held for months, priced per address. Accept that cost, or stop at the users it serves?
3. **The browser for Naukri runs.** ARCHITECTURE §6.21 opens the stealthy Chrome for every run on every board. Naukri runs too, or the plain Chrome?
4. **Keep-warm cadence (V7).** Refresh only before runs (recommended), or around the clock as myjobb does ("keep your job-board sessions live so auto-apply does not fail overnight")?
5. **Shared buckets (old Q6).** One connected user's session reads a bucket whose results other users get. Yes (recommended: it cuts reads per user to near zero), or each user's session reads only their own searches?
6. **A shared signed-out reader (old Q13).** Still out of this design: it would mint Naukri's signature. Unchanged unless the owner says otherwise.
7. **Workday accounts (old Q10)** and **Hirist, IIM Jobs, Foundit, Instahyre (old Q15)**: as before; the same connect and proxy design extends to them once Naukri runs.
8. **Info Edge.** A partner conversation before stage 3 remains the clean route at a million accounts.

**Checks on the owner's account before any other user (K6):** V1 a session through a proxy survives the address changing within the city (and a session made at home works through a proxy, for the extension path); V2 Naukri's own apply and chatbot requests carry no value the page makes; V3 the chatbot answers through to applied; V5 Naukri's own daily cap; V6 the share of Naukri-only listings; V7 how long the refresh token lives unused.

### 13.16 OTP connect (owner, 23 Nov 2026, after the first live try)

**Why.** On the owner's first real tries the streamed page did not work for them: typing a whole login into a picture of a page is too much on a phone, and the worker's window was closed under it twice. The owner showed myjobb's flow as the bar: the user types their mobile number in the app, Naukri texts a code, the user types the six digits in the app, connected. No Naukri page on the user's screen.

**Decision (owner, 23 Nov).** (1) The worker drives Naukri's own login page, not Naukri's login requests: the page makes whatever it sends (reCAPTCHA token, any signature), so nothing of Naukri's is forged (§3 C stands). Naukri's API straight from the worker stays a later research task. (2) The rule changes: the user gives their mobile number and Naukri's code in our app, and the agent enters them on Naukri's login page. Never a password. The code lives in the worker's memory for those seconds only: never stored, logged, sent anywhere but Naukri's page, or reused. (3) The number is kept, sealed like the session, so "Connect again" asks only for a new code.

**Facts (Naukri's login page, read 23 Nov, nothing entered).** `/nlogin/login` has a "Use OTP to Login" button (`button.otpBut`); it shows a 10-digit mobile box (`input.mobileInputt`, `type=tel`, `maxlength=10`) and "Get OTP" (`button.sndbtn`, disabled until ten digits); reCAPTCHA is on the page. The code screen appears only after a real code is sent, so its boxes are found when it shows (one box of 4–6 or six boxes of one digit), not assumed.

**Flow.** Connect (consent) → `source-connect` opens Naukri's login in the stealthy Chrome through the user's proxy (K7), streamed as K8 but with no frames sent unless the phone asks → the phone sends the number to the worker (`POST /stream/<id>/login`, the K8 pass; or "use the saved number") → the worker presses "Use OTP to Login", types the number, presses "Get OTP", and answers `code_sent`, or `check` when a challenge shows (the phone then shows the page for that step, as K8), or `refused` with Naukri's own message (unknown number, too many tries) → the user types the code in the app → `POST /stream/<id>/code` → the worker types it and submits → `waitForSignIn` and the sealed save as K1 → "Connected as <first name>". Resend: the same `/login` call again after Naukri's own wait. The number and the code never pass through the web app or Postgres; the sealed number is `browser-state/<userId>/naukri-login.json` (lib/sealed.ts), deleted on Disconnect with the session.

**What stays.** Test profiles refused; one sign-in per user at a time, ending with its 10-minute job; no CAPTCHA solved by code; nothing of the login pages stored, logged or screenshotted; every request from the user's own proxy.

### 13.17 Shared signed-out reader (K14, owner, 27 Nov 2026)

**Decision.** The owner asked for Naukri's jobs to be sourced the way ATS boards' are: read once for everyone, shared as ordinary jobs, consistent in the feed. This reverses 13.9's "no shared signed-out reader" and the 3 Nov "fetched per user" line, and answers Q5 (shared buckets: yes) and Q6 (a shared signed-out reader: yes, in a real Chrome that loads Naukri's own pages). 13.9 (iii) ruled the reader out because a server calling Naukri's API directly has to make the page's signature; this design never does: the reader is a Chrome window, the page makes its own requests, and we read the answer the page received, as K2 already does in a user's window.

**Facts (26 Nov, a probe window in the screen image, signed out, its own proxy session, a person's pace).** A search page answered 200 with listings (20 of 2,008 for "java developer, Bengaluru"); 30 company-name searches (`/<company>-jobs`) all answered 200 with no check or block; 20 of the 30 sampled names from the owner's list showed that company's own listings on page 1 (the rest were spelling differences such as "EY" for "Ernst Young", or companies with few or no listings: not confirmed absent). 31 page loads cost 2.8 MB through the proxy with lean pages (K15) and Chrome's cache, about 90 KB a page, far below the 1 MB a page this design first assumed.

**Design.** ARCHITECTURE 6.20 "Shared reader" is the source of truth: buckets (`ReaderBucket`), the plan tick and reader windows (`reader-plan`, `reader-run`), the reader's own proxy address that moves after a refusal, the caps in `config/rules.json shared_readers`, and what stays. Two kinds of bucket: searches the connected users share (cost grows with distinct searches, not users) and a company's own jobs from a list of names.

**What stays.** Naukri jobs are shown only to users who connected Naukri; applying is only through the user's own session, proxy and pace (K4, K7, caps unchanged); no signature made, no check answered or solved, no sign-in by the reader, no user's account or address used for reading; test profiles refused as before. K2's per-user read remains the path while `NAUKRI_READER` is unset.

**Failures.** A check, an "Access Denied", or Naukri's login on a signed-out page stops the window and pauses the reader for `pause_hours_after_challenge`; its next window uses a new proxy address; the unread buckets stay due. A page that fails on its own fails that bucket (tried again soon, later each time); three in a row end the window. A window that dies leaves its claims to lapse (30 minutes) and its run record without an end.

**Observability.** One `ReaderRun` per window: buckets, pages, listed, created, updated, job pages, stop reason; the worker logs the same line, and the proxy bytes of the window (counts per window, `proxy:` line). Nothing from a listing is logged.

**Risks.** Naukri's terms do not allow automated reading, as with every signed-in read here; the reader at least puts no user's account at risk. Naukri may turn the reader's addresses away: the caps keep it a few hundred pages a day, a stop pauses it, and a new address follows. A company name that matches loosely stores its listings under their own companies, so no job is mislabelled; a name Naukri spells differently finds nothing and waits two weeks.

**Not in K14.** K13 (a Naukri listing that applies on a company's own board adds that company to the ATS ingest), several readers at once (`readers` > 1 is supported by the queue but not measured), and non-tech fields in the feed (they are stored; showing them is the later phase).
