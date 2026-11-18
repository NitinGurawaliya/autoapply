# UI craft audit — why SwipeApply looks AI-generated, and the plan (18 Nov 2026)

Owner, 18 Nov: "the UI feels very vibe-coded… the AI-generated UI feel is for the entire app. It's not UX-driven, and it doesn't feel very original… all buttons and labels, very small, minor things."

How this was measured: every `.tsx` under `src/app` and `src/components` searched for the patterns below (counts as of commit `b358006`), plus the sign-in page and `/dev/ui` at 390 px in dark. Signed-in screens were not opened (no sign-in in the browser pane); they are built from the same components the gallery shows.

## 1. Findings

### A. The look is a template (identity)
These patterns are what people now recognise as "made with an AI design tool". Each is fine alone; together they are the template.

| # | Pattern | Where | Count |
|---|---|---|---|
| A1 | Lime on ink with a solid offset shadow and 2 px ink border ("neo-brutalist") on cards, buttons, stamps | `shadow-hard*`, `border-2`/`border-[1.5px]` | 29 · 87 |
| A2 | Bricolage Grotesque 800 headlines with tight negative tracking, Geist body | `font-display`, `font-extrabold` | 24 · 21 |
| A3 | Rotated stickers and stamps: the round "Strong MATCH" sticker, the tilted "APPLY" stamp, the fanned card stack on sign-in | `marks.tsx`, `opening.tsx`, sign-in | — |
| A4 | Pills for everything: filters, tags, badges, tiers, counts, source badges | `rounded-full` | 72 |
| A5 | A tiny uppercase letter-spaced label over every block ("WHY IT FITS", "YOU HAVE", "MATCHES · 3", "TYPE") | `uppercase` + `tracking-[…em]`, `<Eyebrow>` | 9 + 18 |
| A6 | Big soft radii everywhere (28, 24, 22, 20, 18, 16, 14, 13, 12, 8): boxes inside boxes | `DESIGN.md` Shape | 10 radii |
| A7 | Bouncy motion: overshooting curves on almost everything (`pop` 1.2, `spring` 1.15, `bounce` 1.56) | `lib/motion.ts` | 4 of 5 curves |

### B. No system underneath (vibe-coded)
| # | Finding | Evidence |
|---|---|---|
| B1 | 23 different font sizes; the `type-*` scale in DESIGN.md is bypassed | 154 `text-[Npx]` (13, 15, 12.5, 11, 10.5, 10, 9, 17, 19, 22, 25, 26, 28, 30, 32, 40, 44 px…) — Phase M's card added several |
| B2 | Spacing and sizes hand-set per element | 404 arbitrary `[Npx]` values |
| B3 | Buttons are all big: 56 px full-width lime for the main action, 52 px for the second, near-identical variants; a disabled button looks like a quiet one | `button.tsx` sizes, gallery "Buttons" |
| B4 | Five card styles for one job (raised, quiet, dashed, dashed ink, subtle) | gallery "Surfaces" |
| B5 | The middle dot `·` joins everything ("Lumen Pay · paused 4m ago", "Needs you · 1 of 2", "Bengaluru · Hybrid") | most meta lines |

### C. The voice is the assistant's, not the product's
| # | Finding | Evidence |
|---|---|---|
| C1 | "Your agent" in 29 strings; the UI narrates what it is doing | copy search |
| C2 | Helper text under sections explains the system instead of helping the user decide ("Read from your resume. Matching reads your whole resume; these set the field filter in your feed.") | onboarding confirm, job page |
| C3 | Sentences built like model output: "X, like yours", "Uses your A, B and C", "Fits your experience" joined with periods | match reasons |

### D. The small things (not yet checked screen by screen)
Press, focus and disabled states; tap targets that are 44 px but look 56; icon sizes and stroke weights (11–20 px, strokes 2–3); number formatting; truncation; loading skeletons; empty states with drawings (`patterns/drawings.tsx`). These need the screen-by-screen pass in step 3 of the plan.

## 2. What "not AI-generated" means here (principles)
1. **Content first, chrome last.** The job, the company, the score and the status are the design; boxes, borders, pills and shadows are only there when they carry meaning.
2. **One type scale, used everywhere.** Six sizes, two weights, one display face used rarely. No arbitrary sizes.
3. **Hierarchy by size, weight and spacing, not by decoration.** No label over a block when the block's first line says what it is; sentence case, never letter-spaced capitals.
4. **Few shapes.** Three radii, one elevation, one border weight. Pills only for things you toggle (filters).
5. **Small, calm controls.** The main action is clear without being 56 px of lime; secondary actions are text or quiet buttons; destructive and disabled states are distinct.
6. **The product speaks plainly.** Short, specific words; no narration of the AI; numbers and names over adjectives.
7. **Motion that confirms, not performs.** Short ease-out transitions; spring only where a finger drags (the swipe).
8. **Details are designed.** Every control has rest, press, focus, disabled and loading states; numbers align; long text truncates on purpose.

## 3. The plan (Phase O)
The visual language is the owner's spec (`design/`, `docs/DESIGN.md`), so it changes with the owner's decision first, then the code.

| Step | What | Done when |
|---|---|---|
| O1 Direction | Two or three static mockups of the same two screens (feed card and job page), each a different direction applying section 2, light and dark at 390 px, like Phase M's mockups. The owner picks one. | Owner picks a direction |
| O2 Foundations | `globals.css` and DESIGN.md: the type scale (≈6 sizes), spacing steps, 3 radii, 1 elevation, motion curves, colour roles; a `scripts/ui-lint.ts` that counts arbitrary `text-[…]`/`[Npx]`, `uppercase`, `rounded-full`, `shadow-hard` per file | ui-lint runs and prints counts; tokens in DESIGN.md |
| O3 Components | `components/ui`: Button (fewer sizes, real states), Chip/Tag/Badge merged into two, Eyebrow retired for sentence-case section titles, one Surface, MatchBadge/TierPill, icons at 2 sizes and one stroke | `/dev/ui` shows every state; ui-lint zero in `components/ui` |
| O4 Screens | One screen per task, in this order: feed card, job page, applications, application detail, onboarding, sign-in, account and answers, empty/loading/error states | Each screen: before/after screenshots light and dark at 390 px; ui-lint zero for its files |
| O5 Copy | A voice guide in DESIGN.md (plain, specific, no "your agent" narration); every string reviewed; match reasons rewritten to read like a person | No string fails the voice checklist |
| O6 Motion and details | Calmer curves outside the swipe; press, focus, disabled, loading on every control; number and truncation rules | The skill's checklist passes on every screen |

The `ui-craft` skill (`.claude/skills/ui-craft/SKILL.md`) holds section 2 as a checklist so every future UI task follows it; it is updated with the chosen direction's tokens after O1–O2.

## 4. Decisions closed with the owner (18 Nov)
1. **How far:** O1 shows both, `design/craft-a.html` (same brand, refined: lime stays, the template patterns go) and `design/craft-b.html` (new identity); the owner picks after seeing them.
2. **Accent for craft-b:** warm orange (around `#E8590C` on white, softened in dark), used only for the main action and the match number.
3. **Fonts:** one family throughout, hierarchy from size and weight (title 24/600, body 15/400, meta 13/400, score 32/600 tabular); Bricolage goes in both directions.
4. **Empty screens:** a drawing only on onboarding and "all caught up"; everywhere else a short line, one icon and one action.
5. **Kept whatever the look:** the swipe gesture and its feel, dark mode as an equal theme, the Phase M card content (score, tier, chips, You have / Missing, reason), and the name and wordmark (colour or weight may change).
