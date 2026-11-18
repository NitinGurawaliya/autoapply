---
name: ui-craft
description: Use for any SwipeApply UI work — a new screen, a component, a mockup in design/, a copy change, or a "make it look better" request. Keeps the UI designed rather than AI-template: one type scale, few shapes, plain copy, every state drawn, checked on screen in light and dark at 390 px.
---

# ui-craft — SwipeApply UI that does not look AI-generated

The owner's complaint (18 Nov): the app "feels vibe-coded… the AI-generated UI feel… not UX-driven, not original". The audit is `docs/ui-craft/AUDIT.md`; read its section 2 (principles) and, for a Phase O task, its section 3 row. `docs/DESIGN.md` stays the spec: read only the sections your change touches (Type, Shape and depth, Motion, Colour, or the screen's row).

## Before writing UI
1. Find the screen's mockup in `design/` and its row in DESIGN.md Screens. If the change alters the visual language (a new size, radius, colour, shadow, motion curve), it changes DESIGN.md in the same change, and a new look goes through a static mockup the owner approves first (as Phase M1 did).
2. Reuse `components/ui` and `components/patterns`. A new primitive is a last resort and goes into `/dev/ui` (`src/app/dev/ui/gallery.tsx`) with all its states.

## Rules (each one is a thing the audit counted)
- **Type:** Direction B's five utilities only: `type-score` (40/500), `type-heading` (24/600), `type-section` (17/600), `type-body` (15), `type-meta` (13); one family (Schibsted Grotesk). Never `text-[13px]` or any arbitrary size, never `font-display` / `font-extrabold` / `type-display-*` / `type-eyebrow` in rebuilt code. Tabular figures (`tabular-nums`) only on numbers that line up in a column or count up, never on a line with words: in Schibsted Grotesk it also widens commas and full stops.
- **Labels:** sentence case. No uppercase letter-spaced eyebrow over a block whose first line already says what it is. No "·"-joined strings of three or more parts; pick the one or two facts that matter.
- **Shapes:** radii `rounded-tag` 6, `rounded-control` 10, `rounded-card` 16 only. Pills (`rounded-full`) only for things the user toggles (filters, segmented choices). Hairlines (`border-line`, 0.5 px where they only separate); no 2 px or 1.5 px borders. Depth is `shadow-lift` only; never `shadow-hard*` or `shadow-button`.
- **Colour:** tokens only, never a hex in a component. Neutrals by default; the orange accent (`primary`, `brand-text`) only on the main action and the match number, with `ink` on it. Meaning by form, not tints: a required gap is an ink dashed underline, a nice-to-have gap is grey. No gradients, no emoji.
- **Buttons:** one primary action per screen. Secondary actions are quieter (outline or text), not a second filled accent button. Every button has rest, pressed, focus-visible, disabled (visibly different from secondary) and loading.
- **Copy:** plain and specific; say what happened or what to do. No narration of the AI ("Your agent is…") unless the user must know the agent did it. No helper paragraph that explains the system. Numbers and names over adjectives. Copy the product's own words for things (Sent, Needs you, Didn't go through).
- **Motion:** `lib/motion.ts` only. `transition.tap` (scale 0.98, 120 ms, `ease.calm`) for taps; `ease.calm` for anything that appears; overshooting springs only where a finger drags (the swipe deck).
- **Details:** long text truncates on purpose (one or two lines, with a title attribute); numbers use tabular figures where they line up; icons at the icon component's sizes with one stroke weight; tap targets 44 px without looking oversized; every screen has loading, empty and error states.

## Before finishing
1. Run `npx tsx scripts/ui-lint.ts <file-or-folder>`: a rebuilt file should reach zero, and `npx tsx scripts/ui-lint.ts --check` must PASS (no file gains a hit over the baseline). After a rebuild lowers counts, rewrite the baseline with `--write-baseline` in the same change.
2. Open the screen in the browser pane at 390 px, light and dark (`resize_window` width 390; `colorScheme`), (look B is the default; `?look=classic` shows the old look for comparison). Screenshot both; compare with the mockup in `design/`. Look at the small things: alignment of baselines and icons, spacing rhythm, truncation, the pressed and disabled states.
3. Read every new string aloud once: would a careful product writer ship it?
4. `npm run typecheck && npm run lint` (CLAUDE.md).

## Never
- Restyle a screen the task does not name. Small diffs (CLAUDE.md).
- Copy another product's look. Take content and behaviour from references, never their visual identity.
