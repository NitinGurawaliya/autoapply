# A feed that shows what fits, explains what doesn't, and uses companies — technical design (Phase X)

Version 1, 27 Nov 2026. The owner, 27 Nov: the feed "shows 5 by 5 jobs, changing the filter doesn't change much, it
just shows new jobs only" (Nitin's account). This design keeps today's picks strict (T107, Phase R) and adds what was
missing: a way to see every job, an honest reason when a job doesn't fit, and the employer layer (Phase W) used in the
feed. ARCHITECTURE stays the source of truth: X3 updates §6.3, X5 §6.9.

---

## 1. Goals and non-goals

**Goals**
- G1. No dead end: after today's picks, the person can keep going through every other job that fits them.
- G2. "All jobs": a list of every open job, with filters that really change the results (role text, experience,
  field, place, company type, posted, pay stated, skipped), sorted by match or by newest.
- G3. Every job is judged against the profile the same way everywhere: a match score and, when it doesn't match, the
  plain reason (asks more years, a level above, outside your fields, a kind you said never, missing skills).
- G4. A job that doesn't match the profile has no Apply: "a user only applies to a job that matches their profile".
- G5. On a company page, signed in, the jobs that match come first, with "Apply to all that fit".
- G6. The feed uses the employer: "N more roles here match you" and variety in today's picks.

**Non-goals**
- Loosening today's picks (the 65 floor, T107's band, level and field rules stay).
- Non-tech fields (the follow-on of docs/employers/TDD.md §12).
- Following companies, saved searches, alerts.
- A second matching engine: everything uses `match.ts` scoring and the governance rules as they are.

---

## 2. Facts the design rests on (code and data, 27 Nov)

Nitin's pool (read-only SQL): 23,252 open India jobs on our boards in 60 days → 5,113 in his fields → 805 within his
years + 1 and level → **491** close to his resume and not swiped → the 150 closest get a model verdict → the cards at
65+ → **5** shown (`FEED_FLOOR_MIN`). His daily set has been empty since 20 Nov (fewer than 12 qualify).

Code (`src/modules/jobs/match.ts` unless named):
- `feedRows` (SQL, :771-798): boards, places, level filter, `experienceMin <= yearsReach(years)` (:784), stated level in
  `levelsFor(years)` (:785), company type, `jobGate` (tracks, kinds, "Never show me"), similarity ≥ 0.35, posted within
  `days`, open, not swiped.
- Only the `SHORTLIST` (150) closest get a verdict; a job with a vector outside it is dropped (:980).
- `scoreJob` (:549-617) gives 0 for a "no" verdict, closeness under 0.35, or under 0.45 with no verdict.
- `applyFeedFloor` (:338-357): cards ≥ 65 (`FEED_FLOOR`), topped up to 5 (`FEED_FLOOR_MIN`); `FEED_SIZE` 40.
- Filters mostly narrow: tracks pick among the profile's own, `expMax` cannot pass years + 1, level and company type
  narrow; only Location (US, Other) widens.
- `?rest=1` ("keep going past today's set") is handled (`feed/page.tsx:143`, `api/jobs/route.ts:22`) but nothing
  links to it; `DayDone` (`swipe-deck.tsx:539-574`) offers only "See applications".
- `swipeRight` (`modules/apply/lifecycle.ts:173`) applies to any open job on a supported board, through
  `check("swipe_right")`: duplicate role, `max_per_company_per_week` (3), `max_in_flight` (25), `min_match_score` (40).
- The company page (`employer-pages.ts employerPage`) already lists an employer's open public jobs with departments.

---

## 3. Options and decision

| Option | Verdict |
|---|---|
| Loosen today's picks (lower the floor, widen the band) | No: the owner chose "fewer cards instead of wrong ones" (20 Nov) |
| A separate search page or job board | No: a second system, and it would show jobs without saying whether they fit |
| **Keep picks strict; add "Keep going" and an "All jobs" mode inside the feed, judged by one `profileFit`** | **Chosen** |

Owner, 27 Nov: All jobs may show jobs past the profile, but says plainly that they don't match and why, and offers no
Apply on them. The company page shows the matching jobs first, with "Apply to all that fit".

---

## 4. Architecture

### 4.1 Components

| File | Holds | Task |
|---|---|---|
| `src/app/(app)/feed/swipe-deck.tsx`, `page.tsx` | "Keep going" from the end of today's set and from an empty set | X1 |
| `src/modules/jobs/profile-fit.ts` | `profileFit(job, profile)`: match, score, reasons | X2 |
| `src/modules/jobs/match.ts` | `browseJobs(userId, filters, page)` | X3 |
| `src/app/(app)/feed/` (switch, list, filters), `src/lib/feed-url.ts`, `src/app/api/jobs/route.ts` | All jobs mode | X3 |
| `src/app/companies/[slug]/page.tsx`, `employer-pages.ts`, `job-cards.tsx` | matching group first | X4 |
| `src/app/companies/actions.ts` (new), confirm sheet | Apply to all that fit | X5 |
| feed card, `jobs/[id]`, `daily.ts` | "N more roles here match you", variety | X6 |

