# Phase I — Greenhouse end to end, fresh jobs and the retention hook (owner, 11 Oct)

Full entries of this phase. The index is [docs/TASKS.md](../TASKS.md). Status is marked here first, then on the index line.


Decision: make Greenhouse work end to end first (fetch → match → alert → apply); the same framework then takes Lever and Ashby (their fetchers already exist; their adapters need the captcha handoff).

<a id="t86"></a>
### [x] T86 — Application reliability on Greenhouse
Do: from the week's failures (57 submitted, 30 failed of 87 real runs): work history and education from the resume, number boxes, schools, country of residence, re-ask unmatched answers.
**Done when:** dry runs on the forms that failed pass or ask instead of failing.
Done 11 Oct: Stripe Revenue and Scale AI New Grad pass (not submitted); Coinbase asks 8 questions instead of 17 and asks its school from the list. Left: re-measure the success rate on a week of real runs (target 90% of runs that start).

<a id="t87"></a>
### [x] T87 — New-match alerts by browser push
Do: Web Push subscription from the Notifications switch, `sw.js`, `/api/push`, `lib/push.ts`; after each ingest one push per user with new Strong / Good matches; "needs you" pushed too; "New" on fresh cards.
**Done when:** a real browser subscribes, shows a server push and a new-match push, and the same jobs are not alerted twice.
Done 11 Oct: `push-smoke` PASS in Chrome (Google's push service); Edge and Chromium subscribe too.

<a id="t88"></a>
### [~] T88 — Always-on worker
Do: run `npm run worker` on a host (Railway, Render or a VM); an application cut off by a restart picks up again instead of failing (11 of the week's 30 failures).
**Done when:** ingest runs every 3 hours for a week with the laptop off, and no application fails with "the worker stopped".
Progress 11 Oct: deploy-ready, not yet deployed (the owner picks the host). A run cut off before Submit is picked up again (`queue-smoke` PASS); `/api/health` with the worker heartbeat (200, worker up); `Dockerfile.worker`, `.env.example`, `npm run worker:prod`, `docs/DEPLOY.md` updated; `npm run build` passes. The image build was not run (Docker Desktop was not running).

<a id="t89"></a>
### [x] T89 — Company list grows by itself
Do: a weekly discovery job on a growing candidate list; companies on Greenhouse with India or remote jobs go to a review list (or are added by a rule, e.g. 3+ India jobs); companies failing or posting nothing for 60 days are switched off.
**Done when:** a week's run adds reviewed companies without a manual batch.
Done 11 Oct (the rule adds; no review step): daily `discover` job, near-miss re-checks, model names, dead companies switched off. Honest yield: the model knows few unchecked names (0-2 a day) and no near miss passed yet, so the list grows slowly; Greenhouse in India is about 100-150 companies and we fetch 100. The next big step for supply is the Lever and Ashby boards.

<a id="t90"></a>
### [x] T90 — End-to-end check of the Greenhouse pipeline (11 Oct)
Ingest of 118 companies 88 s, 0 failed, new jobs embedded; 9 feeds warmed in 88 s; `/api/health` 200; `push-smoke` PASS (real Chrome); dry runs on 12 forms from 12 companies (Bangalore profile, not submitted): 10 fill everything they can and stop only for the user's own answers; Elastic and IMC ask Discipline once from the form's list (Greenhouse has no "Information Technology"; the agent does not pick a nearby subject for the user).
