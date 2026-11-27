# Phase K tasks K16–K19 — Hirist on the Naukri pattern

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) lists these one line each. Mark `[~]` / `[x]` here first, then on the root line. Order K16 → K17 → K18 → K19.

<a id="k16"></a>
### [x] K16 — Site drivers: the Naukri seams behind one interface
Do: `apply/sites/read.ts` (shared `readCall`, `PageRead`, `PageStop`), `apply/sites/drivers.ts` (`SiteDriver`, `driverOf`), `jobs/fetchers/siteListing.ts` (`SiteListing`, `applyKind: site | board | none`), `lib/site-flags.ts` (`siteOn(site, feed | apply | reader)`); the reader, per-user ingest, connect, relay, gate, runner, queue, pool and match code go through them. No behaviour change.
Design: [4.1 Site drivers](TDD.md#41-site-drivers) · [4.5 Env](TDD.md#45-env).
**Done when:** `naukri-reader-test`, `naukri-listing-test`, `naukri-adapter-test` and `naukri-lean-test` print PASS unchanged, with `site-flags-test` PASS; typecheck and lint pass.
Done 27 Nov: the four Naukri checks, `site-flags-test` and `feed-sql-test` PASS; typecheck and lint clean. `drivers.ts` (reader and login of a site), `read.ts` (shared page read), `siteListing.ts` (`SiteListing`, `applyKind` "naukri" is now "site"), `siteSearches.ts` (pure planners), `site-flags.ts` (`ENABLE_<SITE>`, `ENABLE_<SITE>_APPLY`, `<SITE>_READER`; `sharedReaderOn(site)`, `sharedReaders` in the overview). Apply stays Naukri's until K19.

<a id="k17"></a>
### [ ] K17 — Hirist reader
Do: `hirist` in `SITES`/`SITE_INFO`, a `boards.ts` entry, `lean.ts`, `jobs/fetchers/hirist.ts`, the reader part of `apply/sites/hirist.ts`, `shared_readers.hirist` in `config/rules.json`, company buckets for Hirist from the approved list; a probe window first for the page's own call URLs and JSON keys.
Design: [2 Facts](TDD.md#2-facts-the-design-rests-on-27-nov-2026) · [4.2 Reading](TDD.md#42-reading-as-naukri-1317).
**Done when:** `hirist-listing-test` and `hirist-reader-test` PASS; one live window in the screen image stores Hirist jobs and records its `ReaderRun` (proxy bytes in the Done line); Hirist jobs show to a connected test user and not to an unconnected one.

<a id="k18"></a>
### [ ] K18 — Hirist connect: email or mobile + OTP, streamed
Do: the login part of `apply/sites/hirist.ts` (`sendCode`, `enterCode`, signed-in detection), the relay and `login-number.ts` taking an email or a mobile, the Account card copy by site.
Design: [4.3 Connect](TDD.md#43-connect-as-naukri-1316).
**Done when:** `hirist-connect-smoke` PASS on a mock login page; the owner's real code connect leaves the connection `connected` with the session sealed; the worker log holds no code, number, email or page content.

<a id="k19"></a>
### [ ] K19 — Hirist apply
Do: `apply/sites/hiristApply.ts` (job page state, Apply, screening answered by the answer engine, Hirist's reply), `app/mock/hirist`, `urls.ts` mock paths, routing to `apply-site`, `signed_in_sources.hirist` in `config/rules.json`.
Design: [4.4 Apply](TDD.md#44-apply-as-naukri-k4).
**Done when:** `hirist-mock-smoke` PASS (test profile, mock page, sent); a dry run on 3 real jobs presses nothing and reads each form; the owner's first real apply is sent, then `ENABLE_HIRIST_APPLY=1`.
