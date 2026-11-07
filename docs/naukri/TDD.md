# Naukri through the user's own account — technical design (Phase K: K1, K2, K4)

Version 3, 7 Nov 2026 (§13 adds a proposal for many users on their own devices; version 2, 3 Nov). Owner's decision of 29 Oct: Naukri and LinkedIn come in through the user's own signed-in account, after Phase J (ARCHITECTURE §6.20, PRD FR10, CLAUDE.md hard rules). This is the full design for the Naukri half. LinkedIn (K3, K5) reuses the same connection, ingest and stepwise-apply shape. ARCHITECTURE stays the source of truth: K1 copies the decisions here into §6.20 when it lands.

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
| Naukri limits or suspends the user's account | Said plainly at Connect and accepted; visible real Chrome, own session, a minute between applies, 30 a day, pause on any check; never stealth, proxies or minted headers. The caps are the first thing lowered if a check appears |
| Naukri records the apply on the click, before its questions | `markAttempted` before the click; "already applied" after our attempt = sent; questions cached per job so later users are asked first |
| Drawer or JSON changes | Zod fails closed; fixtures and offline tests; screenshots on failure |
| Only the laptop has a screen | Naukri waits, never runs headless; always-on needs a VM with a display (DEPLOY.md "Docker worker with a screen"); many users, each from their own device: §13 |
| Saved session leaks | Per-site, cookies-only, AES-GCM, never exported or logged, deleted on Disconnect |
| Duplicates with our own ATS ingest | `applyVia` + `roleKey` fold; other company-site jobs not stored |
| Wrong searches → empty Naukri feed | Searches come from tracks and preferred locations the user confirmed; the recommended-jobs page is a fallback search; "Fetch now" shows counts |

---

## 10. Tasks

In [TASKS.md](TASKS.md) beside this file: K1, K2, K4 and K4b with their Do, Done-when and the sections of this design each one builds; K3 and K5 (LinkedIn) until their own design exists; K6–K10 for many users on their own devices (§13). Root `docs/TASKS.md` Phase K lists them one line each. Order K1 → K2 → K4, one session each, plan first, check pasted, typecheck and lint.

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

## 13. Many users, each from their own device (proposal, 7 Nov 2026)

