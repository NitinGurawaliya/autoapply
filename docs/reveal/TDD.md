# Today's jobs, revealed — technical design (Phase R)

Owner, 20 Nov: the feed must show the user what their agent did, not a counter ("4 of 12"). The approved prototype is
`design/daily-reveal.html`. This doc turns it into the app, in small tasks that each keep the feed working.

## 1. Goals and non-goals

Goals:
- The first open of each day shows what the agent did with the day's real numbers, as a 3D scene: the open jobs it
  read (real postings from the user's pool), the ones outside their fields falling away, its picks rising, landing
  as an arc of real job cards the user can drag or tap. Then "See today's N" opens the cards.
- The feed is just today's jobs: no "Pick 1 of today's 12", no sets of four, an end screen that says what was sent.
- The first run after onboarding is the full reveal; later days a short one; never twice in a day; skippable; sound
  made in the browser, quiet, and off with one tap.
- The push says what the agent did: "Your agent read 20,531 open jobs in India and picked 12 for you."

Non-goals: no change to how jobs are chosen, ranked or applied; the swipe deck's physics stay as they are
(`lib/motion.ts swipe`); no new library (CSS 3D, Framer Motion and Web Audio are already available).

## 2. Facts the design rests on

- The set is `DailySet` (`userId`, India `day`, `jobIds`, `released`, `basis`, `pushedAt`, `builtAt`), built lazily by
  `daily.ts ensureDailySet` on feed load or by the worker (prescan, warm, push), released `DAILY_RELEASE` (4) at a time.
  The deck shows "Pick N of today's 12", "X of today's 12 picks done", "Show next N", "That's all 12 for today".
- The gate pool (rows that pass the field gate, with company name and logo) exists only inside `match.ts scoreFeed`;
  `rankedFeed` returns `{ jobs, degraded }` and is cached a minute (`lib/feed-cache.ts`).
- All `DailySet` access is raw SQL in `daily.ts`: new columns need no Prisma client regeneration to be used.
- Browsers start audio only after a user gesture in the page; a tap that navigated to /feed inside the app counts, a
  cold load from a push does not.
- No CSS module exists yet; Next supports them. The 3D scene needs real CSS (perspective, preserve-3d, keyframes).

## 3. Options and decision

- Counts: (a) compute at request time; (b) store them on the day's set when it is built. **(b)**: the reveal shows the
  numbers the set was made from, the same on every device, and costs nothing on later loads.
- "Seen today": (a) localStorage; (b) `DailySet.revealedAt`. **(b)**: once per day across devices; a test can read it.
- Sets of four: removed by default (`DAILY_RELEASE` defaults to the set size); the release mechanism and its env stay,
  so nothing that depends on it breaks.

## 4. Architecture

### 4.1 Components

1. `match.ts`: `scoreFeed` reports the gate pool's size and a sample of up to 130 of its rows (company, logo) through
   the `run` object; `rankedFeed` returns them and the feed cache keeps them with the jobs.
2. `daily.ts`: `ensureDailySet` stores `stats` (read: open jobs in India; fields: the gate pool; fits: the ranked
   list; field: the sample) when it writes a set; `dailyView` returns `reveal` (the stats, `full` or `short`) while
   `revealedAt` is empty and at least 2 jobs are open; `markRevealed(userId)`; the push copy.
3. `POST /api/daily-set/reveal`: sets `revealedAt` for today (idempotent).
4. `components/patterns/daily-reveal.tsx` + `daily-reveal.module.css`: the scene, the arc, the words; `lib/reveal-sound.ts`.
5. `feed/swipe-deck.tsx`: shows the reveal before the cards when `daily.reveal` is set; starts the deck at the card the
   user chose; no set label, no batch screens; the end of the day.
6. First run: the feed's loading fallback for a user with no set yet shows the field being read (the scene's first
   part, no numbers), then the reveal plays when the deck streams in.

### 4.2 Data model

