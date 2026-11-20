# Phase R — Today's jobs, revealed: tasks

Design: [TDD.md](TDD.md). Build order R1 → R5; each lands on main with the feed still working.

<a id="r1"></a>
### [x] R1 — Counts and the seen flag
Do: migration `20261120120000_daily_reveal` (`DailySet.stats`, `revealedAt`); `match.ts scoreFeed` reports the gate pool size and a field sample, `rankedFeed` and `lib/feed-cache.ts` carry them; `daily.ts` stores stats with the set, `dailyView` returns `reveal`, `markRevealed`, `DAILY_RELEASE` defaults to the set size, the push copy; `POST /api/daily-set/reveal`; `scripts/daily-set-test.ts`, `scripts/daily-reveal-test.ts`; ARCHITECTURE 6.3.
Design: [4.1 items 1–3](TDD.md#41-components), [4.2](TDD.md#42-data-model), [4.3](TDD.md#43-when-the-reveal-shows).
**Done when:** `daily-set-test` and `daily-reveal-test` PASS; a set built today holds stats; the reveal is offered once and gone after the POST; typecheck, lint pass; the feed still loads for a real profile.
Done 20 Nov: `daily-set-test` PASS (27 checks, its batches pinned to 4; a real build stored read 20,544, fields 120, fits 58), `daily-reveal-test` PASS (11: whole set at once, full/short/away, unseen days, seen once, under 2 open, no stats); `feed-prefs-test` PASS on the dev server; match, score-breakdown, feed-sql, fit, learning, ingest-contract, results, swipe-batch PASS.
Paths: migration `20261120120000_daily_reveal` (applied with `migrate deploy`), `match.ts` (`FeedPool`, `rankedFeed.found`), `lib/feed-cache.ts` (`extra`), `daily.ts`, `api/daily-set/reveal`, `scripts/daily-set-test.ts`, `scripts/daily-reveal-test.ts`; ARCHITECTURE 4, 6.3, 11.

<a id="r2"></a>
### [ ] R2 — The reveal in the feed
Do: `components/patterns/daily-reveal.tsx`, `daily-reveal.module.css`, `lib/reveal-sound.ts`; `feed/swipe-deck.tsx` shows it before the cards and starts the deck at the chosen card; full and short; reduced motion; sound toggle; DESIGN.md.
Design: [4.1 items 4–5](TDD.md#41-components), [4.4](TDD.md#44-sound), [5](TDD.md#5-ui).
**Done when:** on a clone at 390 px light and dark the reveal plays once, skips on a tap, the arc drags, "See today's N" opens the deck at that card, a reload shows the cards; ui-lint, typecheck, lint pass.

<a id="r3"></a>
### [ ] R3 — Today's jobs without sets, the end of the day
Do: `feed/swipe-deck.tsx`: no "Pick N of today's 12", the batch screen only if `DAILY_RELEASE` is set below the set size, the end screen "That's today's jobs" with sent and in-progress rows; DESIGN.md.
Design: [5](TDD.md#5-ui).
**Done when:** a clone swipes its whole set without a pause and sees the end screen; "Keep going" still opens the ranked list; `daily-set-test` PASS.

<a id="r4"></a>
### [ ] R4 — The first run after onboarding
Do: the feed's loading fallback for a user with no set yet shows the field being read; the first reveal is full.
Design: [4.1 item 6](TDD.md#41-components).
**Done when:** a fresh test user from onboarding sees the reading scene while the first set builds, then the full reveal.

<a id="r5"></a>
### [ ] R5 — Regression and switch-on
Do: the whole check list of TDD 7 on main; workers restarted; Done lines.
Design: [7](TDD.md#7-testing), [8](TDD.md#8-rollout).
**Done when:** every listed test PASS; a real profile's feed loads with the reveal and without it (second load); the docker and local workers run the new code.
