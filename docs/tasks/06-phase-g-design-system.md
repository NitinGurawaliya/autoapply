# Phase G — Design system rebuild (the owner's design, 10 Oct)

Full entries of this phase. The index is [docs/TASKS.md](../TASKS.md). Status is marked here first, then on the index line.


The owner's design lives in `design/` (five source components exported from Claude Design: `start`, `onboarding`, `feed`, `applications`, `detail`). It replaces the Phase D look and un-holds T37–T40, which are folded in below. Build in layers, each using only the one below: tokens → primitives (`components/ui`) → patterns (`components/patterns`) → screens. Screens never style from scratch; a missing look means a missing primitive or pattern. See `docs/DESIGN.md`.

<a id="t58"></a>
### [x] T58 — Tokens, fonts and motion
Do: the design's colours, radii, shadows and type scale as tokens in `globals.css` (light and dark); Bricolage Grotesque (display) and Geist (body) through `next/font`; `lib/motion.ts` with the design's easings, durations and swipe constants; `docs/DESIGN.md` rewritten for the new system. Links stop using the accent as text colour (lime is a fill only).
Done when: `scripts/contrast-check.ts` PASS on the new tokens, typecheck and lint pass, and a 390 px screenshot shows the new background, ink, lime primary and fonts.
Done 10 Oct: `contrast-check` PASS (42 pairs; the owner chose the design exactly, so its grey on the quiet fill is held at its own 4.41:1; every design colour is a token, including the per-screen greys); `theme-smoke` PASS with screenshots (page #f6f6f7, lime #c6f432 primary, dark #0e0f11); in the browser Bricolage Grotesque loads and `type-display-*`, `type-eyebrow`, `rounded-card`, `shadow-hard` and `ease-pop` compute to the design's values. Typecheck and lint pass. The ten links that used the accent as text colour are now ink and underlined.

Owner decisions (10 Oct): tabs are Discover and Applications only (Saved answers, Fill your gaps, Governance, Account and data and Sign out live in the profile menu); the design's wording wherever it draws a screen; onboarding shows the design's 5 screens on the existing 3 URLs with the same saves; the after-swipe toast follows the real application status. Behaviour is frozen: same API calls, polling, redirects, popup triggers and dismissal. `docs/DESIGN_SPEC.md` is the behaviour checklist. Each task updates the smoke scripts it affects (class selectors become `data-*` hooks, old wording becomes the design's) and is checked against the matching design board at 390 px, light and dark.

<a id="t59"></a>
### [x] T59 — Icons, primitives and the /dev/ui gallery
Do: `components/ui/icons.tsx` (the design's own SVG paths); primitives Button, IconButton, Chip, Field, CheckRow, OtpInput, Surface, CompanyMark, MatchBadge, Stamp, SegmentedProgress, ProgressBar, Eyebrow, SourceBadge (6 sources), StatusMark, Sheet, Skeleton, Avatar; `lib/status-meta.ts`; a `/dev/ui` gallery (404 in production); `scripts/ui-lint.ts` (no hex colours or `style={{` in `src/app`).
Done when: gallery screenshots light and dark at 390 px compared with the design boards; `ui-lint`, typecheck and lint pass.
Done 10 Oct: primitives in `components/ui` (icons, chip, field, check-row, otp-input, surface, marks, source-badge, segmented-progress, eyebrow, sheet; Button gained the design variants `primary line strong plain quiet underline` and sizes `xl lg md row text`, legacy variants kept until T69). `lib/status-meta.ts`. `/dev/ui` renders all of them in a light and a dark panel; `scripts/design-shots.ts` captures the 36 design boards and app pages (light and dark, `SHOT_STEPS=1` for full-size slices) and the gallery was compared slice by slice with the boards. `ui-lint` PASS (2 legacy files not checked yet), typecheck and lint pass. The code input takes a length: Greenhouse codes are 8 characters, letters and digits, so the code screen uses 8 boxes where the design draws 6.

<a id="t60"></a>
### [x] T60 — Patterns
Do: TopBar, TabBar, ProfileMenu, StepHeader, PageIntro, StickyFooter, ChipGroup, SectionCard and Row, InfoNote, TrustPanel, EmptyState, JobCard, SwipeDeck, AgentToast, FilterSheet, QuestionPrompt, CodePrompt, ApplicationRow, Timeline, FieldList, ScreenshotFrame, FailureCard and the drawings, all in the gallery.
Done when: every pattern renders in the gallery with real-shaped data, light and dark.
Done 10 Oct: shared patterns in `components/patterns` (shell-context, top-bar with Feed/Title/Back bars and UsagePill, tab-bar, profile-menu, layout with Screen/StepHeader/PageIntro/ScreenBody/StickyFooter, chip-group, content with SectionCard/Row/InfoNote/Callout/TrustPanel/EmptyState, drawings, job-card, agent-toast); the notifier is split into `components/notifications.tsx` (always-mounted notifier plus the menu switch, one shared opt-in store). All render in `/dev/ui` light and dark and were compared with boards 02–12, 16–17. Patterns used by one screen only (deck gestures, needs-you prompts, application rows, timeline, field list, screenshot frame, failure card) are built in that screen's task against real data. Typecheck and lint pass.

<a id="t61"></a>
### [x] T61 — App shell and theme
Do: the signed-in layout uses TopBar, TabBar (2 tabs) and ProfileMenu (with the notifications toggle moved in unchanged); next-themes ThemeProvider so dark mode follows the system.
Done when: `shell-smoke`, `notify-smoke` and the nav checks in `answers-smoke` and `governance-smoke` pass; screenshots light and dark.
Done 10 Oct: `(app)/layout.tsx` mounts the TabBar (Discover, Applications), the notifier and the input popup once, inside a 480 px column at every width; each page draws its own top bar (Discover bar, title bar, or back bar) with the profile menu, which holds Saved answers, Fill your gaps, Governance, Account and data, the notifications switch and Sign out. next-themes follows the phone's light or dark setting. `nav-tabs`, `user-menu`, `needs-input-notifier` and `logo` removed. `shell-smoke` PASS (rewritten for two tabs, the lime badge, the menu links and the centred desktop column), `notify-smoke` PASS (switch now in the menu), `answers-smoke` PASS, `governance-smoke` PASS (both now profile-menu pages). Dark screenshot of /applications checked.

<a id="t62"></a>
### [x] T62 — Discover (boards 08–12)
Do: deck, card, filter sheet, empty states; usage pill; gaps line; the after-swipe toast following the real status; error toasts restyled with the same triggers.
Done when: `feed-smoke`, `ui-smoke` and `theme-smoke` pass; screenshots match the boards.
Done 10 Oct: Discover rebuilt from patterns: FeedTopBar (profile, usage pill, filters with a lime count), the job card with the tilted match badge and "Why it fits", `patterns/swipe-stage.tsx` (drag, tilt, stamps, the next card rising, buttons growing, the card thrown off screen; physics from `lib/motion.ts`), the filter sheet (same reload-on-choose chip links; Reset in the header), "You're all caught up" with today's counts and "No jobs match these filters" with one removable chip per filter. Swipe behaviour unchanged (optimistic pop, 429/403/409 handling, refill at 5, arrow keys). The after-swipe card follows the real status through `GET /api/applications/{id}` (checked with a scripted run: Waiting in line → Reading the form → Filling it in → Submitted, then hides). Error toasts keep their triggers, restyled as the design's dark card; a blocked swipe now names the reason ("Match too low") with the rule underneath. Kept beyond the design because they are features today: the gaps line under the top bar and "View job" on the card. The sheet button reads "Show jobs" (the count is not known before the feed is scored). `feed-smoke` PASS (updated for the design's wording and hooks), `ui-smoke` PASS, `theme-smoke` PASS; /feed light and dark compared with boards 08–12.

<a id="t63"></a>
### [x] T63 — Needs-you sheet (boards 13–14)
Do: the design's sheet with the same triggers and no dismissal; code questions use the 6-box code input.
Done when: `ui-smoke` and `_t13-check` pass; screenshots match the boards.
Done 10 Oct: `needs-input-dialog.tsx` is the design's bottom sheet: lime "Needs you · 1 of N", the company tile and role, the question large, up to four options as big answer buttons (more use a native picker), text answers in the design's input box, and for `security_code` the code boxes with Paste code. Same triggers, same fetches, same POST and the same error handling; it still opens by itself and cannot be dismissed (no "Later", no "Remember", no "All sorted" step, by decision). Inputs keep `id=answer-<key>`. `ui-smoke` PASS. A scripted check with fixtures (light and dark) PASSED: cannot be dismissed by Escape or a tap outside, an empty answer is refused, a Yes/No answer and an 8-character code are sent exactly as before and the sheet closes. `_t13-check` needs the worker running and was not run. Code boxes: 8, because Greenhouse codes are 8 characters.

<a id="t64"></a>
### [x] T64 — Applications list (board 16)
Do: filter chips with counts, grouped sections, the four row kinds, live progress, actions.
Done when: `applications-smoke`, `lifecycle-smoke`, `ui-smoke` and `theme-smoke` pass; screenshots match.
Done 10 Oct: title bar with "N sent today · N left · Your agent is working on N"; filter chips with counts (All, Needs you, In progress, Sent, Didn't go through) replace the tiles; grouped sections with the four row kinds in `patterns/application-row.tsx` (needs you: raised card with Answer or Enter code; in progress: four segments and the stage in words with "· N ahead"; sent: ink check; didn't go through: dashed with the reason and Retry or "Nothing to do"). `ApplicationActions` has an inline look (rows) and a panel look (detail), same calls, confirm and toasts. Same 3 s poll. Needs-you rows say "Their form asked something only you can answer" because the list API does not carry the question text. `applications-smoke`, `ui-smoke`, `theme-smoke` (now checks ink and dashed instead of the old colours) and `lifecycle-smoke` PASS. Compared with board 16, light and dark.

<a id="t65"></a>
### [x] T65 — Application detail (boards 17–18)
Do: header, failure card, trust panel, story, filled values with sources and basis, screenshot frame, technical details.
Done when: `applications-smoke` and `lifecycle-smoke` pass; screenshots match.
Done 10 Oct: back bar; company tile, title, place and a status pill ("Sent today, 12:23" or the design's status word); the "What happened / What you can do" card for anything not sent, with `explainOutcome` and the existing actions; "Nothing here was made up" with a count per source; "The story" timeline (`patterns/detail.tsx`) from `buildSteps` with each step's event time and "You swiped right" first, listing only what has happened; every filled value with its source badge and "Why:" basis, AI drafts in the dashed box; the screenshot in the design's light browser frame with its time and "View full size"; "Open the original posting"; Technical details kept, collapsed. `applications-smoke` PASS (the screenshot now shows straight away as in the design, so that check changed), `lifecycle-smoke`, `ui-smoke`, `theme-smoke` PASS. Compared with boards 17 and 18.

<a id="t66"></a>
### [x] T66 — Onboarding (boards 03–07)
Do: upload and reading, what we found, the two question screens, on the 3 existing URLs with the same saves.
Done when: a fresh test user completes onboarding in the browser and the saved answers use today's keys and values; screenshots match.
Done 10 Oct: three steps with the design's step header. `/onboarding/resume`: drop zone, file card with Replace, then the reading screen (sweeping band, five findings revealed one by one from GET /api/profile after the same POST /api/profile/resume). `/onboarding/confirm`: "Here's what we found" with the missing-phone card, pencil-edit rows, Experience, Skills, Education (now shown), saved answers; "Looks right" sends the same two PUTs and moves on. `/onboarding/questions`: two screens (CTC with ₹ and "lakh a year", notice chips saving days, 0 for Immediate; kind of job, places, the "Working abroad" card), one PUT /api/answers at the end. Kept today's options where the design differs (Part-time; India, US, Other); left out Roles and visa status (no data for them). New `scripts/onboarding-smoke.ts` PASS light and dark: the saved answers are exactly today's keys and values. Compared with boards 03–07.

<a id="t67"></a>
### [x] T67 — Opening animation and sign-in (boards 01–02)
Done when: `/sign-in` plays the splash and signs in as before; screenshots match.
Done 10 Oct: `/sign-in` plays the opening animation (`patterns/opening.tsx`) once per browser session through a cookie the server reads, then board 02 (logo, fanned cards, "Swipe right. We'll apply.", Continue with Google through the same server action). The design's Terms and Privacy line is left out because those pages do not exist. `theme-smoke`, `shell-smoke` and `security-test` PASS; compared with boards 01–02.

<a id="t68"></a>
### [x] T68 — Saved answers, Fill your gaps, Account and data, Governance in the design's language
Done when: `answers-smoke` and `governance-smoke` pass; screenshots light and dark.
Done 10 Oct: the four profile-menu pages rebuilt from the same parts (title bar, section labels, hairline cards with rows, source badges, a lock on sensitive answers, raised cards for adding and deleting, display-number stats on governance). Every behaviour and `data-*` hook kept; shared loading and error states. `answers-smoke` and `governance-smoke` PASS; light and dark screenshots checked.

<a id="t69"></a>
### [x] T69 — Final pass
Do: delete legacy status tokens and dead components; loading, empty and error states everywhere; keyboard and screen-reader pass; desktop centring.
Done when: every smoke and `contrast-check` pass and a screenshot set covers all 36 boards.
Done 10 Oct: removed the old status badge, company avatar, logo, nav tabs, user menu, bell, and the unused dialog, card, tabs, progress, select and badge primitives; the old coloured status tokens; the legacy button variants (only `default` stays, for the mock ATS form); the starter home page is now a redirect. Every screen has loading, empty and error states (`patterns/states.tsx`); one 480 px column centred at every width. DESIGN.md and ARCHITECTURE.md describe the new build. Typecheck, lint, `ui-lint` (no legacy files left) and `contrast-check` PASS. After clearing fixtures left by an interrupted run, `shell`, `feed`, `ui`, `applications`, `lifecycle`, `answers`, `governance`, `notify`, `theme`, `onboarding` smokes and `security-test` all PASS. Screenshots were compared with all 36 boards screen by screen in T59–T68. Not done: an automated axe accessibility audit (no axe in the stack); keyboard use is covered by the smokes (arrow keys, Escape, focus rings on every control).