Status: **proposal for the owner** (questions in §13.9). Nothing in K1–K4 changes until K6 reports. Tasks K6–K10 in [TASKS.md](TASKS.md#k6).

### 13.1 The problem, goals and non-goals

Today every Naukri window opens on the one worker with a screen (`canShowWindow()`, `WorkerBeat.hasScreen`, §4.1): the owner's laptop. For a second user that means their sign-in window opens on the owner's screen, where they are not; every account's traffic leaves from one home IP, so N accounts on one address look like an account farm to Akamai (fact 4, §2) and one "Access Denied" (§4.8) pauses everyone; and one sleeping laptop stops all of them.

Goals: each user signs in on their own device, in a window they see; their Naukri traffic leaves from their own connection; we never see their password or OTP; every rule stays server-side and unchanged (`gate.ts swipeRefusal` and `runGate`, `check('submit')`, caps and pace from `config/rules.json`, a `source` on every value, an event for every check); the owner's screen worker keeps working for the owner, development and the mock.

Non-goals: stealth browsers, proxies that make a datacenter look like a home, minting Naukri's signature (all ruled out in §3); phone-only users in the first version (§13.9 Q1); LinkedIn (K3 and K5 would reuse what this builds).

### 13.2 One user's day, the unit every cost below is priced on

| Work | Volume (`signed_in_sources.naukri`, §4.8) | Browser time |
|---|---|---|
| Job runs | 2 a day × (3 searches × 3 pages = 9 search pages + up to 40 job pages) | ~4 min a run |
| Applies | up to 30 a day, a minute apart; each a job page, Apply and 0–6 drawer questions | ~45 s each |
| Contexts | one Chromium context per run or apply, closed after | — |
| Total | ~130 Naukri page loads | **~30 min a day** |

Page weight is not measured yet; at an assumed 1.5–2 MB a load that is **~200 MB a day** per user (K6 measures it). LLM cost (`resolveForm`, drafts) is the same in every option and left out.

### 13.3 Option (a): a browser extension in the user's own Chrome

A Manifest V3 extension. It holds no rules and no answers: the server decides every step and the extension is the hands in the user's own browser (the device link, §13.6).
- **Sign-in.** None of ours. Most users are already signed in to Naukri in their Chrome; if not, the extension opens naukri.com's own login page in a tab and the user signs in there as they always do. The extension reads only "signed in, first name" (the header, as `naukri.ts firstNameOf`); it never reads the login form or an OTP box (no content script on the login pages).
- **Where the session lives.** In the user's own Chrome, nowhere else. We stop storing Naukri cookies at all (the K1 sealed blob, §4.9's largest risk, goes away for these users); Disconnect revokes the device token and forgets the connection.
- **IP and bot checks.** Each account runs from its own home or mobile connection, in genuine Chrome: the user's own fingerprint, history and sign-in, no `navigator.webdriver`, no automation flags. This is the least bot-like of all options. Open points, all measured by K6: the page's own search and apply replies must be read without calling Naukri ourselves, so a script in the page's world wraps `fetch`/XHR read-only (Akamai's script may notice a wrapped `fetch`; `chrome.debugger` would read them cleanly but puts a "started debugging this browser" bar on every window, so no); a content-script click is an untrusted event (`isTrusted: false`) with no mouse movement before it, which Naukri's Apply handler or Akamai's scoring may refuse; tabs in a background window are throttled, and `captureVisibleTab` needs the tab visible.
- **Cost per user per day.** Ours: polling and reports, well under ₹1. The user's: their own ~200 MB. One-time: the Chrome Web Store developer fee ($5).
- **Reuse.** Server side, unchanged: `naukriChat.ts` (pure: `jobPageState`, `readApplyReply`, `questionOf`, `optionFor`, `dobParts`), `gate.ts`, `fetchers/naukri.ts` (`planSearches`, `fromSearch`, `withDetail`), `storeSiteListings`, `resolveForm`, `modules/sources/*` (gains a device on the connection). Ported to DOM code in the extension: the page-reading parts of `naukriApply.ts` (`READ_DRAWER` and the job-page signals are already plain DOM code passed to `page.evaluate`), the stop signals of `naukri.ts pageStop`. Rewritten: `ApplyWatch` (as the page-world tap), clicks and fills, the page loop of `sites/ingest.ts`. Not used: `sourceConnect.ts` and `sites/connect.ts` (pairing replaces them). Roughly 70% of the Naukri code reused, ~400 lines of page control rewritten.
- **Effort.** ~15–19 days: spike 3, device link 5, extension connect and ingest 4–5, apply 5–6, store listing and pilot 2 (+ 1–3 weeks of store review, run alongside).
- **Against.** Needs a computer with Chrome that is on: a right swipe on the phone is applied when that Chrome next runs. Chrome Web Store review and policy. Chrome only (Edge and Brave take Chrome extensions; Firefox later).

### 13.4 Option (b): cloud browsers with a live view, per-user egress IPs

