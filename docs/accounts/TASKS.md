# Phase U — Boards that need an account: tasks

Design: [docs/accounts/TDD.md](TDD.md). Order U1 → U2 → U3 → U4, then U5 → U6, then U7. U8 only on numbers. Replaces Phase M's M5, M6, M8, M10 and M15 for applying.

<a id="u1"></a>
### [~] U1 — Vault, application password, permission
Do:
- `EmployerAccount` model, `User.applicationSecret` / `applicationSecretSetAt`, migration `employer_accounts` (applied with `migrate deploy`, never `migrate dev` against Neon).
- `src/modules/accounts/{index,vault,rules}.ts`: AES-256-GCM with `ACCOUNTS_KEY`; the rule (12+, upper, lower, digit, symbol); `accountFor`, `recordAccount`, state changes; the only module that decrypts.
- `create_employer_accounts` answer key (`bank_or_ask`).
- Account screen: "Application password" and "Employer accounts" (UI rules, `ui-craft` skill); `PUT /api/accounts/password`, `GET /api/accounts`, `POST /api/accounts/{id}/reveal` (rate-limited).
- CLAUDE.md hard rules and ARCHITECTURE §11 (env) and a new §6.x: the application password, what it is and is not.
Design: [4.1](TDD.md#41-components) · [4.3](TDD.md#43-data-model) · [4.8](TDD.md#48-security-and-privacy) · [5](TDD.md#5-ui) · [6](TDD.md#6-api).
**Done when:**
- `scripts/accounts-vault-test.ts` PASS: round trip, wrong key fails, the rule's cases, no secret in events or logs.
- On the dev server: set, change and reveal a password; the accounts list shows rows from a seeded fixture; light and dark at 390 px.
- Typecheck and lint pass.

<a id="u2"></a>
### [~] U2 — The account step and a mock account board
Do:
- `src/modules/apply/accountStep.ts`: sign in, create, verify card, code through `requestCode`, `exists_elsewhere` handoff, password fields masked before any screenshot, events `account_created`, `account_signin`, `account_verify_asked`, `account_failed`.
- The swipe gate: an account board needs the password set and `create_employer_accounts` = Yes; the permission sheet in the feed.
- `POST /api/applications/{id}/verified` and the "Verify your email for Acme" card with Done.
- `/mock/account`: sign-up, a verify link, sign-in and a two-page form on our own host, for test profiles.
Design: [4.4](TDD.md#44-state-machine) · [4.5](TDD.md#45-sequence-an-application-on-an-account-board) · [4.9](TDD.md#49-failures).
**Done when:**
- A test profile's swipe on a mock account job: account created → verify card → Done → signed in → submitted; a second job signs in without creating; a refused password ends with its Needs-you line. Events listed in the run.
- No password in any event, log line or screenshot of those runs (checked by a script over the run's events and the screenshot's masked fields).
- Typecheck and lint pass.

<a id="u3"></a>
### [ ] U3 — Workday jobs fresh again
Do:
- After the GitHub-only reading test ends: Workday read from the laptop worker only (a home connection), at the gentle pace (`GENTLE_BOARDS`), every other board still on GitHub Actions. A worker switch for "gentle boards only" (`INGEST_BOARDS=workday` or similar) so the laptop does not read the rest.
- Reactivate the paused Workday companies in batches; a refused read keeps a company's tier (as today).
- The closed-job check at the start of every apply run (all boards): the posting is gone → "This job is closed", nothing made, the swipe not charged.
Design: [3.3](TDD.md#33-fresh-workday-jobs) · [2 fact 3](TDD.md#2-facts-the-design-rests-on).
**Done when:**
- Two days of Workday reads from the laptop: companies read, refused reads under 5%, India jobs open after the reads versus 5,400 before.
- A run on a closed Workday posting ends "This job is closed" with no account step.
- Typecheck and lint pass.

<a id="u4"></a>
### [~] U4 — Workday apply
Do: first read the open-source Workday code (boards/TDD §12) and note what to port, credited.
- `adapters/workday.ts`: Apply Manually; `accountStep`; My Information, My Experience (resume upload, work and education rows from the resume), Application Questions, Voluntary Disclosures ("I do not wish to answer"), Self Identify ("I do not want to answer"), Review; the decoy field never filled; Submit; Workday's confirmation or refusal.
- Hosts in `apply/urls.ts`; Workday into `APPLY_BOARDS` only after the checks below.
Design: [4.5](TDD.md#45-sequence-an-application-on-an-account-board) · [4.6](TDD.md#46-workday-specifics) · [3.4](TDD.md#34-bot-checks).
**Done when:**
- Dry runs (stop before Submit) on 3 Workday employers hiring in India pass every page with no required field empty.
- One real application by the owner's profile: account created, email verified by the owner, submitted, Workday's confirmation on screen.
- A second job at the same employer signs in and submits.
- Typecheck and lint pass.

<a id="u5"></a>
### [ ] U5 — Darwinbox reader
Do:
- `fetchers/darwinbox.ts` on the new app's `POST /ms/candidateapi/job/alljobs?companyId=…` and its job detail call; the `candidatev2` job links; board entry (India-only storage, `*.darwinbox.in`); seeds from M3's lists.
- Measure whether GitHub Actions can read it (fact 4); if not, Darwinbox joins Workday on the laptop's gentle reads (U3).
Design: [4.7](TDD.md#47-darwinbox-specifics).
**Done when:**
- `scripts/darwinbox-test.ts` PASS on saved fixtures; a live read of 20 Darwinbox companies stores their India jobs; where it runs from is recorded.
- Typecheck and lint pass.

<a id="u6"></a>
### [ ] U6 — Darwinbox apply
Do:
- `adapters/darwinbox.ts`: Sign In or Sign Up (email, password, confirm, terms box under `accept_acknowledgements`), the sign-up code through `requestCode`, never the Google or LinkedIn buttons; the application form; Submit; Darwinbox's confirmation.
- Into `APPLY_BOARDS` after the checks below.
Design: [4.5](TDD.md#45-sequence-an-application-on-an-account-board) · [4.7](TDD.md#47-darwinbox-specifics) · [3.4](TDD.md#34-bot-checks).
**Done when:**
- Dry runs on 3 Darwinbox employers; how often Turnstile stopped the worker's click recorded.
- One real application by the owner's profile, submitted.
- Typecheck and lint pass.

<a id="u7"></a>
### [ ] U7 — SuccessFactors
Do: first read ats-scrapers' SuccessFactors reader (MIT) for fetch logic to port, credited.
- `fetchers/successfactors.ts` (career-site sitemap and RSS), board entry, seeds; `adapters/successfactors.ts` with `accountStep` (password rules and the email step vary per company: link, code or none; a CAPTCHA, if on, goes to a person).
Design: [3.2](TDD.md#32-order-of-the-boards) · [2 fact 6](TDD.md#2-facts-the-design-rests-on).
**Done when:**
- Reader on 10 companies; dry runs on 3; one real application; into `APPLY_BOARDS`.
- Typecheck and lint pass.

<a id="u8"></a>
### [ ] U8 — iCIMS (only on numbers)
Do: only if the board report shows Indian employers on iCIMS worth it: a reader for Jibe-built sites, then an adapter with `accountStep`. Its invisible hCaptcha on the email step goes to a person.
Design: [3.2](TDD.md#32-order-of-the-boards).
**Done when:** the decision is recorded with the numbers, and, if built, the same checks as U7.
