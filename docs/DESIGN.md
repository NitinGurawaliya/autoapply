# DESIGN — SwipeApply

The look comes from the owner's design in `design/` (exported from Claude Design on 10 Oct): `start.html` (opening animation, sign-in), `onboarding.html`, `feed.html` (deck, filters, after-swipe toast, the needs-you sheets, notifications), `applications.html` and `detail.html`. **The app must match them exactly, light and dark** (owner, 10 Oct): same colours, type, sizes, spacing, radii, shadows, copy style and motion. Do not reinterpret, round off or "improve" a value; where two screens use slightly different greys, both are kept (see the per-job greys below). The files are reference only, never copied into the app. `docs/DESIGN_SPEC.md` is the behaviour checklist each rebuilt screen must still meet. Where the app has a state the design does not draw (loading, errors, extra sources or statuses), it is built from the same parts in the same style, and the screen task says so.

Rules from CLAUDE.md still apply: mobile first at 390 px, centred at 480 px on desktop, shadcn/ui, one brand accent, no gradients, no emoji.

**Agent voice (owner, 24 Oct), where the app knowingly departs from the design's copy.** The user sees their agent at work, never the pipeline behind it:
- Words: stages read "Getting ready to apply", "Reading the application form", "Writing your answers", "Sent" (`lib/status-meta.ts STAGES`); outcomes say what happened and what to do, never a rule name, worker, queue count or raw page text (`lib/explain.ts`); the card's eyebrow is "Why your agent picked it", its reason written as sentences (`modules/jobs/match.ts`); the application story is the agent's steps with counts, without rule checks (`lib/steps.ts`).
- The agent: `patterns/agent-status.tsx`, a lime disc with the agent spark (icon `agent`) that pulses while it works, and its words with three thinking dots; still under reduced motion. It replaces the segmented progress on in-progress rows and the after-swipe toast, and is the live card on the application page and the feed's loading line.
- Logos and the board: `CompanyMark` shows the company's logo (`Company.logoUrl`, white behind it, initials until it loads or when it fails, `ui/logo-image.tsx`); the card has a "via Greenhouse" chip (`lib/board-label.ts`). The match badge always shows its tier word, never a number.
- Hidden: the daily cap appears only within 5 of the limit ("18 sent today"); the raw event log on the application page shows only for an `ADMIN_EMAILS` user with `?debug=1`.
Colours, type, sizes, radii, shadows and motion tokens are unchanged: ink and lime only, lime a fill.

## How the UI is built

Four layers. Each uses only the one below it.

