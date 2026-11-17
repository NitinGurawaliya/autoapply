# Stealthy browser: SeleniumBase Chrome driven by Playwright

Built and measured 17 Nov 2026 (owner's override, Nitin's account). This is the record so the behaviour is not re-derived.

## What it is

Every browser the worker opens (main, handoff and window kinds, every board) is a real Google Chrome started by
SeleniumBase in CDP Mode, with Playwright attached to the DevTools endpoint SeleniumBase reports. The page sees a person's
Chrome: `navigator.webdriver` is false, the user agent is the installed Chrome's, browserscan.net's bot-detection page
rates it "Normal" with Playwright attached, and Workable's Turnstile, Ashby's spam check and Greenhouse's reCAPTCHA did
not fire on any run.

Since the afternoon of 17 Nov the launcher follows SeleniumBase's own `examples/cdp_mode/playwright` pattern
(`sb_cdp.Chrome()` → `get_endpoint_url()` → `connect_over_cdp` → `contexts[0].pages[0]`): pure CDP Mode, no chromedriver
and no `uc_driver.exe` at all (the orphaned-driver problem of the UC-mode launcher is gone by construction), SeleniumBase
picks the port, and the form is opened through `sb.goto` (its ReadMe: stealthier than Playwright's goto). The UC-mode
path (`SB(uc=True)` + `activate_cdp_mode` on `--port`) stays as the fallback for a SeleniumBase without `sb_cdp`.

- `scripts/seleniumbase_cdp_launcher.py [--port N] [--profile DIR] [url]`: starts Chrome on about:blank, prints
  `READY <endpoint url>`, then serves one command per stdin line, each answered with `OK <CMD>` or `ERR <CMD> <reason>`:
  `GOTO <url>`, `FRONT`, `PING`, `QUIT` (EOF does the same; `sb.quit()` closes Chrome). Nothing solves or clicks a
  challenge: one that appears goes to a person (no `CAPTCHA` command, owner's rule).
- `src/modules/apply/real-browser.ts`: `openStealthyBrowser(url, owner, { savedState })` spawns the launcher, waits for
  READY (STEALTHY_READY_MS, default 90 s), `chromium.connectOverCDP(endpoint)`, restores the owner's saved cookies on the
  blank tab, sends `GOTO <url>` (Playwright's goto only if the launcher cannot), and returns `{ context, page, command,
  close }`. `close` sends QUIT, waits for SeleniumBase to quit Chrome, asks Chrome over CDP (`Browser.close`) if it is
  somehow still up, disconnects, and `taskkill /T` the launcher's tree if it lingers. Every launch, attach, failure and
  close is appended at once to `stealthy-browser.log` (STEALTHY_LOG) in the worker's folder, because the console pipe
  buffers; the line's `#n` is the session number in that worker process.
- `src/modules/apply/stealthy-browser.ts`: re-export shim (browser.ts imports `./stealthy-browser`).
- `src/modules/apply/browser.ts` `openBrowser`: stealthy first, for every kind of run. Saved state is loaded before and saved
  after, as for the Playwright browser.

## Env

| Variable | Default | Meaning |
|---|---|---|
| `STEALTHY_BROWSER` | `1` | `0` or `false`: the Playwright browser as before |
| `STEALTHY_FALLBACK` | off | `1`: when the stealthy Chrome cannot start, open the Playwright browser instead of retrying the run |
| `STEALTHY_PYTHON` | `python` | Python with `seleniumbase` installed (4.58 on the laptop, Python 3.14) |
| `STEALTHY_READY_MS` | `90000` | launch timeout |
| `SELENIUM_CDP_PORT` | free port | fix the DevTools port (one run at a time only) |
| `STEALTHY_LOG` | `./stealthy-browser.log` | the launch log |
| `ASHBY_AUTO_SUBMIT` | off | `1`: the worker presses Ashby's Submit itself (passes in the stealthy Chrome) |

Lever stays off (`ENABLE_LEVER` unset): its hCaptcha shows a puzzle whatever the browser, and the one run with the puzzle
solved by hand still ended "not sent".

## Results, 17 Nov

Nitin's account, each run through the stealthy Chrome unless noted. "Worker Submit" means no human step.

| Board | Job | Outcome |
|---|---|---|
| Workable | learnrush React Developer | submitted, worker Submit, Turnstile silent |
| Workable | Botsync SDE-I | submitted (201), worker Submit |
| Workable | huzzle Fullstack | submitted (201), worker Submit |
| Workable | Zyte Data QA | submitted (201) on retry after the dropdown fix (first attempts: "English Level" kept "") |
| Workable | smartstream SE | failed: "Title" box never took a value (adapter; ran on the Docker worker) |
| Workable | docyt Associate PE | submitted on retry after the number-box fix (first two attempts: "years of Java 17" box kept "1.5") |
| Ashby | AiPrise SE I Frontend | submitted, worker Submit |
| Ashby | AiPrise SE I Full Stack | submitted, person pressed Submit |
| Ashby | Kandou AI EDA/CAD | submitted, person pressed Submit (ASHBY_AUTO_SUBMIT was off) |
| Ashby | secfix GTM Engineer | failed: form requires a video link |
| Ashby | secfix Backend | failed: marked not sent after the check |
| Ashby | ElevenLabs Full-Stack | refused by Ashby: same-domain application within 90 days |
| Greenhouse | Capco Full Stack | submitted on attempt 2 (attempt 1: react-select option intercepted a click) |
| Greenhouse | Commvault SE Python | submitted, worker Submit, reCAPTCHA silent |
| Greenhouse | GitLab SE Delivery | submitted, but on the Docker worker's Playwright Chrome |
| Greenhouse | deepintent SE in Test | submitted, worker Submit, first run on the pure-CDP launcher (15:01, 40 s from launch to sent) |
| Zoho Recruit | Quicko Full Stack | submitted (200) after a person typed Zoho's image CAPTCHA |
| Keka | cloudkaptan Apprentice | submitted, worker Submit, no image CAPTCHA |
| Lever | Entrata SE | hCaptcha puzzle; solved by hand, still not sent |

Before the stealthy Chrome, the same day: 5 of 5 Workable runs stuck at Turnstile in the Playwright Chrome, 0 sent.

## Operating rules

1. One worker on the queue. The Docker container `swipeapply-worker` (WorkerBeat id `laptop-docker`) runs the old code
   and takes jobs from the same pg-boss queue; its Playwright Chrome shows through WSLg as a light, classic-framed window.
   `docker ps` and the WorkerBeat table (`scripts/_nitin-workers.ts`) before any run; `docker stop swipeapply-worker`
   once nothing is inspecting or filling.
2. Which browser a run used is read from `stealthy-browser.log`, never from how the window looks.
3. A stopped worker leaves its runs to the reaper: a form a person then submits by hand shows as pending verification;
   confirm it in the app rather than retrying.
4. Python and SeleniumBase must be installed where the worker runs; the first launch downloads a matching uc_driver.

## Smoke check

```
npx tsx scripts/_stealthy-smoke.ts <form url>
```

PASS prints the page title, `navigator.webdriver: false`, the launcher's PING reply, a second navigation through
`GOTO` to browserscan.net's bot-detection page with its verdict ("Normal"), and the attach time (10 to 12 s on the
laptop with the pure-CDP launcher; the UC-mode one took 9 to 20 s plus a one-time driver download).

## Workable: closed 17 Nov

Real applications through the stealthy Chrome, worker Submit, no human step: 7 sent (learnrush, Botsync, huzzle,
docyt, Zyte Data QA, Zyte AI Tooling, pavago). Turnstile never fired. Nitin's matching Workable jobs are used up:
governance blocked 4 more picks on `min_match_score`, as it should.

Field types on 59 live India forms (all / required): text 316/226, paragraph 137/64, dropdown 134/122, file 92/42,
group 81/0, email 59/59, phone 59/52, number 58/58, boolean 54/54, multiple 14/12, date 6/6. No type the adapter does
not map; required photo uploads and required groups are asked, never guessed.

Fixes in `src/modules/apply/adapters/workable.ts`:
- `type: "number"` questions are text boxes that drop non-digits: typed as a bare number (`numberText`: first number,
  Indian commas, LPA/lakhs to rupees, none/NA/fresher/immediate as 0). docyt went through after it.
- `type: "dropdown"` questions are a read-only combobox over a listbox: picked from the list (`fillDropdown`), centred
  first (a list under the sticky "Overview / Application" bar lost its click), DOM click as the last resort. The keyboard
  does not pick on Workable (ArrowDown does not move the highlight; Enter moves focus to the first field). Zyte went
  through after it.
- `src/modules/apply/guess.ts`: a list of salutations (Mr, Ms, Mrs, Miss, Mx) is never guessed, as gender is not.

No-submit fill check (`scripts/_workable-fillcheck.ts`: fake values, every non-file field, read back, never Submit),
11 forms covering every type: 221 of 221 fields took their value (text 105, select 38, radio 33, textarea 21, number 18,
checkbox list 3, date 3). The DOM-click fallback alone (`scripts/_dropdown-keys-check.ts`): 20 of 20 dropdowns.

Launcher fix found on the way: leaving SeleniumBase's `with SB` block left one orphaned `uc_driver.exe` per launch (13 in
a morning) and kept a Node script from exiting. The launcher now kills its own process tree on QUIT or EOF and exits at
once; after 14 launches, 0 drivers remain.

## Open adapter issues seen on these runs (not browser issues)

- Greenhouse: an open react-select option list intercepts the click on the next field.
- Guess module: huzzle went out with "monthly salary expectations in USD" 80000 and "previous monthly salary" 6.