Our worker drives a browser at a vendor (Browserbase, Steel, Hyperbrowser, Anchor) or our own VMs, over CDP (`chromium.connectOverCDP`); for sign-in the web app embeds the vendor's live view of that browser in the Connect sheet.
- **Sign-in.** The user types their password and OTP into a streamed page: every keystroke passes through the vendor and through our page. "We never see it" becomes a policy, not a structure, and the vendor's session recording must be off for the connect session or the password is in a recording.
- **Where the session lives.** The vendor's persistent context (their cloud) or our sealed blob as today (`storageState` over CDP). Either way a live credential for every user sits off their device.
- **IP and bot checks.** The vendor's own addresses are datacenter ranges, which Akamai refuses (fact 1). Making it work needs a residential or "ISP" proxy per user: someone else's home line, or a datacenter address registered to look like one. That is the evasion §3 option E rules out and Naukri's terms forbid. Rotating pools also break Naukri's IP-bound sessions (§12, NopeRi): sign-in from one address, the next run from another, then OTP checks. And all users still come from one vendor's known ranges.
- **Cost per user per day.** Browser ~0.5 h × $0.10–0.12 = $0.05–0.06; proxy ~0.2 GB × $10–12/GB at the vendor, or $1–4/GB from a proxy seller, = $0.2–2.4. **About $0.25–2.5 (₹20–210) a user a day, ₹600–6,300 a month.** Own VMs cut the browser part to cents; the proxy part stays.
- **Reuse.** The most: `naukriApply.ts`, `naukri.ts`, `sites/ingest.ts`, `gate.ts`, `sourceIngest.ts`, the runner as they are; `browser.ts` gains a CDP connect; `sourceConnect.ts` gains the live-view URL. ~95%.
- **Effort.** ~8–10 days (CDP connect, live view in the sheet, per-user proxy binding, vendor contexts), then the cost forever.
- **Against.** The proxy is the whole problem and cannot be made honest. It is the only option that serves phone-only users.

### 13.5 Option (c): a desktop companion app

A small app the user installs (tray app: Node with `playwright-core` and the installed Google Chrome, packaged as a signed executable, or Electron). It is our screen worker, cut down to one user and talking to the device link instead of Postgres (it can never hold `DATABASE_URL`).
- **Sign-in.** As today on the owner's laptop: a visible Chrome window on the user's own computer, they sign in themselves; `waitForSignIn` unchanged.
- **Where the session lives.** A Chrome profile folder on the user's disk, never uploaded.
- **IP and bot checks.** Their own connection, as (a). The browser is Playwright-launched Chrome (automation flags, `navigator.webdriver`), exactly what works on the owner's laptop today; clicks are trusted CDP input. So bot checks are as today, one account per address.
- **Cost per user per day.** Ours as (a), under ₹1. Fixed: code signing (Windows ~$100–400 a year, Apple $99 a year); without it, SmartScreen and Gatekeeper warnings.
- **Reuse.** `naukriApply.ts`, `naukriChat.ts`, `naukri.ts` run on the device as they are (they import only Playwright and pure modules); `gate.ts`, `fetchers/naukri.ts`, `storeSiteListings`, `sources/*` stay on the server; `sites/ingest.ts` and `executeOnSite` split at the same seam as (a). ~85%.
- **Effort.** ~15–20 days: device link 5 (shared with (a)), the app and its loop 4, packaging, signing and auto-update for Windows and macOS 5–7, pilot 2.
- **Against.** An exe from an unknown publisher is a hard ask; per-OS builds and updates; a Chrome window popping up on the user's desktop while they work; the computer must be on, as (a).

Also rejected: **carrying the user's cookies to our cloud worker** (Naukri sessions are IP-bound, and the traffic is back on our addresses); **the screen worker on a VM with a display** (§9: one address for everyone, the problem itself).

### 13.6 The shared piece: the device link (for (a) and (c))

