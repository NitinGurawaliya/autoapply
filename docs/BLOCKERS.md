# Blockers

## M7 SmartRecruiters: DataDome blocks the worker's browser (10 Nov 2026)

- **Error:** opening the Easy apply form (`jobs.smartrecruiters.com/oneclick-ui/company/{c}/publication/{uuid}`) from Playwright shows SmartRecruiters' "Access is temporarily restricted" page ("We detected unusual activity…"). It is a block, not a challenge: there is nothing on it a person can complete, so a handoff does not help.
- **Tried:**
  1. Playwright's headless Chromium (the worker's `main` browser): blocked.
  2. The visible Google Chrome window (`openBrowser(..., { window: true })`, the Ashby route the owner chose): blocked, from the same IP right after.
- **Not blocked:** the same form in an ordinary browser on the same IP loads and works. The job page and the Posting API (`api.smartrecruiters.com`) are never blocked.
- **Best guess:** DataDome scores the automation itself (Playwright's control of the browser), and the first headless hit may have flagged the IP for a while. Hiding the automation would be bot-check evasion, which we never do.
- **Ways forward, for the owner:**
  1. SmartRecruiters' own Application API (apply through the API with a partner key from SmartRecruiters, no browser).
  2. One more visible-window try after the restriction lapses: if it loads, the plan is unchanged.
  3. Park M7 and go on to M12 (Workable).
