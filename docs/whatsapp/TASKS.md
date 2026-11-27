# Phase Y tasks — SwipeApply on WhatsApp

The task file for [TDD.md](TDD.md). Root [docs/TASKS.md](../TASKS.md) Phase Y lists these tasks one line each and links here; this file holds the full entry per task: Do, the design sections it builds, Done when, and the `Done <date>:` line once it lands. Mark `[~]` / `[x]` here first, then on the root line.

Order Y1 → Y7, one session each, plan first, the Done-when check run and its output pasted, typecheck and lint. Everything stays behind `WHATSAPP_ENABLED=0` until Y7, so each task lands on main with the app unchanged for everyone else. Y1 needs the owner's approval of the copy before Y3 submits any template. Y8 only on Y7's numbers.

Before Y2 the owner provides: a Meta developer app with WhatsApp added (its test number is enough until Y7), the app secret, a System User token, and the phone number id. Rules in CLAUDE.md (no personal data in messages or logs; routes enqueue, the worker acts) and TDD §4.8–4.9.

<a id="y1"></a>
### [ ] Y1 — The card and the chat, drawn for approval
Do: `design/whatsapp.html` (the ui-craft skill): the Account card in its six states (unlinked, linking, linked, paused, stopped, disabled) light and dark at 390 px from the tokens in `design/`; beside it one day's chat as copy (link, the morning digest, a card with Apply / Skip / More, the Apply reply, a 15:10 drop, a list question, the answer, "Sent", STOP and its confirmation); `copy.ts`'s strings are taken from this page; `docs/DESIGN.md` gets a WhatsApp section.
Design: [5 UI](TDD.md#5-ui) · [4.4 State machine](TDD.md#44-conversation-state-machine) · [4.6](TDD.md#46-sequence-the-morning-and-the-drops-y3-y5) · [4.7](TDD.md#47-sequence-a-question-and-a-result-y4).
**Done when:** every state and every message above is on the page in light and dark, screenshots taken in the browser pane at 390 px, and the owner has approved the words (the three template texts marked on the page).

<a id="y2"></a>
### [~] Y2 — Receive, send, link
Do: Prisma `WhatsAppLink`, `WhatsAppMessage`, `WhatsAppLinkCode` and the migration (`migrate deploy`); `modules/whatsapp/client.ts`, `webhook.ts`, `link.ts`, `state.ts`, `index.ts`; `api/whatsapp/webhook` (raw body, HMAC, store, enqueue), `api/whatsapp/link` (POST, GET, DELETE); the `whatsapp-inbound` queue and handler with the link flow and the stranger reply; the Account card (`components/account/whatsapp-card.tsx`); env in `.env.example`; ARCHITECTURE §6.25 and §11 record the decisions; §2 of the TDD gets the rate card's real numbers.
Design: [3 Options and decision](TDD.md#3-options-and-decision) · [4.1 items 1–3, 8, 10, 11](TDD.md#41-components) · [4.2 Queues](TDD.md#42-queues-pg-boss) · [4.3 Data model](TDD.md#43-data-model-prisma-additions) · [4.5 Sequence: link](TDD.md#45-sequence-link-y2) · [4.9 Security](TDD.md#49-security-and-privacy) · [4.12 Code map](TDD.md#412-code-map) · [4.13 Env](TDD.md#413-env-architecture-11-additions) · [6 API](TDD.md#6-api).
**Done when:** `whatsapp-test` PASS (signature good and tampered, duplicate wamid stored once, link code claimed once, expired and foreign codes refused, a test profile refused for a number not in `WHATSAPP_TEST_NUMBERS`); on Meta's test number the owner links from the Account card by sending the prefilled message and the card shows the masked number within 10 s; a stranger's message gets the one link line and nothing more; no phone number in any log line; typecheck and lint pass.
Done 28 Nov (offline part only; the entry stays `[~]`): `whatsapp-test` PASS, 81 checks (signature, parsing, duplicate wamid, code claimed once, expired, foreign, test profile, stranger reply, Graph client on a stubbed fetch); `tsc --noEmit` clean; eslint on `src` and `scripts` clean. Code in `src/modules/whatsapp`, `src/app/api/whatsapp/{webhook,link}`, `worker/handlers/whatsapp-inbound.ts`, `components/account/whatsapp-card.tsx`; migration `20261201000000_whatsapp` written and `prisma validate`d, not applied. ARCHITECTURE §6.25 and §11 written.
Still open: `migrate deploy`; the live link on Meta's test number and the card seen in a browser (the Account card was not rendered); the stranger reply on a real number; the rate card's real numbers in TDD §2 (Meta's page not read).

<a id="y3"></a>
### [ ] Y3 — The morning digest and the deck
Do: `cards.ts` (the job card from `FeedJob`), `conversation.ts` (idle and deck), `schedule.ts` (the morning only), the `whatsapp-nudge` cron and handler, the `swipeapply_morning` template submitted in WhatsApp Manager and its name in `copy.ts`; Apply through `swipeRight`, Skip through the left-swipe path (the family), More with the public job page link; `PATCH /api/whatsapp/settings` for `morningAt` and `timezone`; `FunnelEvent` kinds `whatsapp_digest`, `whatsapp_apply`.
Design: [4.1 items 4, 5, 7](TDD.md#41-components) · [4.4 idle, deck](TDD.md#44-conversation-state-machine) · [4.6 items 1, 2, 4](TDD.md#46-sequence-the-morning-and-the-drops-y3-y5) · [7 Testing](TDD.md#7-testing).
**Done when:** `whatsapp-test` PASS for the deck transitions (first card, Apply ok, Apply blocked with the rule's words, Skip, More, end of set, 30-minute timeout); the digest arrives on the owner's phone at the time set in Account (zone respected, checked on two days' plans); "Show me" shows the first unswiped card of today's set and Apply on it starts an application that the app's list shows as the same application; a swipe in the app removes the job from the next card; the template is approved as utility.

<a id="y4"></a>
### [ ] Y4 — Questions and results on WhatsApp
Do: `cards.question` (buttons ≤3 options, list ≤10, text otherwise, the code prompt, the unrenderable types sent to the app), the **ask** mode in `conversation.ts`, `modules/whatsapp.notifyNeedsInput` and `notifyResult`, the `whatsapp-send` queue and handler with the `window_closed` fallback, the `swipeapply_needs_you` template, the shared save-answers function the answers route and the chat both call (the route keeps its behaviour), `via whatsapp` on the event, the morning digest's "Yesterday" line; `lib/notify.ts` calls the module.
Design: [4.1 items 5, 9](TDD.md#41-components) · [4.4 ask](TDD.md#44-conversation-state-machine) · [4.7](TDD.md#47-sequence-a-question-and-a-result-y4) · [4.10 Failure handling](TDD.md#410-failure-handling) · [4.11 Observability](TDD.md#411-observability).
**Done when:** `whatsapp-test` PASS for the ask transitions (3 options, 7 options, free text, a code, a wrong code twice, skip on optional and on required, a parked deck resumed, an application finished in the app); `whatsapp-smoke` on `/mock/greenhouse` with a test profile: a run pauses, the question arrives as buttons, the tap resumes it, "Sent" arrives, the application page shows the answer with `source = user` and `via whatsapp`; a code asked by a real Greenhouse run on the owner's profile is answered from the chat and the run submits; a window closed for 25 hours sends the template and the question follows the tap.

<a id="y5"></a>
### [ ] Y5 — Drops, pace and consent
Do: the five `whatsapp_*` rules in `config/rules.json` and `modules/governance`; `schedule.ts` drops (random times, quiet hours, gap, the daily cap, back-off on `ignored`), the `swipeapply_drop` template with the job id in its button payload; STOP → confirm → `optedOutAt`, "start", "pause N days" → `pausedUntil`; `dropsPerDay` and `pausedUntil` in settings and on the card; `unlink` and account delete tested.
Design: [4.1 item 7](TDD.md#41-components) · [4.4 confirm_stop](TDD.md#44-conversation-state-machine) · [4.6 item 3](TDD.md#46-sequence-the-morning-and-the-drops-y3-y5) · [4.8 Checks, refusals and pace](TDD.md#48-checks-refusals-and-pace).
**Done when:** `whatsapp-test` PASS for a seeded week of plans (never in quiet hours, never under 3 hours apart, never above the day's cap, no drop after 3 ignored, one reply resets it, a paused or stopped user gets nothing); on the owner's phone two days of drops land at different times inside 10:00–21:00; STOP then "yes" stops the next drop and "start" brings the morning back; Unlink deletes the row and the card shows unlinked; account delete leaves no `WhatsAppLink` or `WhatsAppMessage` row.

<a id="y6"></a>
### [ ] Y6 — Plain words
Do: `intent.ts` (the rule table, then `callJson` with the `{ intent, days? }` schema and a cache key, only outside **ask**), `status` (counts and the last two applications), `help`, the unknown-message line with the app link; `whatsapp-report.ts`.
Design: [4.1 item 6](TDD.md#41-components) · [4.4 idle](TDD.md#44-conversation-state-machine) · [4.9 (the model sees intent only)](TDD.md#49-security-and-privacy) · [4.11 Observability](TDD.md#411-observability).
**Done when:** `whatsapp-test` PASS: 30 recorded phrases ("show me jobs", "kuch aur dikhao", "pause for a week", "what happened with Razorpay", "stop") each land on the right intent, the rules catch the plain ones without a model call (counted), and a phrase sent while a question is pending is saved as the answer and never classified; `status` on the owner's phone matches the app's counts; the report prints one line for the week.

<a id="y7"></a>
### [ ] Y7 — The real number, end to end, switch-on
Do: the SwipeApply number registered (new SIM), business verification, display name, the three templates approved on the real number, `WHATSAPP_*` set in production, the webhook subscribed on the production host, `GET /api/health` with the whatsapp line, `WHATSAPP_ENABLED=1`; `docs/DEPLOY.md` gets the steps; PRD §8 moves WhatsApp into scope.
Design: [4.11 Observability](TDD.md#411-observability) · [8 Rollout](TDD.md#8-rollout) · [9 Risks](TDD.md#9-risks).
**Done when:** the owner, from their own phone and real profile, with the app closed: receives the morning digest, taps Show me, applies to one real Greenhouse job, answers one question in the chat, and receives "Sent"; the application page shows the whole trail; `/api/health` shows the inbound and outbound times; the day's cost in the report matches the rate card; three testers linked without help.

<a id="y8"></a>
### [ ] Y8 — A resume sent as a document (only on numbers)
Do: a PDF document message from a linked user → the resume upload path (`lib/storage.ts`, the same parse and profile rebuild as the app's upload), "Updated your resume" reply; refused above 10 MB or when not a PDF.
Design: [1 Non-goals](TDD.md#1-goals-and-non-goals) · [11 item 7](TDD.md#11-decisions-closed-with-the-owner-26-nov).
**Done when:** decided after Y7's first month: the share of linked users who never open the app, and how many asked for it.
