# Boards that need an account: Workday, Darwinbox, SuccessFactors — technical design (Phase V)

v1, 21 Nov 2026. Builds on Phase M's design for employer accounts ([boards/TDD.md §3.2, §4.4, §4.6](../boards/TDD.md#32-boards-that-need-an-employer-account)) and replaces its tasks M5, M6, M8, M10 and M15 for applying. What changed since 9 Nov: Workday's bot check stopped our job reads (17 Nov); every application runs in the stealthy Chrome on a worker with a screen, on one `apply` queue (18 Nov); job reading runs on GitHub Actions (M21); Darwinbox moved its careers sites to a new app. Not Naukri or LinkedIn (Phase K).

## 1. Goals and non-goals

Goals:
- A right swipe on a Workday, Darwinbox or SuccessFactors job ends in a submitted application, like the public-form boards, with an employer account the agent creates the first time.
- One account per (user, system, employer), created only after a right swipe on that employer's job, with the user's own email and the application password the user set (owner, 9 Nov).
- The user sees every account we made for them and its password, and can sign in to it themselves.
- The second application at the same employer signs in and fills only what is new.

Non-goals:
- Naukri, LinkedIn and the other signed-in portals (Phase K).
- Oracle Recruiting (a code on every visit; parked 9 Nov) and iCIMS (later, only if its India numbers grow).
- Reading the user's mailbox, a relay email address, or a forwarding filter: the email step stays manual (owner, 9 Nov).
- Solving any CAPTCHA or bot check. A check the worker's ordinary click does not pass goes to a person in the window, or the job is not offered (boards/TDD §3.5, option A).
- Signing in with Google or LinkedIn on an employer's site (Darwinbox offers both): we would need the user's Google session in the worker's browser.
- Deleting employer accounts: the user does that on the employer's site.

## 2. Facts the design rests on

Checked live on 21 Nov in a real browser, nothing submitted, unless dated otherwise.

1. **Workday sign-up** (Cotality, `cotality.wd115.myworkdayjobs.com`): Apply offers "Autofill with Resume", "Apply Manually" and "Use My Last Application". Apply Manually is a 6-step wizard: Create Account/Sign In, My Information, My Experience, Application Questions, Voluntary Disclosures, Review. Create Account asks for email, password, verify password, and a required box "I have read and consent to Cotality's Applicant Privacy Statement". The password needs a letter, a symbol, 8 characters, an upper-case and a lower-case letter, and a digit. The page carries a hidden decoy input ("This input is for robots only"). "Already have an account? Sign In" and "Forgot your password?" sit under the form. The page loaded with no challenge in a browser on a home connection.
2. **Workday's own checks** (7 Nov, its JavaScript): no third-party CAPTCHA; a decoy field, a 500 ms minimum on the form, a transparent layer over Submit, `isUserHuman()`, Cloudflare's `__cf_bm` in front. An activation link by email when the employer turns verification on.
3. **Workday job reads are stopped.** From 17 Nov Workday's Cloudflare answered our server's reads with its bot check (429) for 201 of 206 employers; 206 of 208 Workday companies are paused (`active = false`, last read 18 Nov). Their 5,400 India jobs have not been checked since, so some are closed. Workday is not in the feed today.
4. **Darwinbox moved to a new careers app** (Airtel, `airtel.darwinbox.in/ms/candidatev2/main/careers/...`, 63 open jobs). Its job list is `POST /ms/candidateapi/job/alljobs?companyId=main` (with `job/newfilters`); the 7 Nov reader address (`GET /ms/candidateapi/job?page=1&limit=100`) now answers a command-line request with an HTML challenge page. Some subdomains are gone (`makemytrip` answers "Invalid subdomain").
5. **Darwinbox sign-up:** Apply Now goes to `/auth/login` (email and password, or Google or LinkedIn). Sign Up asks for email, create password, confirm password, and a required "I agree to the terms and conditions" box. No CAPTCHA was on the page before submitting; on 7 Nov a Turnstile check and a code at sign-up were seen.
6. **SuccessFactors** (7 Nov): one account per company; password rules per company (Wipro: 6–20, a letter and a digit or symbol); per company a code, a link or nothing by email; an optional CAPTCHA, set apart for sign-up and sign-in. Jobs from each career site's `sitemap.xml` and RSS. India pool on 7 Nov: 3,063 jobs (EY GDS 2,835, NTT DATA, Bajaj Auto, Mahindra).
7. **Pool sizes** (our database, 20 Nov): Workday 206 companies, 165 with India jobs, 5,400 India jobs (stale, fact 3). Darwinbox and SuccessFactors are not read yet; 7 Nov's index counted 882 and 3,063 India jobs.
8. **What exists to build on:** the stealthy Chrome on a worker with a screen, one `apply` queue, `resolveForm` (synonyms, cache, model), guess and send, `requestCode` (the needs-you code sheet, the browser held up to 10 minutes, one per user at a time), `announceHandoff` (a person finishes in the window), the needs-input card, `markAttempted` before Submit, the stale-run reaper. Nothing for accounts exists: no `EmployerAccount` model, no vault, no Workday or Darwinbox adapter, no Darwinbox reader.
9. **Workday is moving off passwords:** the Workday Candidate Profile (announced 13 Oct 2026, general availability "early calendar 2027") signs in by email and a one-time code. `EmployerAccount.secret` is nullable for that.