1. **Tokens** — `src/app/globals.css` (colour, radius, shadow, type, easing) and `src/lib/motion.ts` (the same curves plus durations and swipe physics for Framer Motion). The only place a colour or curve is written. Primitives and patterns may use the design's exact pixel sizes (e.g. an 18 px row radius); screens may not.
2. **Primitives** — `src/components/ui/`: `icons` (the design's own SVG paths), `button` (variants `primary line strong plain quiet underline`, sizes `xl` 56, `lg` 52, `md` 48, `row` 44, `text`), `icon-button`, `chip` (Chip with pill / tab / block / answer shapes, RemovableChip, Tag, SoftChip, SkillTag, AccentPill, CountChip), `field` (FieldLabel, InputBox, NativeSelect, TextAreaBox, FieldError), `check-row`, `otp-input`, `surface`, `marks` (CompanyMark, MatchBadge, stamp classes, StatusMark, StatusPill), `source-badge`, `segmented-progress` (and ProgressBar), `eyebrow` (and Skeleton), `sheet`, `sonner` (toasts as the dark card). `input`, `label`, `textarea` and the `default` button remain only for the mock ATS form, which imitates another site.
3. **Patterns** — `src/components/patterns/`: `shell-context`, `top-bar` (FeedTopBar, TitleTopBar, BackTopBar, UsagePill), `tab-bar`, `profile-menu`, `layout` (Screen, StepHeader, PageIntro, ScreenBody, StickyFooter), `chip-group`, `content` (SectionCard, Row, InfoNote, Callout, TrustPanel, EmptyState), `drawings`, `job-card`, `swipe-stage`, `agent-toast`, `application-row`, `detail` (FailureCard, Timeline, FieldList, ScreenshotFrame), `opening` (LogoMark, OpeningSplash), `states` (PageLoading, PageError).
4. **Screens** — `src/app/**` fetch data and arrange patterns. A screen that needs its own styling is missing a pattern. `scripts/ui-lint.ts` fails on a hex colour or an inline style in `src/app` (the mock form and `/dev/ui` excepted).

`/dev/ui` (not in production) shows every primitive and shared pattern in a light and a dark panel. `scripts/design-shots.ts` captures the 36 boards of the design file and any app page at 390 px in both themes, for side-by-side checks.

One meaning, one place: every status's design label, group and stage come from `lib/status-meta.ts`; wording for blocks and failures from `lib/explain.ts`; the step story from `lib/steps.ts`.

## Screens

| Screen | Board | Built from |
|---|---|---|
| `/sign-in` | 01, 02 | OpeningSplash once per session (cookie), LogoMark, SignInArt, the Google server action |
| `/onboarding/resume` | 03, 04 | StepHeader 1 of 3, drop zone and file card, ResumeSketch and the five findings (from GET /api/profile after the upload) |
| `/onboarding/confirm` | 05 | StepHeader 2, missing-phone card, SectionCards with pencil rows, Skills, Education, "Looks right" (same two PUTs) |
| `/onboarding/questions` | 06, 07 | StepHeader 3, two screens in one page, one PUT at the end |
| `/feed` (Discover) | 08–12 | FeedTopBar, JobCard in SwipeStage, AgentToast following the real status, FilterSheet, EmptyState (caught up, no matches) |
| Needs-you sheet | 13, 14 | `components/needs-input-dialog.tsx`: Sheet, AccentPill, answer chips or InputBox, OtpInput (8 boxes) for `security_code`; opens by itself and cannot be dismissed |
| `/applications` | 16 | TitleTopBar with today's line, tab chips, NeedsRow / ProgressRow / SentRow / FailedRow |
| `/applications/[id]` | 17, 18 | BackTopBar, StatusPill, FailureCard, TrustPanel, Timeline, FieldList, ScreenshotFrame |
| `/answers`, `/gaps`, `/account`, `/governance` | none | the same parts; reached from the profile menu |

Board 15 (phone notifications) is the operating system's; the app sends the same browser notifications as before.

## Colour

Near-black ink on off-white, one lime accent, thick ink edges. **Lime is a fill only**: always behind ink text (`bg-primary text-primary-foreground`), never as text or a thin line on white. Links are ink and underlined.

| Token (Tailwind name) | Light | Dark | Used for |
|---|---|---|---|
| `background` | `#f6f6f7` | `#0e0f11` | page |
| `card` = `surface`, `popover` | `#ffffff` | `#1a1b1f` | cards, sheets, the tab bar |
| `muted` = `subtle`, `secondary`, `accent` | `#eeeef1` | `#24252a` | quiet fills: avatar circle, skill tags, trust panel, hover |
| `foreground` | `#16171a` | `#f2f2f3` | text, links, icons |
| `muted-foreground` | `#6b6e75` | `#a1a4ab` | secondary text, eyebrows (4.41:1 on `muted` in light: the design's value, kept by the owner) |
| `primary` / `primary-foreground` | `#c6f432` / `#16171a` | same | the accent: main buttons, selected chips, match badge, APPLY stamp, done step |
| `primary-edge` | `#16171a` | `#c6f432` | border around lime fills |
| `edge` | `#16171a` | `#4a4b52` | the 2 px border on raised cards, outlined chips, key inputs |
| `border` = `line` | `#e6e6ea` | `#2a2b30` | hairlines, list dividers, quiet card borders |
| `line-strong` | `#d4d4da` | `#3a3b41` | sheet handle, dashed outlines |
| `input` | `#cfcfd4` | `#3a3b41` | unselected chip and secondary input borders |
| `inverse` / `inverse-foreground` | `#16171a` / `#ffffff` | `#f2f2f3` / `#16171a` | company tiles, the selected Applications tab, the after-swipe toast |
| `bar` / `track` | `#16171a` / `#e4e4e7` | `#c6f432` / `#2c2d33` | progress fill and its track |
| `scrim` | ink 48% | black 62% | behind sheets |
| `ring` | `#16171a` | `#c6f432` | focus ring; the active code box (3 px) |
| `ink` | `#16171a` | `#16171a` | never flips: borders and text on lime (APPLY stamp, match badge, splash card) |

Greys the design uses for one job each, kept apart so each screen matches exactly:

| Token | Light | Dark | Only for |
|---|---|---|---|
| `sketch-line` | `#dcdce1` | `#3a3b41` | onboarding: resume sketch lines, "Looking…" circles |
| `sketch-fill` | `#ececef` | `#2a2b30` | sign-in: lines on the illustrated card |
| `dash` | `#b9bac0` | `#4a4b52` | applications: dashed "Didn't go through" rows and their tile |
| `draft-dash` | `#9a9ba2` | `#5a5b62` | detail: dashed AI-draft box |
| `badge-edge` | `#bdbec4` | `#4a4b52` | detail: source badges and count chips |
| `toast-seg-on` / `toast-seg-off` | lime / white 20% | ink / ink 18% | the after-swipe toast's progress (the toast is `inverse`) |
| `splash` | `#c6f432` | `#0e0f11` | opening animation background |

The phone notifications on board 15 (`#d9dae0`, `#2a2b30` cards) are the operating system's, drawn for context; the app does not build them.

Status is shown the design's way, in ink and lime only: progress segments and plain words for in progress, a lime "Needs you" pill, an ink check for sent, a dashed outline and an info icon for didn't go through. There is no blue, amber, green, red or purple. The old coloured status tokens were removed in T69.

## Type

Bricolage Grotesque (800, display) for headings and big numbers; Geist for everything else. Both load through `next/font` in `src/app/layout.tsx` (`--font-bricolage`, `--font-geist-sans`). Utilities are `type-*`, not `text-*`, so class merging never confuses them with colours.

| Utility | Size / line / tracking | Design use |
|---|---|---|
| `type-display-2xl` | 44 / 1 / -0.045em | sign-in headline, wordmark |
| `type-display-xl` | 38 / 1.02 / -0.035em | job title on the swipe card |
| `type-display-lg` | 34 / 1.04 / -0.04em | page titles (Applications, onboarding steps) |
| `type-display-md` | 32 / 1.05 / -0.04em | empty states, application detail title |
| `type-display-sm` | 26 / 1.1 / -0.035em | sheet titles (Filters, All sorted) |
| `type-title` | 23 / 1.25, Geist 600 | the question in the needs-you sheet |
| `type-lead` | 17 / 1.45 | "Why it fits", primary button labels |
| `type-callout` | 15 / 1.4 | row titles, secondary buttons |
| `type-caption` | 13 / 1.45 | meta lines, hints |
| `type-eyebrow` | 12, 700, 0.08em, uppercase, muted | section labels ("Why it fits", "Needs you · 2") |

Tailwind's `text-xs/sm/base/lg` (12/14/16/18) cover the rest.

## Shape and depth

- Radii: `rounded-card` 28 px (swipe card, sheet top), `rounded-panel` 20 px (section cards, rows), `rounded-control` 16 px (buttons), `rounded-field` 14 px (inputs, code boxes), `rounded-tile` 12 px (company tiles), `rounded-full` (chips, icon buttons).
- Exact radii in the design: 28 (card, sheet), 24 (upload drop zone), 22 (failure card), 20 (section cards, needs-you rows, sheet answer), 18 (in-progress and sent rows, screenshot), 16 (buttons, detail logo), 14 (inputs, code boxes, card tile, AI draft box), 13 (44 px tiles), 12 (40 px tiles, small buttons), 8 (skill tags), full (chips, icon buttons).
- Depth is a solid ink shadow straight down, no blur: `shadow-hard` (4 px) on raised cards, `shadow-hard-lg` (6 px) on the swipe card, `shadow-button` on primary buttons (none in dark). `shadow-float` only for the toast and notifications, `shadow-soft` for the round Skip button.
- Raised surfaces pair a 2 px `border-edge` with `shadow-hard`; quiet ones use a 1.5 px `border-line` and no shadow; "didn't go through" rows and AI drafts are dashed.
- Touch targets are at least 44 px; primary buttons 56 px, secondary 52 px, chips 44 px.

## Motion

All from `src/lib/motion.ts` (Framer Motion) or the matching `ease-*` classes (CSS transitions).

| Name | Curve | Use |
|---|---|---|
| `pop` | (.2, .9, .3, 1.2), 200 ms | Apply/Skip grow under a drag, toast in (380 ms) |
| `settle` | (.2, .9, .3, 1) | progress segments, back card, content |
| `spring` | (.2, .9, .3, 1.15), 420 ms | released card returns |
| `exit` | (.4, 0, 1, 1), 260 ms | committed card leaves |
| `bounce` | (.34, 1.56, .64, 1) | opening animation only |

Swipe: commit past 90 px, rotate dx/24 degrees, exit 520 px at 10 degrees, back card at 0.95 scale and 10 px down, buttons grow 8% at full drag.

## States the design does not draw

- **Source badges.** The design draws four: Resume (file icon), You (person icon), Default (crosshair icon), each a solid `badge-edge` outline, and AI draft (pen icon, dashed outline, the answer in a dashed `draft-dash` box with "Read the full draft"). The app's other two use the same badge: "You · reused" (person icon, solid) and "Worked out" (file icon, solid), each with its basis line in `type-caption` muted under the value.
- Loading, error and blocked states are built from the same primitives in the same style.

## Checks

- `npx tsx scripts/contrast-check.ts` reads the tokens from `globals.css` and checks every text pair at 4.5:1 and the focus ring at 3:1, light and dark.
- `npx tsx scripts/theme-smoke.ts` (needs `npm run dev`) checks the real computed colours in a browser at 390 px and saves screenshots of sign-in, feed, applications and detail, including dark.
- `npx tsx scripts/ui-lint.ts` checks that screens carry no hex colours or inline styles.
- `npx tsx scripts/onboarding-smoke.ts`, `feed-smoke`, `applications-smoke`, `shell-smoke`, `notify-smoke`, `answers-smoke`, `governance-smoke`, `lifecycle-smoke`, `ui-smoke` cover the screens' behaviour.