The server keeps the brain, the device is the hands. A device never gets database or queue access and never decides whether to send.
- **Data.** `DeviceLink {id, userId, kind: extension | companion, tokenHash, label, version, lastSeenAt, revokedAt}`; `DeviceTask {id, userId, site, kind: ingest | apply, applicationId?, payload, leasedUntil, attempts, state}`; `SiteConnection` gains `deviceId` (null = the screen worker, as today).
- **Pairing.** The extension opens `/device/pair?code=…`; the user, signed in to SwipeApply with Google, approves; the device gets a random token (only its hash stored), revocable from Account. Test profiles cannot pair (they stay on the mock through the screen worker).
- **Loop.** The device polls `POST /api/device/poll` (every minute while Chrome runs, `chrome.alarms`); the server leases it one task. Ingest: the search URLs from `planSearches`, the page budget and pause; the device opens each page, returns the JSON the page fetched; the server runs `fromSearch`/`withDetail`/`storeSiteListings` and writes the `SourceRun`. Apply: the server runs `swipeRefusal`, `runGate` and `check('submit')`, writes `submit_attempt` and hands a one-time permit for that application; the device opens the job page, reports what it reads, presses Apply only with the permit, sends each drawer snapshot, gets back the value (from `resolveForm`, with its source) or a stop for `needs_input`, and reports Naukri's apply reply, which the server reads with `readApplyReply` to mark `submitted`. A stop page (`needs_signin`, `challenge`, `refused`) is reported and `markStopped` pauses the account as §4.8.
- **Trust.** Everything a device sends is Zod-checked and fails closed; hosts pinned to `www.naukri.com`; a token reaches only its own user's tasks. A device's listings become shared `Job` rows (owner, 3 Nov), so a tampered device could plant jobs in other users' feeds: §13.9 Q5.
- **States the user sees.** A Naukri application waiting for the device shows "Waiting for your computer" in the progress stage; the Account card shows the device and when it was last seen.

### 13.7 Comparison

| | (a) Extension | (b) Cloud browser + live view | (c) Desktop companion |
|---|---|---|---|
| Password and OTP | typed on naukri.com in their Chrome; we see nothing | typed through our streamed page; policy only | typed in a window on their computer; we see nothing |
| Session lives | their Chrome | vendor or our blob | their disk |
| Egress IP | theirs | proxy per user (evasion) | theirs |
| Bot signals | lowest (genuine Chrome); untrusted clicks to check | highest | as today |
| Our cost / user / day | < ₹1 | ₹20–210 | < ₹1 + signing |
| Code reuse | ~70% | ~95% | ~85% |
| Effort | 15–19 days | 8–10 days + running cost | 15–20 days |
| Phone-only users | no | yes | no |
| Install friction | store install, one click | none | signed exe, OS warnings |

### 13.8 Recommendation

**(a), the extension, on the device link, after a 3-day spike (K6).** It is the only option where the user's real browser, real session and real address do the work and we hold no credential at all; it costs almost nothing per user; it is the plainest reading of the owner's rule that the user signs in themselves and nothing is disguised. (b) is fastest to build but rests on residential proxies, which §3 and fact 4 already rule out, puts the password through our page and costs ₹600–6,300 a user a month: no. (c) is the fallback if K6 shows Naukri refuses content-script clicks or notices the read-only tap; because both sit on the same device link, switching from (a) to (c) is a new client, not a redesign. The owner's screen worker stays as it is (the owner, development, test profiles on the mock).

Order: K6 spike → owner picks (a) or (c) → K7 device link → K8 connect and ingest → K9 apply → K10 pilot with five users for a week, then the caps are revisited with real numbers.

### 13.9 Open questions for the owner

1. **Phone-only users.** (a) and (c) need a computer with Chrome. Is it acceptable that Naukri is offered only to users who install it on a computer ("Naukri needs SwipeApply on a computer with Chrome"), with phone-only users kept on the boards?
2. **Applies wait for the computer.** A Naukri right swipe goes out when that Chrome next runs. How long may it wait before it is cancelled ("Didn't go through: your computer was not on")? Proposal: 3 days.
3. **Distribution.** Public Chrome Web Store listing, unlisted listing, or a sideloaded pilot of up to 10 users first? Whose publisher account?
4. **The screen worker and the K1 blob.** For users on the extension we store no Naukri cookies. Delete the K1 sealed blobs for them and keep the screen worker for the owner and tests only? (Recommended.)
5. **Shared jobs from devices.** Share a listing one user's device reported with every connected user at once (as today), or only after a second user's device lists it too?
6. **If K6 finds untrusted clicks refused:** companion (c), or the extension fills everything and the user presses Apply in the tab we opened (a handoff, like Ashby), or `chrome.debugger` with its banner?
7. **No proxies, confirmed.** Keep "no residential or ISP proxies" as a rule, which closes (b) for good unless Naukri offers an official route?
