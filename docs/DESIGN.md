# DESIGN — SwipeApply

Tokens live in `src/app/globals.css` (`:root` for light, `.dark` for dark). Change a colour there and nowhere else. Components use the semantic names (`bg-primary`, `text-muted-foreground`, `bg-success-soft text-success`), never raw palette colours.

Rules from CLAUDE.md still apply: mobile first at 390 px, centred at 480 px on desktop, shadcn/ui, one brand accent plus the fixed status colours, no gradients, no emoji.

## Colour

| Token | Light | Dark | Used for |
|---|---|---|---|
| `background` | `#f6f7fb` | `#0d0f1f` | page |
| `card`, `popover` | `#ffffff` | `#151833` | cards, dialogs |
| `foreground` | `#12152e` | `#eceefc` | body text |
| `muted-foreground` | `#5a607c` | `#a3a9c8` | secondary text |
| `primary` | `#4f46e5` | `#818cf8` | the one brand accent: main buttons, active chips, links |
| `primary-foreground` | `#ffffff` | `#0d0f1f` | text on the accent |
| `accent` / `accent-foreground` | `#e8eaff` / `#3730a3` | `#262b57` / `#c7ccff` | hover and selected backgrounds |
| `secondary`, `muted` | `#eceefa` | `#1f2347` | quiet fills |
| `border` / `input` | `#dfe2ef` / `#d4d8e8` | `#2a2e57` / `#333865` | lines |
| `ring` | `#6366f1` | `#818cf8` | focus ring |

### Status and source pairs

Always a soft background with a strong text colour, used together.

| Meaning | Classes | Where |
|---|---|---|
| success | `bg-success-soft text-success` | Submitted |
| warning | `bg-warning-soft text-warning` | Needs your input |
| info | `bg-info-soft text-info` | Reading form, Filling (pulsing), "You" source |
| danger | `bg-danger-soft text-danger` | Failed; Blocked uses `border-danger text-danger` outline |
| ai | `bg-ai-soft text-ai` | AI draft source |
| neutral | `bg-muted text-muted-foreground` | Queued, Resume source; Cancelled and Default are outlines |

## App shell

`src/app/(app)/layout.tsx` wraps every signed-in page: sticky header (logo, top nav on desktop, account menu), a bottom tab bar on mobile, and the needs-input popup, mounted once. Pages render only their content, never their own `<main>`, nav or sign-out. A new page goes under `(app)/`; a new tab is one entry in `TABS` in `src/components/nav-tabs.tsx`. The Applications tab shows a live count of applications waiting for the user. Check: `scripts/shell-smoke.ts`.

## Feed card

The swipe card (`src/app/(app)/feed/swipe-deck.tsx`) shows a company-initials avatar, role, company, a match ring (green from 70, brand colour from 50, amber below, with the number inside and a spoken label), location and posted-ago, tags (remote type, "Entry level" or "N+ yrs asked", up to four matched skills) and the one-line reason. Dragging builds a green tint and an APPLY stamp to the right, a grey tint and a SKIP stamp to the left; a short drag springs back. Filters live in a bottom sheet (`filter-sheet.tsx`) that reuses the server-rendered chip links; the page shows a plain-words summary of what is active, a count on the Filters button and a Reset link. Both empty cases (no jobs match; deck finished) explain what happened and offer a next step. Check: `scripts/feed-smoke.ts`.

## Applications

List: a four-tile summary strip (Submitted, In progress, Needs you, Failed) that is also the filter (tap to filter, tap again or "Show all" to clear; `aria-pressed`). Each row has a company avatar, role, company, status badge, when, and, for anything not yet submitted, a plain-language outcome with what to do next (`src/lib/explain.ts` maps every block rule and known failure message to wording; unknown ones get a safe default with a Retry hint). Detail: a coloured callout (headline, next step, Retry or Cancel) for anything not submitted; a vertical "What happened" timeline worked out from the audit events (`src/lib/steps.ts`; it marks the current step or where it stopped, and shows the confirmation under Submitted); the filled fields grouped under Contact, Links, Documents, Experience, Your answers and Equal opportunity with source badges (`src/lib/field-groups.ts`); the pre-submit screenshot and the raw events and error each in a collapsed section. Checks: `scripts/explain-test.ts` (offline) and `scripts/applications-smoke.ts`.

## Shape and depth

- Radius `--radius: 0.75rem`; cards and list rows use `rounded-xl`.
- `shadow-card` for resting surfaces, `shadow-pop` for floating ones (dialogs, menus).
- Headings use tight tracking and balanced wrapping.

## Checks

- `npx tsx scripts/contrast-check.ts` reads the tokens from `globals.css` and checks every text pair at 4.5:1 and the focus ring at 3:1, light and dark.
- `npx tsx scripts/theme-smoke.ts` (needs `npm run dev`) checks the real computed colours in a browser at 390 px and saves screenshots of sign-in, feed, applications and detail, including dark.