`DailySet.stats Json?` — `{ read: number, fields: number, fits: number, field: Array<{ company: string, logo: string | null }> }`.
`DailySet.revealedAt DateTime?`. Migration `20261120120000_daily_reveal`, additive, applied with `migrate deploy`.

### 4.3 When the reveal shows

Today's set exists, `revealedAt` is null, 2 or more of its jobs are still open, the default view. **Full** for a
user's first 3 revealed days and after 4 days away; **short** otherwise (no camera move or scan: the count, the picks
rising, the arc). Reduced motion: the arc at once. Tap anywhere skips to the arc. The deck marks it revealed when the
reveal ends or is skipped.

### 4.4 Sound

`lib/reveal-sound.ts`, Web Audio only: a whoosh (filtered noise), ticks (the odometer, the arc's detents), one note per
pick (C major pentatonic, rising), a thump and a chord on landing. Gain 0.55 at most, every sound under 1.6 s. A sound
button on the reveal; the choice is kept per device (`localStorage swipeapply:reveal-sound`, a convenience).

### 4.5 Security, failure, observability

The reveal route checks the session like `PATCH /api/daily-set`. A failed reveal POST changes nothing for the user (it
shows again on the next load). Missing stats (a set built before R1) means no reveal that day. `daily-set` logs a line
when it stores stats.

### 4.6 Code map

`prisma/schema.prisma`, migration, `modules/jobs/match.ts`, `lib/feed-cache.ts`, `modules/jobs/daily.ts`,
`app/api/daily-set/reveal/route.ts`, `components/patterns/daily-reveal.tsx`, `daily-reveal.module.css`,
`lib/reveal-sound.ts`, `app/(app)/feed/swipe-deck.tsx`, `app/(app)/feed/page.tsx`, `scripts/daily-set-test.ts`,
`scripts/daily-reveal-test.ts`.

## 5. UI

As `design/daily-reveal.html` (approved 20 Nov), in Direction B tokens: one big count rolling like an odometer, a
tilted field of real postings with logos, a scan line, picks that hover with a shadow, an arc of compact job cards
(logo, company, board, match, title, place and level, reason, score bar, "You have"), "Today's jobs", the line, "See
today's N", "Tap anywhere to skip" / "Drag the cards, or tap one to bring it round". The deck has no set label. The end:
"That's today's jobs", "New ones tomorrow morning.", sent and in-progress rows, "Done for today" and "Keep going".

## 6. API

`POST /api/daily-set/reveal` → 200 `{ revealed: true }`; 401 unauthorized; 404 `no_set`.
`GET /api/jobs` and the feed page carry `daily.reveal` when it applies.

## 7. Testing

`scripts/daily-set-test.ts` (existing, kept green; its batch checks pin `DAILY_RELEASE=4`), plus stats stored, the
default release of the whole set, reveal shown once and gone after the POST, the push copy. `scripts/daily-reveal-test.ts`
(new): when full or short, under 2 open jobs no reveal, a set without stats no reveal. Browser: 390 px light and dark on
a clone, reduced motion, sound toggle, arc drag, deck start. Regression each task: typecheck, lint, ui-lint,
`daily-set-test`, `feed-sql-test`, `match-test`, `score-breakdown-test`, `fit-test`, `learning-test`.

## 8. Rollout

Behind `DAILY_SET=1` like the set. Migration first (additive), then each task to main. Workers restarted after R1
(push copy) and at the end.

## 9. Risks

- Heavy scene on low-end phones: 130 tiles, transforms only, no layout work per frame; the short version after day 3.
- Logos from other hosts may fail: each tile and card falls back to the initial.
- A set built before R1 has no stats: no reveal that day, the cards as before.

## 10. Tasks

[docs/reveal/TASKS.md](TASKS.md): R1 to R5.

## 11. Decisions closed with the owner (20 Nov)

The reveal is the daily report, not a one-time intro; the first run after onboarding is the full version; sound on,
quiet, with a toggle; no "4 of 12"; real jobs in the field; the arc can be dragged.
