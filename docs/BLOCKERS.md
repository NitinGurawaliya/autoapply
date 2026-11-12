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

## M12 Workable: Cloudflare Turnstile fails the worker's browser, even for a person (12 Nov 2026)

- **Error:** after the worker's Submit, Workable shows Cloudflare's "Verify you are human" box and holds the form at "Submitting...". Nitin's Lokal application, a visible Chrome window on the laptop worker: the owner ticked it three times, and each tick failed and the box came back. Nothing was sent; the run was cancelled.
- **Tried:**
  1. The worker's own Submit (form filled: all 9 fields, resume uploaded).
  2. A person ticking the box in the same window (the Ashby hand-over, which passes reCAPTCHA 6 of 6).
- **Not blocked:** the same form in an ordinary browser loads with Submit enabled and no box at load.
- **Best guess:** Turnstile scores the automation itself (Playwright's control of Chrome), so no tick in that window can pass. Hiding the automation would be bot-check evasion, which we never do.
- **Ways forward, for the owner:**
  1. Workable as a board we read but do not apply to (as Workday today), its jobs out of the feed.
  2. A hand-over to the user's own browser: the agent prepares every answer, and the person opens the form in their usual Chrome and submits.
  3. Workable's partner API (applications through the API with the employer's or a partner token): no browser, needs an agreement.
