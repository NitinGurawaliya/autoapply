# DESIGN — SwipeApply

The look comes from the owner's design in `design/` (exported from Claude Design on 10 Oct): `start.html` (opening animation, sign-in), `onboarding.html`, `feed.html` (deck, filters, after-swipe toast, the needs-you sheets, notifications), `applications.html` and `detail.html`. **The app must match them exactly, light and dark** (owner, 10 Oct): same colours, type, sizes, spacing, radii, shadows, copy style and motion. Do not reinterpret, round off or "improve" a value; where two screens use slightly different greys, both are kept (see the per-job greys below). The files are reference only, never copied into the app. `docs/DESIGN_SPEC.md` is the behaviour checklist each rebuilt screen must still meet. Where the app has a state the design does not draw (loading, errors, extra sources or statuses), it is built from the same parts in the same style, and the screen task says so.

Rules from CLAUDE.md still apply: mobile first at 390 px, centred at 480 px on desktop, shadcn/ui, one brand accent, no gradients, no emoji.

**Phase O direction (owner, 18 Nov; `docs/ui-craft/AUDIT.md`): Direction B, `design/craft-b.html`, replaces the lime-and-ink look.** Warm paper and ink with one orange accent (Apply and the match number only), one family (Schibsted Grotesk) at 13 / 15 / 17 / 24 / 32, radii 10 and 16, meaning by form rather than tints, open job-page sections divided by rules. Until O3–O4 rebuild components and screens, the rest of this file describes the shipped look; where they conflict on a screen already rebuilt, Direction B holds. The premium pass, `design/craft-b2.html`, is the target (owner, 18 Nov).

**Direction B foundations (Phase O2).** The app runs in one of two looks: `b` (the default since O6, 18 Nov) or `classic` (the old lime look, kept one release as a fallback, then removed). `layout.tsx` sets `<html data-look>` from `NEXT_PUBLIC_LOOK`; `?look=b` or `?look=classic` on any page saves a cookie that wins (a head script, before paint), so the owner can preview B in the real app. `globals.css` keeps every token name and gives `[data-look="b"]` (and `.dark[data-look="b"]`) Direction B's values, so components change look without code changes; O3–O4 then fix structure. `NEXT_PUBLIC_LOOK=classic` sets the default back without a deploy of code.

| | Light | Dark |
|---|---|---|
| Background · surface · sunk | `#f6f4ef` · `#fffefc` · `#eeebe4` | `#11100e` · `#1b1916` · `#161512` |
| Text · muted · faint | `#1a1814` · `#77726a` · `#a8a39a` | `#efebe5` · `#9d978e` · `#6a655e` |
| Lines (line · line-strong) | ink at 10 % · 18 %, drawn at 0.5 px where they separate | `#efebe5` at 9 % · 16 % |
| Accent (`primary`) · pressed · as text (`brand-text`) · on it (`ink`) | `#c2410c` · `#a8380a` · `#b23c0b` · `#fffaf5` | `#e2733f` · `#cc6534` · `#ec8a5a` · `#1a1814` |

- **Accent:** only the main action and the match number. Nothing else is orange: not "New", not gaps, not icons.
- **Type:** Schibsted Grotesk only (`--font-schibsted`). Five utilities: `type-score` 40/500, `type-heading` 24/600 (−0.025em), `type-section` 17/600, `type-body` 15/1.5, `type-meta` 13/1.5. In look `b` the classic `type-display-*` become 600 at 24 (32 for `2xl`) and `type-eyebrow` loses its capitals, so unrebuilt screens degrade gracefully.
- **Radii:** `rounded-tag` 6, `rounded-control` / `field` / `tile` 10, `rounded-card` / `panel` 16. Pills only for toggles.
- **Depth:** `shadow-lift`, a half-pixel ring plus one long soft shadow (dark adds a 1 px top highlight). In look `b`, `shadow-hard*` and `shadow-card` resolve to it and `shadow-button` to none.
- **Motion:** `ease.calm` (0.2, 0.8, 0.2, 1) for everything outside the swipe; taps shrink to 0.98 in 120 ms (`transition.tap`); the toast arrives with `calm`. Overshoot only where a finger drags.
- **Meaning by form:** a required skill you lack has an ink dashed underline; a nice-to-have you lack is grey; you have it is plain ink. No tints.
- **Checks:** `npx tsx scripts/ui-lint.ts` counts, per file, the patterns the audit named (arbitrary sizes, capitals, pills, offset shadows, the classic display face, thick borders, classic type utilities, raw colours). `--check` fails when a file gains any over `docs/ui-craft/ui-lint-baseline.json` (678 hits on 18 Nov); a rebuilt file goes to zero and the baseline is rewritten.

