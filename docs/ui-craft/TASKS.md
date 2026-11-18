# Phase O tasks — UI craft

The task file for [AUDIT.md](AUDIT.md) (findings, principles, plan). Root [docs/TASKS.md](../TASKS.md) Phase O lists these one line each. Order O1 → O6; every task follows the `ui-craft` skill (`.claude/skills/ui-craft/SKILL.md`).

<a id="o1"></a>
### [x] O1 — Direction mockups, owner picks one
Do: two or three static directions of the feed card and the job page in `design/craft-*.html`, light and dark at 390 px, each applying AUDIT section 2; the open decisions of AUDIT section 4 shown side by side.
Design: [AUDIT 2](AUDIT.md#2-what-not-ai-generated-means-here-principles) · [AUDIT 4](AUDIT.md#4-open-decisions-for-the-owner).
**Done when:** the owner picks a direction (or its changes are made); the choice is written in DESIGN.md.
Done 18 Nov: owner picked Direction B (`design/craft-b.html`, warm paper and ink, orange accent, Schibsted Grotesk) over A (`craft-a.html`, refined lime); both checked at 390 px light and dark with Playwright, 0 overflow. DESIGN.md top note. Premium pass in `design/craft-b2.html` (8 px grid, 40/500 score that counts up, burnt orange `#C2410C`, half-pixel hairlines, long soft depth, 98 % press, loading card), awaiting the owner.

<a id="o2"></a>
### [x] O2 — Foundations and ui-lint
Do: `src/app/globals.css` tokens (type scale, spacing, 3 radii, 1 elevation, colour roles), `src/lib/motion.ts` curves, DESIGN.md Type / Shape / Motion / Colour; `scripts/ui-lint.ts` (arbitrary sizes, uppercase, rounded-full, hard shadows, per file); the skill's rules updated to the chosen tokens.
Design: [AUDIT 1 B](AUDIT.md#b-no-system-underneath-vibe-coded) · [AUDIT 3](AUDIT.md#3-the-plan-phase-o).
**Done when:** ui-lint prints per-file counts and a baseline; typecheck and lint pass.
Done 18 Nov: look switch (`<html data-look>`, `NEXT_PUBLIC_LOOK`, `?look=b` cookie) with Direction B values for every token in light and dark; Schibsted Grotesk, five `type-*` utilities, radii 6/10/16, `shadow-lift`, `ease.calm` + `transition.tap`. Checked in `/dev/ui` at 390 px: classic unchanged, B light and dark apply. `scripts/ui-lint.ts` baseline 678 hits in 58 files, `--check` PASS. DESIGN.md, skill.

<a id="o3"></a>
### [x] O3 — Components
Do: `components/ui` (Button, Chip/Tag/Badge into two, Surface into one, Eyebrow retired, marks, icons) and `/dev/ui` showing every state.
Design: [AUDIT 1 A, B](AUDIT.md#1-findings).
**Done when:** `/dev/ui` at 390 px light and dark shows rest, pressed, focus, disabled and loading for each control; ui-lint zero in `components/ui`.
Done 18 Nov: `components/ui` from 190 hits to 4 (three toggle pills, one round status mark). Buttons 48/44 px with a 98 % tap, ink focus ring and recessed disabled; selected chips ink, facts as tags; Surface one lift; MatchBadge, TierPill and the drag labels flat (no stickers or rotation); one icon stroke (1.75, 2.25 under 16 px); checkbox off the "ink" token. `/dev/ui` "Button states" row checked at 390 px in look B.

<a id="o4"></a>
### [x] O4 — Screens, one at a time
Do: feed card, job page, applications, application detail, onboarding, sign-in, account and answers, then the empty / loading / error states; one commit per screen.
Design: [AUDIT 3](AUDIT.md#3-the-plan-phase-o).
**Done when:** per screen, before and after screenshots light and dark at 390 px; ui-lint zero for its files.
Done 18 Nov: every screen on B: feed card (craft-b2, split score bar, text skills), stage, top and tab bars, card-shaped loading; job page (hero, facts grid, open sections, breakdown); applications, onboarding, account, answers, gaps through a mechanical codemod (327 changes) plus hand fixes (accent only on the main action and the score; edge borders under the lift removed); drawings only on caught-up and onboarding, a quiet icon elsewhere; sign-in a flat card, Google the primary action. ui-lint 678 → 34 (circles and the mock ATS), baseline rewritten. Shot with Playwright at 390 px light and dark: card, job page and states via `/dev/ui`, sign-in live; signed-in screens not opened.

<a id="o5"></a>
### [x] O5 — Copy and voice
Do: a voice section in DESIGN.md; every UI string reviewed against it; match reasons (`match.ts`, `semantic.ts` why) rewritten to read like a person.
Design: [AUDIT 1 C](AUDIT.md#c-the-voice-is-the-assistants-not-the-products).
**Done when:** no string fails the voice checklist; "your agent" only where the user must know the agent acted.
Done 18 Nov: voice section in DESIGN.md; 47 "your agent" strings reviewed, narration and system-explaining lines cut (feed loading, "working on", filled-in titles, no-resume, onboarding callout, score notes), the agent kept for its own actions; match reasons drop "Fits your experience" / "In a place you want" (facts on the card); stamps "Apply" / "Skip". `match-test`, `score-breakdown-test` PASS.

<a id="o6"></a>
### [x] O6 — Motion and the small things
Do: curves outside the swipe calmed; press, focus, disabled, loading on every control; tabular numbers, truncation rules, icon sizes and strokes.
Design: [AUDIT 1 D](AUDIT.md#d-the-small-things-not-yet-checked-screen-by-screen).
**Done when:** the skill's "Before finishing" passes on every screen.
Done 18 Nov: overshoot only under the finger (card return, buttons growing on drag); the toast and the Sent check settle with `ease.calm`, no spin; taps scale to 0.98 on buttons, chips and icon buttons; one icon stroke; tabular figures only on numbers (they widened punctuation in Schibsted, fixed on sign-in and facts). Look B is the default (`NEXT_PUBLIC_LOOK=classic` to go back). typecheck, lint, ui-lint `--check`, match-test, score-breakdown-test, feed-sql-test PASS.
