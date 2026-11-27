# Phase X tasks: a feed that shows what fits, explains what doesn't, and uses companies

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) lists each task on one line. Mark `[~]` / `[x]`
here first, then on the root line. Order: X1 → X2 → X3 → X4 → X5 → X6.

<a id="x1"></a>
### [x] X1 — No dead end after today's picks
**Do:** `src/app/(app)/feed/swipe-deck.tsx` (`DayDone`, caught-up state) and `page.tsx`: "Keep going: N more that
match you" → `?rest=1`; an empty daily set opens the ranked list; `scripts/feed-funnel.ts --email` (read-only).
**Design:** [2 Facts](TDD.md#2-facts-the-design-rests-on-code-and-data-27-nov) · [5 UI](TDD.md#5-ui).
**Done when:** the funnel prints Nitin's stages; after today's set the deck offers the rest with its count and opens it;
typecheck and lint pass.

Done 27 Nov: `feed-funnel.ts` for Nitin: 23,246 recent India jobs, 5,113 in his fields, 805 within years and level, 772 close, 285 swiped, 487 left before the model and the floor; 7 empty daily sets in 7 days. `DayDone` counts `/api/jobs?rest=1` and offers "Keep going: N more that match you"; it shows only where `DAILY_SET=1` (off locally), so the screen itself is checked in production. Nitin, with no set, gets All jobs (X3).

<a id="x2"></a>
### [ ] X2 — One judgement of a job against the profile
**Do:** `src/modules/jobs/profile-fit.ts` (`profileFit`), `scripts/profile-fit-test.ts`.
**Design:** [4.2 profileFit](TDD.md#42-profilefit-one-judgement-of-a-job-against-a-profile).
**Done when:** `profile-fit-test` PASS (each reason; matches only within the rules and at 40+); typecheck and lint pass.

<a id="x3"></a>
### [ ] X3 — All jobs in the feed
**Do:** `browseJobs` in `match.ts`; the switch, list, filters and sort in `src/app/(app)/feed/`; `lib/feed-url.ts`;
`api/jobs/route.ts`; `scripts/feed-browse-test.ts`; ARCHITECTURE §6.3.
**Design:** [4.3 All jobs](TDD.md#43-all-jobs-browsejobs) · [5 UI](TDD.md#5-ui) · [6 API](TDD.md#6-api).
**Done when:** `feed-browse-test` PASS (past the 5 cap; widening brings jobs in labelled with the right reason and no
Apply; role text; skipped); Nitin's All jobs inside his profile lists the candidates ranked; `feed-sql-test` PASS.

<a id="x4"></a>
### [ ] X4 — Company page: matching jobs first
**Do:** `employer-pages.ts`, `app/companies/[slug]/page.tsx`, `job-cards.tsx`; `company-pages-smoke.ts` extended.
**Design:** [4.4 Company page](TDD.md#44-company-page-signed-in).
**Done when:** signed in, "Matches your profile" comes first with Apply and the others show a reason and no Apply;
signed out unchanged; smoke PASS.

<a id="x5"></a>
### [ ] X5 — Apply to all that fit
**Do:** `src/app/companies/actions.ts` (`applyToMatching`), the confirm sheet; `scripts/apply-matching-test.ts`;
ARCHITECTURE §6.9.
**Design:** [4.5 Apply to all](TDD.md#45-apply-to-all-that-fit).
**Done when:** on mock jobs with a test profile it applies best first and stops at the weekly company cap with the
message; events written; `guards-test` PASS.

<a id="x6"></a>
### [ ] X6 — The employer in the feed
**Do:** "N more roles here match you" on the job page and card; at most 2 jobs per employer in today's set (`daily.ts`).
**Design:** [4.6 Employer in the feed](TDD.md#46-employer-in-the-feed).
**Done when:** a test shows the set takes at most 2 per employer; the job page shows the count and link;
`feed-dedupe-test` PASS.