**Voice (Phase O5, owner 18 Nov).** The product speaks plainly; the agent is named only when it acted.
- Say what happened or what to do, in the fewest words: "Sent", "Needs you", "Didn't go through", "New jobs arrive through the day." No narration of work in progress ("Your agent is finding jobs" → "Finding your matches").
- "Your agent" only for its own actions the user must know about: it pressed Submit, it needs a code or an answer, it held one back, it wrote a note or a best guess.
- No helper paragraph that explains how the system works; a fact or a trust line in one sentence ("We never guess these, and they only go to jobs you swipe right on.").
- Numbers and names over adjectives; sentence case everywhere, labels too; no exclamation marks; no "·"-joined strings of three or more parts.
- Match reasons say what the work is and which of the user's skills it uses, at most two short sentences; years and place are facts on the card, so a reason repeats them only when the years are well over the user's.

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
| `/onboarding/resume` | 03, 04 | StepHeader 1 of 2, drop zone; picking a PDF starts the read (Phase S): ResumeSketch, a bar that fills with time towards the usual 20 s, then straight to the profile screen; errors back on the drop zone |
| `/onboarding/confirm` | 05 | StepHeader 2 of 2, "Your profile" (Phase S): a "From your resume" summary card (name, title and level, "Jobs in …", eight skills and +N) with "Edit details" opening the full sections below; "For your applications" (expected CTC, current CTC, notice chips, the consents CheckRow pre-ticked) while a standing answer is unsaved, "What you're looking for" (job type, where, citizen of) inside the details; "Start swiping", the missing-CTC error above it. The details: missing-phone card, SectionCards with pencil rows, Skills, "Your fields" (track Chips, "Your resume suggests … Use these"; under them, P4: a CheckRow "Also show nearby fields" whose hint names what it adds, "Adds ML / AI, Data engineering", and "Never show me" toggle pills Contract roles · Internships · Commission only, each section split by a hairline), Education, "Looks right" (same two PUTs) |
| `/onboarding/questions` | 06, 07 | Out of the flow since Phase S (reachable for an old link): StepHeader 3, two screens in one page, one PUT at the end |
| `/feed` (Discover) | 08–12 | FeedTopBar, JobCard in SwipeStage, AgentToast following the real status, FilterSheet, EmptyState (caught up, no matches) |
| Any unknown address | none | `app/not-found.tsx`: Screen, EmptyState with DeckEmptyArt, "This page doesn't exist", a primary "Go to your feed"; no session read, no tab bar |
| Needs-you sheet | 13, 14 | `components/needs-input-dialog.tsx`: Sheet, AccentPill, answer chips or InputBox, OtpInput (8 boxes) for `security_code`; opens by itself and cannot be dismissed |
| `/applications` | 16 | TitleTopBar with today's line, tab chips, NeedsRow / ProgressRow / SentRow / FailedRow |
| `/jobs/[id]` | `design/job.html` (Phase M7) | Opened by a tap on the feed card. BackTopBar to the same feed, with a quiet "Share" text button on the right for an open job the agent applies to (Phase U9: the phone's share sheet, else the link is copied with a "Link copied" toast) (opened from the deck, Back goes through the browser's history, `jobs/[id]/feed-back-link.tsx`). Header: CompanyMark, "via board", the score ring (`jobs/[id]/match-sections.tsx`), title, TierPill, posted, New; fact chips (place, experience rose when over the user's years, company stage, pay or a quiet "Pay not published"). Then "Why this is a match" (the reason, lime-ticked matches, rose-crossed gaps, a tip linking to `/onboarding/confirm` when skills are missing), "Skills" (coverage bar; on your resume, required not on it, nice to have not on it), "About the role", and "How we got to N" (each part out of its max with an ink/lime bar, caps and floors, the total, "What held it back"). A job no longer in the feed shows only its facts and description. The description set out to read (`lib/description.ts`: headings, paragraphs and lists recovered from the stored plain text, never adding or dropping a word; body 16 px / 1.65), the first ~700 characters, then "Read the full description". Sticky action bar: "Up next: company · role" over Skip/Apply; both move on at once to the next job of the same feed (prefetched, so it opens without a skeleton) and save the swipe on the way, the outcome as a toast; the last job goes back to the feed. States: loading, error, not found, already applied / skipped / closed ("See your application" or "Back to the feed" beside "Next job") |
| `/applications/[id]` | 17, 18 | BackTopBar, StatusPill, FailureCard, TrustPanel, Timeline, FieldList, ScreenshotFrame; opened from a share link (`?from=share`, Phase U) an arrival card on top: CompanyMark, "Applying to <company>", the role, the three segments and the stage, a hairline, "Tell me when it's sent" with the notifications switch, a hairline, "N more picked for you today" and the one primary "See today's jobs" |
| `/j/[slug]` (share link) | `design/share.html` (Phase U) | Public, no tab bar. A top bar with the wordmark and "Sign in" (or "Your feed"); CompanyMark, company, "via board · posted"; the match in `brand-text` only for a signed-in user with a profile; the title (`type-heading`), chips (place, experience, pay), the reading's summary, "What they ask for" (its requirement lines), "About the role" folded to three lines. A sticky bar: the one primary Apply with "Upload your resume once. Your agent fills in the form and sends it." (signed out) or "Your agent applies with your saved profile."; while claiming, the three segments and "Sending to your agent". States, each a dashed panel then "Open jobs like it" (three SimilarRows: CompanyMark, title, company and place, a chevron): closed ("This job has closed"), a board outside APPLY_BOARDS ("Your agent can't apply here yet"), not a match ("Your agent won't apply to this one" with the missing required skills, the match muted, then the same "Open jobs like it" and "See today's jobs"; built 23 Nov: jobs like it, not "fit you better", since they are not scored for the user), claim failed ("That didn't go through", Try again). In the LinkedIn, X, Instagram or Facebook app: Android "Open in Chrome to apply", iPhone the two steps to Open in browser. Onboarding while an intent is set: a job strip above the step (CompanyMark, role, company, a quiet "Applying" tag); the profile screen's button reads "Save and apply". The preview card (`opengraph-image`, 1200 × 630, always light): CompanyMark, company, via board, the role at 2 lines, chips, the wordmark and "Apply in one tap" (closed: "Closed · see similar jobs", outlined) |
| `/companies`, `/companies/browse/[letter]`, `/companies/[slug]` | `design/companies.html` (Phase W5, drawn 27 Nov, revised the same day: job cards, department chips, search, wide desktop; the owner approves before W6 is final) | Public, no tab bar, the share page's top bar. Index: the letter strip (a letter with no company is plain grey text) and "Most hiring in India". Company page: tile, name, website, "N open jobs", boards; department chips with counts (pills, the selected one filled) and a search of the company's jobs; jobs in India then "Outside India", each a card: a department tile, "Department" with a "New" tag, the title, chips for place, experience, how long ago and pay, and its own Apply button. The card nearest the middle of the screen is active while scrolling (lift, an ink bar, the button grows to "Apply with agent"). Apply is the share page's Apply (Google, then onboarding or the job). Phones 390 px; from 1024 px the column is 896 px and a card reads left to right. Loading, empty, not-found and error drawn. Never a Naukri listing. |
| `/answers`, `/gaps`, `/account`, `/governance` | none | the same parts; reached from the profile menu. `/account` opens with "What I know about you" (P5, `account/brief-section.tsx`): a panel of hairline-split rows, fields and top skills as Tags under their label, nearby, never show me, experience and title on one line with the label; "Change" (a text link) opens the confirm screen. "Learned from your skips" (P8, `account/learned-lines.tsx`): each line ("You skip most Data engineering roles") with a 44 px ghost ×; "Nothing yet" on the label's line when there are none |

Feed card, deliberate change from `feed.html` (owner, 1 Nov: every card the same shape whatever the job, and the deck must show there are more jobs behind it): the card has one height (`CARD_HEIGHT` in `patterns/job-card.tsx`, 400 to 470 px with the viewport); the company name is one line, the title is `type-display-lg` clamped to 2 lines (3 left the reason cut mid-line at the 400 px minimum height), and the reason is clamped to 3 lines; the location and experience chips are one row, never wrapping, with the location cut short; a bottom line holds the board (BoardMark: the board's own icon from its website, `public/boards/`, for Greenhouse, Ashby, Keka, Lever and SmartRecruiters; an outlined letter tile for the others; plus "via Greenhouse") and "See details". Two cards show their bottom edge under the top one (scaled from the bottom, 12 px apart), and over the deck one line reads "N jobs in your feed" (owner, 1 Nov: no per-board counts). A release past 90 px commits a swipe, and so does a flick (over 500 px/s, measured from the pointer's own moves, once past 30 px); a slow short drag springs back. Images and links on the card never start the browser's own drag. The whole card opens `/jobs/[id]` on a tap; a drag still swipes. Skip and Apply stick above the tab bar like the job page's action bar (owner's QA, 1 Nov): at 375×667 the stack is taller than the room left, so the buttons stay on screen over its bottom edge; the gaps line over the deck is one line, cut short, with the whole sentence in its title.

Phase M (owner, 18 Nov; `docs/job-match/TDD.md`): the card and the job page move to `design/job-card.html` and `design/job.html`, approved 18 Nov. The card shows the exact score with a tier pill, wrapping chips (place, experience, pay, company stage), the job's skills you have and are missing, and the reason in a quiet box, at `clamp(440px, calc(100dvh - 330px), 490px)`. Colour carries meaning only: lime = you have it / good, rose = a gap (tokens `ok-bg`/`ok`, `gap-bg`/`gap`). Built (M6, `patterns/job-card.tsx`): the header holds the logo, company, "via board", the score in Bricolage 40 px with its TierPill (`ui/marks.tsx`: Strong fit lime, Good fit grey, Stretch dashed); the experience chip turns rose when the job asks more years than the user has; skill rows fit chips by estimated width and end in "+n", never a cut word; the second row lists required gaps first (rose, heading "Missing") then the nice-to-have ones the resume lacks (outlined, heading "Not on resume" when no required one is missing), so it never reads as nothing missing while the job names tech the user lacks; the reason box keeps "See details" and drops to one line under 790 px of height; Skip and Apply are labelled buttons (Skip quiet, Apply lime) instead of round icons. Where this conflicts with the paragraph above (fixed 400–470 px, one row of outlined chips, the board line at the bottom), this one holds.

Skips teach the feed with no question (20 Nov, owner): the "Why?" card and its toast (`patterns/skip-reason-toast.tsx`) are gone. What the feed learned shows only on /account ("Learned from your skips": one line each with ×) and as the card's learned note.

Today's jobs, revealed (Phase R, 20 Nov, owner; `docs/reveal/TDD.md`; approved prototype `design/daily-reveal.html`; `patterns/daily-reveal.tsx` with `daily-reveal.module.css`, the one CSS module, because 3D needs perspective, preserve-3d and keyframes): the first open of each day, before the cards. One big number (`type-score`) rolls like an odometer over a tilted field of real postings from the user's pool (logo or initial, two text lines, an edge, hazier with distance; the camera keeps descending): "open jobs read today", then a scan line sweeps front to back and the jobs outside their fields fall away (an ease-in), "in your fields", then the picks turn ink, rise and hover with a shadow, "picked for you", and fly onto an arc of compact job cards (CompanyMark, company, "via board", the match in `brand-text`, the title, place and level, the reason, the score bar, "You have"), the best in the middle, the next either side, the far ones veiled in the page colour. Then "Today's jobs", "Your agent read N open jobs in India and found these 12 for you.", the one primary button "See today's 12" and "Drag the cards, or tap one to bring it round". The arc drags like a carousel (a flick carries it, it snaps to a card; arrow keys too) and a tap brings a card round; the deck then starts at the card in front. A tap during the scene skips to the arc. Full (about 4.5 s) for a user's first 3 days and after 4 days away; short otherwise (the picks rise from the field, about 2 s); reduced motion shows the arc at once. Sound (`lib/reveal-sound.ts`, Web Audio, no files): a whoosh, odometer ticks, a scan sweep, a rising note per pick, a thump and a chord on landing, detent ticks on the arc; a speaker button at the top right turns it off, kept per device. Once a day on any device (`POST /api/daily-set/reveal`). Over the cards one line reads "Today's jobs" (no counter, owner: no "1 of 12"); the whole set comes at once, and when it is done: "That's today's jobs", "New ones tomorrow morning.", a hairline, then rows from the shell's live counts: a check and "N sent", the three-segment mark (two lit, pulsing) and "N being filled in", "N need you", or "You skipped all 12."; one button, "See applications" (21 Nov, as the prototype's end screen; "Keep going" removed, `/feed?rest=1` still serves the ranked list). When the cards first show, once a day per device, the top card sways towards Apply and Skip (the prototype's `teach`, `swipeHint` in `lib/motion.ts`); the top bar's sent count rolls up as each application is sent (`components/patterns/sent-count.tsx`).

After-swipe toast, beyond `feed.html` (which draws only in progress and sent): it appears at the swipe ("Getting ready to apply") and follows the application to its outcome. In progress: "Applying to X", the stage, the agent pulsing, up to 60 s. Sent: it leaves at once and the shell's "Sent to X" toast takes over (below). Needs you: the company, the lime "Needs you" pill and "Answer", gone after 1.6 s (the needs-you sheet opens by itself). Didn't go through (blocked, failed, cancelled, or a swipe that could not be saved): "Didn't go through" with the reason from `lib/explain.ts` in a dashed `dash` outline, for 4 s. A full queue and a missing profile stay as error toasts.

Jobs you skipped (owner, 1 Nov): a left swipe never comes back to the feed. When the feed runs out, "You're all caught up" and "No new jobs right now" offer "Look at the N jobs you skipped", which opens `/feed?view=skipped`: the same deck under a "Jobs you skipped" heading with "Back to your feed", the line reading "N jobs you skipped". A right swipe there applies (the skip becomes the apply); a left swipe keeps it skipped; when it runs out, "That's every job you skipped". A skipped job's own page keeps Apply and Skip, with "You skipped this job before. Apply if you've changed your mind."

The "Sent!" moment (owner, 1 Nov: an application going out is the big moment, and it must never stop what the user is doing; `components/sent-celebration.tsx`, mounted in the signed-in shell): when an application is submitted, wherever the user is, a dark toast drops in at the top like the after-swipe toast (`rounded-panel`, `bg-inverse`, `shadow-float`). A 44 px lime disc with an ink check pops in on a spring, a lime ring flares and a small burst of lime and light pieces leaves it; the phone buzzes once. "Sent to Stripe" over a line that turns the count into progress: "Your first application is out", a round number ("10 applications sent"), or the role with this week's count; several sent while away come as one toast, "3 applications sent · To Stripe, Razorpay and Jupiter". No scrim and no focus taken: everything under it keeps working (swipes, buttons, keys). It leaves by itself after 4.5 s (held while a finger or pointer rests on it); a tap opens the application, a flick up dismisses it. On the feed the after-swipe toast hands over the moment the run is sent. Each sent application is shown once per device (`localStorage`); a device's first visit never replays history. Reduced motion: a plain fade. The worker also sends a push, "Sent to Stripe". Preview: `/dev/ui`, Sent moment.

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

Status is shown the design's way, in ink and lime only: progress segments and plain words for in progress, a lime "Needs you" pill, an ink check for sent, a dashed outline and an info icon for didn't go through. There is no blue, amber, green, red or purple. The old coloured status tokens were removed in T69. One exception since Phase M (owner, 18 Nov), on the job card and job page only: `ok-bg`/`ok` (lime tint; light `#eefad0`/ink, dark `#283212`/`#d9f56e`) marks what the user has or what is good, and `gap-bg`/`gap` (rose; light `#fdeaea`/`#a83a3a`, dark `#3a1f21`/`#f0a6a6`) marks a gap. Nothing else on those screens is coloured.

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
| `sway` | (.45, 0, .55, 1), 1.5 s after 0.5 s | the swipe hint: top card to 44 px right (2.5°), back, 36 px left (−2°), back |
| `count` | `calm`, 240 ms | a count going up: the old number leaves upwards, the new one rises from below |

Swipe: commit past 90 px, rotate dx/24 degrees, exit 520 px at 10 degrees, back card at 0.95 scale and 10 px down, buttons grow 8% at full drag.

## States the design does not draw

- **Source badges.** The design draws four: Resume (file icon), You (person icon), Default (crosshair icon), each a solid `badge-edge` outline, and AI draft (pen icon, dashed outline, the answer in a dashed `draft-dash` box with "Read the full draft"). The app's other two use the same badge: "You · reused" (person icon, solid) and "Worked out" (file icon, solid), each with its basis line in `type-caption` muted under the value.
- Loading, error and blocked states are built from the same primitives in the same style.

## Checks

- `npx tsx scripts/contrast-check.ts` reads the tokens from `globals.css` and checks every text pair at 4.5:1 and the focus ring at 3:1, light and dark.
- `npx tsx scripts/theme-smoke.ts` (needs `npm run dev`) checks the real computed colours in a browser at 390 px and saves screenshots of sign-in, feed, applications and detail, including dark.
- `npx tsx scripts/ui-lint.ts` checks that screens carry no hex colours or inline styles.
- `npx tsx scripts/onboarding-smoke.ts`, `feed-smoke`, `applications-smoke`, `shell-smoke`, `notify-smoke`, `answers-smoke`, `governance-smoke`, `lifecycle-smoke`, `ui-smoke` cover the screens' behaviour.