## 3. Options and decision

### 3.1 The password and the email step

Kept from 9 Nov (boards/TDD §3.2): **one application password the user sets** (option B), stored encrypted, used only on employers' own sign-up and sign-in pages; **the email step by the user** (click the link, or type the code in the code sheet). The one change: the password rule follows Workday's, the strictest seen: **at least 12 characters with an upper-case letter, a lower-case letter, a digit and a symbol.** A tenant that refuses it stops with "Acme's Workday needs a different password" in Needs you.

### 3.2 Order of the boards

| Board | India jobs | Account | Email step | Checks | Verdict |
|---|---|---|---|---|---|
| Workday | 5,400 (stale), 165 companies, MNCs | per employer | a link, when the employer turns it on | its own invisible checks; Cloudflare in front | **First**, once its jobs are fresh again (§3.3) |
| Darwinbox | ~900 (7 Nov), Indian banks and large employers | per employer | a code at sign-up (7 Nov) | Turnstile (7 Nov) | **Second** |
| SuccessFactors | ~3,000 (7 Nov), EY GDS most | per company | code, link or none | optional CAPTCHA | **Third** |
| iCIMS | ~400 | per portal | a link | invisible hCaptcha on the email step | Later |
| Oracle | ~5,500, concentrated | none: a code every visit | every visit | invisible hCaptcha | Parked (9 Nov) |

### 3.3 Fresh Workday jobs

Applying to jobs we last read on 18 Nov sends some applications to closed postings. Options:
- **A. Read Workday from the laptop worker** (a home connection, which loaded Workday pages fine on 21 Nov), at the gentle pace already built (`GENTLE_BOARDS`: every 12 h for active employers, one company at a time). Conflicts with the GitHub-only reading test until that ends.
- **B. Read Workday from GitHub Actions.** Datacenter addresses are what Workday's Cloudflare refused on 17 Nov; expected to fail.
- **C. No list reads: check each job when it is applied to** (the run opens the posting first and ends "This job is closed" without a swipe being charged). Keeps closed jobs in the feed.

**Recommended: A after the GitHub test, with C as the guard in every run** (a closed posting ends the run before the account step, so no account is made for a closed job).

### 3.4 Bot checks

As boards/TDD §3.5 option A: the worker's ordinary clicks in the stealthy Chrome at a person's pace; the decoy field is never filled; a check that stops the worker hands the window to a person at the screen (`announceHandoff`), and a board where that happens on most runs is not offered for apply. Nothing reads or solves a check.

## 4. Architecture

### 4.1 Components

- `modules/accounts` (new): the vault (`encrypt`, `decrypt`, AES-256-GCM, key `ACCOUNTS_KEY`), `accountFor(userId, system, employer)`, `recordAccount`, state changes, the application-password rule. The only module that decrypts; decrypted values live in memory for the one fill and are never logged.
- `modules/apply/accountStep.ts` (new): the shared account step every account board's adapter calls: sign in, or create, or end the run with the verification card or a handoff; masks password fields before any screenshot.
- `modules/apply/adapters/workday.ts`, `darwinbox.ts`, `successfactors.ts` (new).
- `modules/jobs/fetchers/darwinbox.ts`, `successfactors.ts` (new); `fetchers/workday.ts` exists.
- Account screen: "Application password" and "Employer accounts" (§5).

### 4.2 Queues

No new queue. Applications stay on `apply`, taken only by a worker with a screen (18 Nov). A run waiting for the user's email step ends `needs_input` and frees its slot; "Done" re-enqueues it.

### 4.3 Data model

