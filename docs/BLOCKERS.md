# Blockers

## M12 Workable: Turnstile fails the worker's browser (11 Nov 2026) — resolved 17 Nov

- **Error:** the worker's Submit on a Workable form reached Cloudflare's "Verify you are human"; three ticks by the owner each failed, nothing sent.
- **Resolved:** in the stealthy Chrome (SeleniumBase UC + CDP, ARCHITECTURE 6.21) Turnstile stayed silent and the worker's own Submit sent 7 of 7 Workable forms (17 Nov).

## M7 SmartRecruiters: DataDome blocks the worker's browser (10 Nov 2026) — lifted 17 Nov

- **Retest 17 Nov** (`scripts/_sr-check.ts`, read only): in the stealthy Chrome (ARCHITECTURE 6.21) the job pages and the Easy Apply forms of Miratech, WNS and Dr Reddy's all loaded, 20 to 29 fields each, no block page and no DataDome frame. The adapter can be built.

- **Error:** opening the Easy apply form (`jobs.smartrecruiters.com/oneclick-ui/company/{c}/publication/{uuid}`) from Playwright shows SmartRecruiters' "Access is temporarily restricted" page ("We detected unusual activity…"). It is a block, not a challenge: there is nothing on it a person can complete, so a handoff does not help.
- **Tried:**
  1. Playwright's headless Chromium (the worker's `main` browser): blocked.
  2. The visible Google Chrome window (`openBrowser(..., { window: true })`, the Ashby route the owner chose): blocked, from the same IP right after.
- **Not blocked:** the same form in an ordinary browser on the same IP loads and works. The job page and the Posting API (`api.smartrecruiters.com`) are never blocked.
- **Ways forward, for the owner:**
  1. SmartRecruiters' own Application API (apply through the API with a partner key from SmartRecruiters, no browser).
  2. One more visible-window try after the restriction lapses: if it loads, the plan is unchanged.
  3. Park M7 and go on to M12 (Workable).