### 4.2 `profileFit`: one judgement of a job against a profile

`profileFit(job, profile, verdict?) → { matches, score, reasons }`, pure. Reasons come from the rules that already
exist, in this order, each one short:

| Rule (existing) | Reason |
|---|---|
| `jobGate` avoid list | "Internship: you said never show these" |
| track not in `feedTracks(profile)` | "Data science: not one of your fields" |
| `levelAllowed(seniority, years)` false | "Senior role: you have 1 year" |
| `requiredYears > yearsReach(years)` | "Asks 5+ years: you have 1" |
| `stackGap` required skills missing | "Asks Go, Kubernetes" |
| verdict "no" with its reason | the model's reason line |
| score < `min_match_score` | "Weak match (32)" |

`matches` = none of the hard rules (first four) failed and score ≥ `min_match_score`. The score is `scoreJob`'s, so a
card's number agrees with the swipe check.

### 4.3 All jobs (`browseJobs`)

- Same SQL as `feedRows`, with these differences: the profile gates (tracks, years, level) apply only while the user
  has not widened them; no 0.35 closeness cut when a role text is given; no 65 floor, no 5 cap, no 40 cap; 25 a page;
  `includeSkipped` brings swiped-left jobs back.
- Filters (query string, `lib/feed-url.ts`): `mode=all`, `q` (title and `Job.terms`), `exp` (any band, including above
  the profile), `fields` (any tech track), `country`, `stage`, `days`, `pay=1`, `skipped=1`, `sort=match|new`.
- Scoring: every row gets the cheap score (closeness, skills, years: `scoreJob` without a verdict); the visible page
  gets model verdicts (`fitJobs`, cached per user and job), so the cost follows what is looked at.
- Each card: score, "Matches your profile" or "Doesn't match" with the first two reasons; Apply only when `matches`.

### 4.4 Company page, signed in

`employerPage` gains the person's `profileFit` for each job (cheap score; verdicts for the matching group only, at
most 30). The page shows "Matches your profile (N)" first, ranked by score, each with Apply; then "Other roles here"
with the reason and no Apply. Signed out: as today.

### 4.5 Apply to all that fit

Server action `applyToMatching(slug)`: for the matching jobs, best first, call `swipeRight` one at a time; stop at the
first cap refusal (`max_per_company_per_week`, daily cap, `max_in_flight`) and report: "3 sent to your agent; 4 more
fit: the agent can apply to them from next week". Every check writes its `ApplicationEvent` as now. A confirm sheet
lists the jobs first. Signed out: Google, then back to the page.

### 4.6 Employer in the feed

- A card and the job page show "4 more roles at Razorpay match you" when the employer has other matching jobs; it
  opens the company page's matching group.
- Today's set takes at most 2 jobs from one employer (`employerKey`), so one company cannot fill the day.

### 4.7 Security, failures, observability

No new data about people; the confirm sheet and action act only for the signed-in user. A failed verdict leaves the
cheap score. `scripts/feed-funnel.ts --email` (read-only, X1) prints the pool at each stage, as measured in §2.

---

## 5. UI

- Feed top: "Today's picks | All jobs" (segmented control). Picks: the deck as now; its end offers "Keep going: N
  more that match you".
- All jobs: a list of the company page's job cards (`app/companies/job-cards.tsx`), with a filter bar and a sort.
  A card that doesn't match shows "Doesn't match your profile" and its reasons in place of Apply.
- Company page, signed in: two groups and an "Apply to all N that fit" button with its confirm sheet.

## 6. API

`GET /api/jobs` accepts `mode=all` and the filters of §4.3 and returns `{ jobs, page, pages }`; a server action for
Apply to all.

## 7. Testing

`profile-fit-test` (pure), `feed-browse-test` (DB, throwaway rows), `company-pages-smoke` (signed in groups),
`apply-matching-test` (mock board, test profile, cap stop), and `feed-sql-test`, `guards-test`, `feed-dedupe-test`.

## 8. Rollout

X1 first (it helps today), then X2 → X3 → X4 → X5 → X6. No migration.

## 9. Risks

- Model cost in All jobs: verdicts only for the visible page, cached.
- "Apply to all" meets the 3-a-week company cap; the result says so.
- Most boards publish no pay: "only jobs that state pay" is opt-in.

## 10. Tasks

In [TASKS.md](TASKS.md): X1–X6.

## 11. Decisions closed with the owner (27 Nov)

1. Today's picks stay strict; All jobs may widen.
2. A job that doesn't match the profile says why and has no Apply.
3. On a company page the matching jobs come first, with "Apply to all that fit".
4. Following companies is not in this phase.