```prisma
model EmployerAccount {
  id         String   @id @default(cuid())
  userId     String
  system     String   // "workday" | "darwinbox" | "successfactors"
  employer   String   // Workday tenant, Darwinbox subdomain, SuccessFactors company id
  email      String   // the user's email at creation
  secret     String?  // AES-256-GCM of the password used (a copy of the application password at creation); null when passwordless
  state      String   // creating | needs_verification | active | exists_elsewhere | failed
  createdAt  DateTime @default(now())
  verifiedAt DateTime?
  lastUsedAt DateTime?
  error      String?
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, system, employer])
}
```

`User.applicationSecret String?` (AES-256-GCM of the application password) and `User.applicationSecretSetAt DateTime?`. The standing permission `create_employer_accounts` is an answer key (`bank_or_ask`, asked once), as `accept_acknowledgements` is.

### 4.4 State machine

As boards/TDD §4.4: `creating` → `active`, or `needs_verification` (the user verifies, then `active`), or `exists_elsewhere` (the user already had an account there: the window opens on Sign In for a person; nothing stored), or `failed` (one retry from create, then the application fails with the reason). A refused sign-in on an `active` account becomes `needs_verification` with a "Reset your password for Acme" card that links to the employer's own "Forgot password" page.

### 4.5 Sequence: an application on an account board

1. Swipe gate as today, plus the application password set and `create_employer_accounts` = Yes; without them the swipe is refused with "Workday needs an employer account: set it up in Account", nothing recorded.
2. The run opens the posting. Closed → "This job is closed", no account made (§3.3 C).
3. `accountStep`: `active` → sign in. None → write `creating`, then create (email, password twice, the employer's terms box only under `accept_acknowledgements`), `account_created` event. "Verify your email" on screen → `needs_verification`, run ends `needs_input` ("Verify your email for Acme, then press Done"). A code asked on screen → `requestCode` ("Darwinbox sent a code to your email for Acme"), typed, then `active`. "Account already exists" → `exists_elsewhere`, handoff. A check that stops the click → handoff.
4. The board's form, page by page, through `resolveForm` with sources, guess and send, sensitive keys from standing answers, EEO and disability "decline", resume upload (temp file deleted in `finally`).
5. Review: required-empty fields stop the run before Submit. `markAttempted`, Submit, the board's own confirmation or refusal, screenshot with password fields masked.
6. A later application at the same employer signs in; most pages are already filled by the employer's site.

### 4.6 Workday specifics

"Apply Manually" (never "Autofill with Resume": its parse runs on Workday's side and fills fields we then correct; one path is simpler to test). Pages are read from `data-automation-id` fields. My Experience: upload the resume, then work history and education rows from the resume as Keka's `history.ts` does. Self Identify (disability) is "I do not want to answer". The decoy field is left empty. Prior art first: the open-source Workday code listed in boards/TDD §12 (read, credited if ported).

### 4.7 Darwinbox specifics

Reader on the new app's `POST job/alljobs` (and the job detail call it makes), with the new `candidatev2` job links. Whether the reader works from GitHub Actions is the first thing to measure (fact 4: the old address now answers a command-line client with a challenge). Sign-up is email, password, confirm, terms box; then the code at sign-up through `requestCode`. Google and LinkedIn buttons are never pressed.

### 4.8 Security and privacy

- The application password is typed once by the user in Account, sent over HTTPS, encrypted at once, never returned except by "Show password" to the signed-in user, never logged, never in a screenshot (fields masked first), never in an event's text.
- `ACCOUNTS_KEY` (32 random bytes, base64) lives in the web app's and the worker's env only; never in GitHub Actions (reading jobs needs no secrets of users). Rotating it re-encrypts the rows in a script.
- A decrypted password is used only on the employer's own host (`formHost` of the board); the account step refuses any other host.
- CLAUDE.md's rule "we never ask for, type, store or log their password" is about the user's own passwords on signed-in sources. The application password is a different thing the owner approved (9 Nov); V1 adds that sentence to CLAUDE.md's hard rules and ARCHITECTURE in the same change.

### 4.9 Failures

| Failure | What happens |
|---|---|
| The employer refuses the password | `failed`, Needs you: "Acme's Workday needs a different password" |
| Verification mail never comes | The card stays; "Resend" opens a run that presses the employer's resend link |
| Wrong or expired code | `requestCode` once more; then the application fails, nothing sent |
| Check shows on the click | Handoff to a person at the screen; no screen → fails "needs a person at a computer", nothing sent |
| Session expires mid-form | Sign in again once; then retry the run (attempts as today) |
| Job closed | "This job is closed", no account, the swipe not charged |

### 4.10 Observability

Events `account_created`, `account_signin`, `account_verify_asked`, `account_failed` (no secrets in them). Per board in the board report: accounts made, verified within a day, applications sent, runs ended by a check.

### 4.11 Code map

| Path | Task |
|---|---|
| `prisma/schema.prisma`, migration `employer_accounts` | V1 |
| `src/modules/accounts/{index,vault,rules}.ts` | V1 |
| `src/app/(app)/account/*` (password, accounts list), `src/app/api/accounts/*` | V1 |
| `src/modules/apply/accountStep.ts`, `src/app/mock/account/*` | V2 |
| `src/modules/apply/adapters/workday.ts`, `apply/urls.ts`, `jobs/match.ts` `APPLY_BOARDS` | V4 |
| `src/modules/jobs/fetchers/darwinbox.ts`, `jobs/boards.ts` | V5 |
| `src/modules/apply/adapters/darwinbox.ts` | V6 |
| `src/modules/jobs/fetchers/successfactors.ts`, `apply/adapters/successfactors.ts` | V7 |

### 4.12 Env

`ACCOUNTS_KEY` (web and worker). Nothing else new.

## 5. UI

- Account → **Application password**: "Used only to create and sign in to employer accounts for you (Workday, Darwinbox, SuccessFactors). Use one you use nowhere else." The rule shown as the user types; Save; "Change" later (new accounts use the new one).
- Account → **Employer accounts**: one row per account: employer, system, state ("Ready", "Verify your email", "Already had an account", "Couldn't create"), created date, "Show password", "Open sign-in page".
- Needs you: "Verify your email for Acme" (Done), "Type the code Darwinbox sent for Acme" (the existing code sheet), "Acme's Workday needs a different password".
- First swipe on an account board without permission: a sheet explaining what an employer account is, with "Allow" (sets `create_employer_accounts`) and "Not now".

## 6. API

- `PUT /api/accounts/password` (set or change; rule checked on the server).
- `GET /api/accounts` (rows without secrets); `POST /api/accounts/{id}/reveal` (one password, to the signed-in owner, rate-limited).
- `POST /api/applications/{id}/verified` ("Done" after the email step: re-enqueues).

## 7. Testing

- `scripts/accounts-vault-test.ts`: encrypt and decrypt, wrong key fails, the rule, no secret in any event or log line.
- `/mock/account`: a sign-up, verify-link, sign-in and wizard flow on our own host, so the state machine is tested end to end with a test profile (the `/mock/*` rule, 9 Nov).
- Per board: offline fixtures for the reader and the form; dry runs (stop before Submit) on 3 employers hiring in India; one real application by the owner's profile; then `APPLY_BOARDS`.

## 8. Rollout

V1 and V2 first (nothing visible to users until a board is in the feed). Workday into `APPLY_BOARDS` after its real application and two days of reads; Darwinbox and SuccessFactors the same way, one board at a time. Each board's first week: a daily look at accounts made versus applications sent.

## 9. Risks

- **Employer terms:** some employers' sites forbid accounts made "by automated means" (7 Nov). Mitigation: the user's standing permission, the user's own email, the account visible to the user; a list of employers to skip if one objects.
- **Workday's checks tighten** and stop the worker's clicks: the board falls back to a person at the screen, which does not scale; measured in V4's dry runs.
- **Password reuse by users:** the screen says to use a new one; the rule makes reuse less likely, not impossible.
- **One leak opens many accounts:** the key is only in two envs, the vault is the only decrypter, reveal is rate-limited.
- **Verification fatigue:** a card per new employer. Measured; the automatic email step (boards/TDD M9) stays the owner's call.

## 10. Tasks

[docs/accounts/TASKS.md](TASKS.md): U1–V8.

## 11. Decisions to close with the owner

1. Order Workday → Darwinbox → SuccessFactors (§3.2).
2. Fresh Workday jobs: read from the laptop worker after the GitHub test, plus the closed-job check in every run (§3.3).
3. Application password rule: 12 characters, upper and lower case, a digit and a symbol (§3.1).
4. Email step stays manual (9 Nov) — confirmed again for this phase.
5. No Google or LinkedIn sign-in on employer sites (§1).

## 12. Sources

Live checks on 21 Nov: Cotality's Workday careers site (Apply, Apply Manually, Create Account) and Airtel's Darwinbox careers site (job list, job page, Sign In, Sign Up), in a browser, nothing submitted. Earlier research: boards/TDD.md §2 (facts 10–13, 7 Nov) and §12 (open-source references).
