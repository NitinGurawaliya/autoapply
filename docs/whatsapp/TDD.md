# SwipeApply on WhatsApp — technical design (Phase Y)

Version 1, 26 Nov 2026. Owner's ask of 26 Nov: a conversational agent on WhatsApp that shows the user jobs when they want them and at a few random moments in the day, lets them apply by texting back in the morning, asks on WhatsApp when a form needs something, and so makes the app optional: a user can run SwipeApply from WhatsApp alone. PRD §8 listed WhatsApp as out of scope for the hackathon; this phase takes it in. ARCHITECTURE stays the source of truth: Y2 copies the decisions here into a new §6.25 when it lands.

The shape in one line: **WhatsApp is a second client of the same agent, not a second agent.** Every job shown comes from the user's daily set; Apply is `swipeRight`; a question is the same `ask_user` prompt the app shows; the runner, the rules, the events and the audit do not change. The new code is a channel: a webhook in, a sender out, a small conversation state per user, and a scheduler that decides when to speak.

---

## 1. Goals and non-goals

**Goals**
- G1. A user links their WhatsApp number from the app in one tap and from then on never has to open the app: jobs, applying, questions and results all happen in the chat.
- G2. Every morning at the user's own time, one message: how many jobs are ready; "Show me" starts the deck. During the day, a job drops into the chat at a random moment, at most a few times, never at night.
- G3. A job in the chat reads like the feed card (company, role, location and experience, why it fits, the match) and has three answers: Apply, Skip, More. Apply is a right swipe with every rule the app enforces; Skip is a left swipe that teaches the feed as a skip does.
- G4. When a run needs the user (an answer, a one-time code), the question arrives on WhatsApp in the form that suits it (buttons, a list, a text reply); the reply is saved as the user's own answer, reused as every answer is, and the run goes on. Sent and "didn't go through" are told.
- G5. Plain words work: "jobs", "more", "status", "pause for 3 days", "stop". A message the rules cannot place is read once by the model for its intent, never for an answer.
- G6. Pace and consent are rules, not prompts: opt-in by the user's own first message, STOP honoured at once, quiet hours, a cap on messages a day, back-off for a user who does not answer.
- G7. The phone number is personal data: stored for sending only, never logged, never in an event, deleted with the link and with the account.

**Non-goals**
- Onboarding on WhatsApp (resume upload, the profile screen). The user signs up in the app once; WhatsApp starts after a profile exists. A resume sent as a WhatsApp document is a later task (Y8, only on numbers).
- Steps that need a person at a screen: pressing Submit on a handoff board (Ashby, Lever), a CAPTCHA, an employer-account email step. The chat says what is waiting and links the application page.
- Reading the user's other chats, groups or contacts. We receive only messages sent to our number.
- Telegram, SMS or iMessage. The channel module is written so a second channel could reuse the conversation layer, but none is designed here.
- A WhatsApp-only sign-up funnel (ads, click-to-WhatsApp). Later, with marketing.

---

## 2. Facts the design rests on (research, 26 Nov 2026)

Sources in §12. Numbers are vendor-reported and change by the quarter; Y2 checks them against Meta's own rate card before the first real send.

1. **The WhatsApp Business Platform (Cloud API) is the only sanctioned way to message users from software.** Meta hosts it; a business portfolio, an app, a phone number not registered on consumer WhatsApp, and a display name review are needed. A free **test number** with up to 5 recipient numbers exists for development; no business verification is needed for it.
2. **A user's message opens a 24-hour customer service window.** Inside it we may send free-form messages (text, interactive buttons, lists). Outside it we may send only **approved message templates**, in a category Meta assigns: utility, marketing or authentication. A tap on a template's quick-reply button is a user message and opens the window.
3. **Interactive messages:** a reply-button message carries up to **3 buttons** (20 characters each); a list message up to **10 rows** across its sections; a message may mix up to 2 URL buttons with reply buttons; a media-card carousel has 2–10 cards. Longer forms are **WhatsApp Flows** (multi-screen forms inside the chat, answers delivered in the completion webhook).
4. **Pricing (India, reported for the card in force since 1 July 2026):** utility and authentication templates about ₹0.115 per delivered message, marketing about ₹0.86. Vendor blogs say that since **1 October 2026** free-form replies in the service window are charged per message after a free allowance of about 1,000 per number per month; Meta's page was not reachable to confirm. Design for: every outbound message costs something; the count a day is a rule.
5. **Messaging limits:** a new number may start conversations with **250 unique users per 24 hours**, scaling to 2,000, 10,000 and beyond with quality (few blocks and reports) and use; since October 2025 the limit is per business portfolio. Quality falls when users block or report; a low rating cuts the limit. A number can be disabled for spam.
6. **Opt-in is required** by Meta's policy: the user must agree to receive messages from the business on WhatsApp, and must be able to opt out; "STOP" is the convention and must be honoured.
7. **Webhooks:** Meta POSTs events (messages, statuses) to one HTTPS endpoint per app, signed with HMAC-SHA256 over the raw body in `X-Hub-Signature-256` (key: the app secret), and retries a non-200 for hours; the same message may arrive twice. A GET with `hub.verify_token` verifies the endpoint once. `mark as read` and a **typing indicator** (25 s, dismissed by the reply) are one call on the message id. The Graph API version in Meta's current examples is v25.0.
8. **What we already have** (ARCHITECTURE §6.11, Phase R): a daily set of 12 jobs per user (`DailySet`, released 4 at a time), `swipeRight` as the one apply path, `ask_user` events with `pendingQuestions` (`key, label, type, options?, required`) and `waitingFor` (`answers | code`), `notifyNeedsInput` called from the runner at its three pause points, Web Push for "today's set is ready" and "needs you", and `POST /api/applications/:id/answers` that saves answers and resumes the run.

---

## 3. Options and decision

| Option | What it is | Fit | Verdict |
|---|---|---|---|
| **A. Meta Cloud API direct** | Our Next.js webhook route and a Graph API client in `modules/whatsapp` | No middleman, no markup, Meta's own limits and pricing, test number for free; we own the number and the templates | **Chosen** |
| B. A BSP with an inbox (AiSensy, Wati, Interakt, Gupshup) | Their dashboard, their API over Meta's, per-message markup, onboarding help | A second UI nobody will use; markup; the inbox invites humans into a flow the agent runs | No |
| C. Twilio WhatsApp | Cloud API behind Twilio's messaging API, sandbox for dev | A markup and a second vendor for what Meta gives directly; Twilio's sandbox needs "join <word>" per tester, like Meta's test number | No |
| D. An unofficial WhatsApp Web client (Baileys, whatsapp-web.js) | Drives a consumer account | Against WhatsApp's terms; accounts banned; the Naukri rule applies (no circumvention) | No |
| E. A WhatsApp Flow for the whole deck | One multi-screen form per session | Flows suit forms, not a conversation; no "drop a job at 3 pm" | For long question sets only (Y4, optional) |
| F. Telegram first | Simpler bot API, free | Not where Indian job seekers are; the owner asked for WhatsApp | No |

**Decision.** Option A. One Meta app and one business number for SwipeApply, the Cloud API called from `modules/whatsapp` (send) and `src/app/api/whatsapp/webhook` (receive, enqueue only), the conversation run by the worker from a `whatsapp-inbound` queue, the day's timing by a `whatsapp-nudge` cron. Templates: three utility templates (the morning digest, a job drop, "needs you"), submitted in Y3 and Y4; every other message is free-form inside the window the user's own message opened.

**Why the worker and not the route:** Meta expects a 200 within seconds and retries otherwise; the conversation reads the feed, the application and the model, which take longer. The route verifies the signature, stores the message (which also deduplicates it) and enqueues; everything else runs in the worker, where every other agent step already runs (CLAUDE.md: routes enqueue).

---

## 4. Architecture

### 4.1 Components

1. **`modules/whatsapp/client.ts`** — the Graph API: `sendText`, `sendButtons` (≤3), `sendList` (≤10 rows), `sendTemplate(name, params)`, `markRead(messageId, {typing})`. Every send writes a `WhatsAppMessage` row (direction `out`, kind, the template name, never the body of a free-text answer) and returns the wamid. Errors are typed: `window_closed` (Meta 131047: more than 24 hours since the user's last message), `rate_limited`, `number_unreachable`, `other`.
2. **`modules/whatsapp/webhook.ts`** — `verifySignature(rawBody, header)`, `parseEvents(body)` into inbound messages (text, button reply, list reply, flow completion, document) and statuses (sent, delivered, read, failed). Pure, tested offline on recorded payloads.
3. **`modules/whatsapp/link.ts`** — the link code: `createLinkCode(userId)` (8 characters, 15 minutes, one use) and the `wa.me/<number>?text=Join%20<code>` URL the Account card opens; `claimLink(phone, code)` binds the number to the user, refuses a code that is used, expired or another user's, refuses a test profile unless `WHATSAPP_TEST_NUMBERS` lists the phone; `unlink(userId)`.
4. **`modules/whatsapp/conversation.ts`** — the state machine (§4.4): given a user, their state and an inbound message, returns the messages to send and the state to store. Calls `swipeRight`, the left-swipe path, `saveAnswers` and `resolveCode` from the existing modules; never Playwright; never the database for jobs directly (it reads `dailyView` and `listFeed`).
5. **`modules/whatsapp/cards.ts`** — the job card as a WhatsApp message: company, role, location and experience, "Why it fits", the match tier in words; the application status lines; the question message for a `PendingQuestion` (buttons for ≤3 options, a list for ≤10, text otherwise); `copy.ts` holds every string.
6. **`modules/whatsapp/intent.ts`** — plain-word rules first (`jobs`, `more`, `next`, `status`, `pause`, `stop`, `help`, `yes`, `no`, a digit); only when no rule matches and no question is pending, `callJson` with a Zod schema `{ intent, days? }` and the cache key of the lower-cased text. The model never produces an answer to a form question.
7. **`modules/whatsapp/schedule.ts`** — the day's plan per user: the morning time in the user's zone (default 08:30 Asia/Kolkata), 0–`whatsapp_drops_per_day` random drop times between 10:00 and 21:00 at least 3 hours apart, drawn once a day and stored in `WhatsAppLink.plan`; `due(now)` returns what to send. Back-off (§4.8).
8. **Worker handlers** — `worker/handlers/whatsapp-inbound.ts` (one job per inbound message: load the link and state, run the conversation, send, store the state) and `worker/handlers/whatsapp-nudge.ts` (cron every 5 minutes: for each linked user whose plan has a due item, send the digest or the drop). Both run on the Docker worker as well (no screen needed).
9. **`lib/notify.ts`** — `notifyNeedsInput` also calls `modules/whatsapp notifyNeedsInput` when the user is linked (the question message inside the window, else the "needs you" template); the runner's `submitted` and `failed` ends call `notifyResult`. The app's push and in-page prompts stay as they are.
10. **Routes** — `GET|POST /api/whatsapp/webhook`, `POST|DELETE /api/whatsapp/link`, `PATCH /api/whatsapp/settings` (§6).
11. **Account card** — "SwipeApply on WhatsApp": Link, the linked number masked, morning time, drops a day, Pause, Unlink (§5).

### 4.2 Queues (pg-boss)

| Queue | Payload | Who enqueues | Handler | Options |
|---|---|---|---|---|
| `whatsapp-inbound` | `{ messageRowId }` | the webhook route, after the row is stored | `handlers/whatsapp-inbound.ts` | singleton key = the user's phone (one at a time per user, in order), retry 2, expire 120 s |
| `whatsapp-nudge` | `{}` | cron `WHATSAPP_NUDGE_CRON` (`*/5 * * * *`) | `handlers/whatsapp-nudge.ts` | singleton, expire 240 s |
| `whatsapp-send` | `{ userId, message }` | `notifyNeedsInput`, `notifyResult` | `handlers/whatsapp-send.ts` | retry 3 with backoff; a `window_closed` error switches to the template once and does not retry further |

A linked user's inbound and outbound both go through the worker; the web never calls the Graph API except to verify the webhook.

### 4.3 Data model (Prisma additions)

```prisma
model WhatsAppLink {
  userId      String   @id
  phone       String   @unique   // E.164, the only copy; never logged, never in an event
  linkedAt    DateTime @default(now())
  optedOutAt  DateTime?          // STOP: nothing is sent until the user writes again
  pausedUntil DateTime?          // "pause for 3 days"
  timezone    String   @default("Asia/Kolkata")
  morningAt   String   @default("08:30")   // HH:mm in the user's zone
  dropsPerDay Int      @default(2)         // 0–3, bounded by the rule
  lastInboundAt  DateTime?                 // the service window: open while now − lastInboundAt < 24 h
  lastOutboundAt DateTime?
  plan        Json?    // today's times: { day, morning: ISO, drops: ISO[], sentMorning: bool, sentDrops: number }
  state       Json?    // the conversation state (§4.4), Zod-validated in the module
  ignored     Int      @default(0)   // drops in a row with no reply; back-off reads it
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model WhatsAppMessage {
  id          String   @id @default(cuid())
  wamid       String   @unique   // Meta's id; a second delivery of the same inbound is ignored here
  userId      String?            // null for a message from an unlinked number (kept 24 h, then pruned)
  direction   String             // in | out
  kind        String             // text | button | list | flow | document | template:<name> | status
  applicationId String?          // the ask or the result it belongs to
  status      String?            // sent | delivered | read | failed (outbound, from status webhooks)
  error       String?
  createdAt   DateTime @default(now())
  @@index([userId, createdAt])
}

model WhatsAppLinkCode {
  code      String   @id
  userId    String
  expiresAt DateTime
  usedAt    DateTime?
}
```

`User` gets `whatsapp WhatsAppLink?`. No message body is stored: the card's job id, the question key and the answer live where they already do (`Application.pendingQuestions`, `Answer`, `ApplicationEvent`). Migration `20261201000000_whatsapp`, additive, `migrate deploy` only (never a shadow of the real database).

### 4.4 Conversation state machine

State per user, in `WhatsAppLink.state`:

```
{ mode: "idle" | "deck" | "ask" | "confirm_stop",
  deck?: { jobIds: string[], at: number, shownAt: ISO },      // the cards of this session, the one on screen
  ask?: { applicationId: string, kind: "answers" | "code", index: number, keys: string[] },  // the question on screen
  updatedAt: ISO }
```

Transitions (the inbound message's kind in brackets):

- **idle** — [Join <code>] → claim, "Linked. I'll message you at 08:30 with the day's jobs; write *jobs* any time." · [jobs, Show me, more, a digit] → load today's set (`dailyView`; `releaseMore` when the released ones are all swiped), send the first unswiped card → **deck** · [status] → the three counts and the last two applications, stay · [pause N days / stop] → §4.8 · [free text] → intent (§4.1 item 6); unknown → help line with the app link, stay.
- **deck** — [Apply] → `swipeRight(userId, jobId)`: ok → "Applying to <company>. I'll tell you when it's sent or if I need anything." and the next card; blocked → the rule in words (the app's own wording) and the next card; already swiped → the next card · [Skip] → the left-swipe path (a `Swipe` row, `direction = left`, the family) and the next card · [More] → the job page link (the public job page of Phase U, which a signed-in user opens in the app) and the same card's buttons again · [Apply to all / "apply all"] → refused in v1: one at a time ("Each one is a real application. Apply on this one?") · no cards left → "That's today's set. Tomorrow at 08:30." → **idle** · 30 minutes without a reply → **idle** (the card is not resent; the next "jobs" starts from the first unswiped).
- **ask** — entered from `notifyNeedsInput` (the question message is sent and `ask` set; a deck in progress is parked, its position kept) · [button or list reply] → the option's value · [text] → the text, 2000 characters max; for `kind = code`, a 4–8 digit string, else "That doesn't look like the code; it's in the email from <company>." · each answer is saved through the same module function `POST /api/applications/:id/answers` calls (`source = user`, the question text kept) and the next pending question is sent; the last one resumes the run (the route's existing resume) → back to **deck** if one was parked, else **idle** · [skip / "I don't know"] on a non-required question → left empty (the route's rules); on a required one → "The form needs this one. You can also answer in the app: <link>" · an ask whose application is cancelled or finished (the user answered in the app) → "Done in the app, thanks." → leave **ask**.
- **confirm_stop** — [Yes] → `optedOutAt = now`, "Stopped. Write *start* any time." → **idle** · anything else → "Kept." → previous mode.

Two asks at once: `ask` holds one application; others wait in order (`Application.status = needs_input`, oldest first); when one ends the next question is sent. The app shows all of them meanwhile. A question whose `type` the card builder cannot render (a file upload, a date with a picker) is not asked on WhatsApp: "One question needs the app: <link>".

### 4.5 Sequence: link (Y2)

1. Account → "Use SwipeApply on WhatsApp" → `POST /api/whatsapp/link` → `{ url }` (a `wa.me` link with the prefilled text "Join <code>") → the browser opens WhatsApp with the message ready; the user sends it.
2. Meta → `POST /api/whatsapp/webhook`: signature checked, the message stored (duplicate wamid → 200 and nothing else), `whatsapp-inbound` enqueued, 200.
3. Worker: the number has no link → the text matches `Join <code>` → `claimLink` → `WhatsAppLink` created (`lastInboundAt = now`, the window open) → the welcome message with the morning time and the first card at once if today's set exists ("Here's one to start:").
4. A message from an unlinked number with no code → one reply, once per number per day: "This is SwipeApply's agent. Link your account from the app: <link>", nothing else, ever (no conversation with strangers, no job cards).

### 4.6 Sequence: the morning and the drops (Y3, Y5)

1. `whatsapp-nudge` (every 5 minutes): for each `WhatsAppLink` not opted out or paused, with a plan for today missing → `schedule.plan(link, now)` draws today's times and stores them. Then for each link with a due item: the morning → `dailyView` (build the set if the warm pass has not; §6.11's `warmFeeds` already runs after ingest) → the digest template `swipeapply_morning` ("Good morning. 12 jobs fit you today, 4 ready now." + quick reply "Show me") or, when fewer than 2 jobs, nothing (no empty message; the app's end-of-day rule). A drop → the next unswiped card as the template `swipeapply_drop` (company, role, one line why; quick replies "Apply", "Skip") when the window is closed, as the free-form card when it is open.
2. The tap on "Show me" / "Apply" / "Skip" is an inbound button reply → `whatsapp-inbound` → the state machine; a template button's payload carries the job id so the reply is unambiguous even hours later.
3. A drop is not sent when: quiet hours (21:00–10:00 local), fewer than 3 hours since the last outbound, the user is in **ask**, the day's outbound count is at `whatsapp_messages_per_user_per_day`, `ignored ≥ 3` (then only the morning digest until the user writes; one reply resets it), or no unswiped job is left.
4. The template parameters carry no personal data: a count, a company, a role, a why line, a job id in the button payload.

### 4.7 Sequence: a question and a result (Y4)

1. The runner pauses (answers or code) → `notifyNeedsInput(applicationId, kind)` → push and email as today → `modules/whatsapp.notifyNeedsInput`: the user is linked and not opted out → `whatsapp-send` with the first question built by `cards.question(pending[0])`; window closed → the template `swipeapply_needs_you` ("<company> asks one thing before I can send your application for <role>." + quick reply "Answer here") and the question follows the tap.
2. The reply → **ask** (§4.4) → saved → the run resumes exactly as from the app. The `ApplicationEvent` for the answer says `via whatsapp` in its message so the application page shows where it came from; the value's `source` is `user`.
3. The run ends → `notifyResult`: submitted → "Sent: <role> at <company>." with the application link (the app's "Sent" state); failed, blocked or cancelled → "Didn't go through: <role> at <company>. <reason in the app's words>." A handoff that waits for a person ("The form is filled, press Submit") → "Ready for you to press Submit on your laptop: <link>"; nothing else is possible from the chat.
4. A result outside the window is a free-form message only if the window is open; otherwise it waits for the morning digest, which then adds "Yesterday: 2 sent, 1 needs you." (no template per result: a user who applied to 10 jobs must not get 10 paid messages at night).

### 4.8 Checks, refusals and pace

Rules in `config/rules.json`, read by `modules/governance` like every other:

| Rule | Default | Meaning |
|---|---|---|
| `whatsapp_drops_per_day` | 2 | upper bound of random drops; the user's own setting may only lower it |
| `whatsapp_messages_per_user_per_day` | 30 | every outbound counted; asks beyond it are sent to the app only |
| `whatsapp_quiet_hours` | `["21:00", "10:00"]` | local; nothing proactive inside; replies to the user's own messages are always allowed |
| `whatsapp_min_gap_minutes` | 180 | between two proactive messages |
| `whatsapp_ignored_before_backoff` | 3 | drops without a reply before drops stop |

Consent: the link is the opt-in (the user's own first message, from their own device, with a code only they have). "stop" → **confirm_stop**; confirmed → `optedOutAt` and nothing proactive until the user writes again ("start" or anything). "pause 3 days" → `pausedUntil`. Account delete cascades the link; `unlink` deletes the row at once.

The apply rules do not change: `swipeRight` enforces the daily cap, the per-company cap, the in-flight cap, the duplicate guard and the governance checks, and a refusal is told in the chat with the same rule name the app shows. A test profile may link only a number in `WHATSAPP_TEST_NUMBERS`, and its applies still run only against `/mock/greenhouse`.

### 4.9 Security and privacy

- The webhook accepts only requests whose `X-Hub-Signature-256` matches the HMAC of the raw body with `WHATSAPP_APP_SECRET`; the GET verification compares `WHATSAPP_VERIFY_TOKEN`. Everything else is 403. The route reads the raw body (`req.text()`), never the parsed JSON, for the HMAC.
- The phone number lives in `WhatsAppLink.phone` and nowhere else: the Account card shows it masked (`+91 ••••• •1234`), logs and events carry the user id, and `WhatsAppMessage` has no body. The resume rule (CLAUDE.md) extends to the chat: no resume text, email or phone in any outbound message.
- Answers and codes: a code is used once to resume the run and never stored in `WhatsAppMessage`; an answer is stored where answers are stored, with `source = user`. The chat never echoes a sensitive answer back in full ("Saved" rather than the value for pay, notice, authorization).
- Only linked numbers get a conversation. A link code is 8 characters from a 32-letter alphabet (40 bits), 15 minutes, one use, bound to the user who made it.
- The Graph API token (`WHATSAPP_ACCESS_TOKEN`, a System User token with `whatsapp_business_messaging`) is read only in `modules/whatsapp/client.ts`.
- The model sees the user's free text only for intent, with the same no-personal-data rule as every `callJson` prompt; a question's answer is never sent to the model.

### 4.10 Failure handling

| Failure | Behaviour |
|---|---|
| Meta retries a webhook | `wamid` unique: the second store fails, the route answers 200, nothing is enqueued twice |
| Send fails with `window_closed` (131047) | `whatsapp-send` sends the matching template once; the free-form follows the user's tap |
| Send fails otherwise | retry 3 with backoff; then a `WhatsAppMessage` row with `status = failed` and `error`; the run is not affected (the app still shows the ask) |
| The user's reply does not fit the question (an option not in the list, a code that is not digits) | asked again once with the options restated; the second miss points to the app |
| The application is gone (cancelled, answered in the app) when a reply arrives | "Done in the app, thanks.", state cleared |
| `dailyView` has no set (a new user before the first warm pass) | the morning is skipped that day; a user who writes "jobs" triggers `ensureDailySet` inline |
| The worker is down | inbound rows pile up in the queue (24 h expiry), the user sees nothing; the health endpoint shows it (§4.11) |
| Meta disables the number (quality, policy) | `whatsapp-nudge` stops on `WHATSAPP_ENABLED` off; the Account card says "WhatsApp is paused"; the app keeps working |

### 4.11 Observability

- `GET /api/health` adds `whatsapp: { lastInboundAt, lastOutboundAt, queued }` (no numbers, no bodies).
- `ApplicationEvent` messages carry `via whatsapp` on an answer or a code given there; the application page shows it.
- `FunnelEvent` (Phase U) gets `whatsapp_linked`, `whatsapp_digest`, `whatsapp_drop`, `whatsapp_apply`, `whatsapp_answer`, `whatsapp_stop`.
- A weekly line in `scripts/whatsapp-report.ts`: linked users, messages out by kind, replies, applies from the chat, asks answered on the chat vs the app, STOPs, estimated cost (templates × the rate from env `WHATSAPP_TEMPLATE_RATE_INR`).

### 4.12 Code map

```
src/modules/whatsapp/
  index.ts            exports: notifyNeedsInput, notifyResult, createLinkCode, unlink, handleInbound, planDay
  client.ts           Graph API calls, typed errors, WhatsAppMessage rows
  webhook.ts          verifySignature, parseEvents (pure)
  link.ts             link codes, claim, unlink
  conversation.ts     the state machine (pure given loaders and senders passed in)
  cards.ts            job card, question, status and result messages
  copy.ts             every string, one place
  intent.ts           rules, then callJson({ intent, days? })
  schedule.ts         the day's plan, due items, quiet hours, back-off
  state.ts            Zod schemas for WhatsAppLink.state and .plan
src/app/api/whatsapp/
  webhook/route.ts    GET verify, POST store + enqueue (raw body)
  link/route.ts       POST code + url, DELETE unlink
  settings/route.ts   PATCH morningAt, dropsPerDay, timezone, pausedUntil
src/worker/handlers/
  whatsapp-inbound.ts, whatsapp-nudge.ts, whatsapp-send.ts
src/components/account/whatsapp-card.tsx
design/whatsapp.html  the card and the chat, light and dark (Y1)
scripts/whatsapp-test.ts, whatsapp-smoke.ts, whatsapp-report.ts
config/rules.json     the five whatsapp_* rules
```

### 4.13 Env (ARCHITECTURE §11 additions)

```
WHATSAPP_ENABLED=0                  # the flag; off = no card, no cron, webhook answers 200 and drops
WHATSAPP_PHONE_NUMBER_ID=           # Meta's id of our number
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=              # System User token; only client.ts reads it
WHATSAPP_APP_SECRET=                # HMAC key for webhooks
WHATSAPP_VERIFY_TOKEN=              # our own random string for the GET verification
WHATSAPP_NUMBER_E164=               # shown in the wa.me link
WHATSAPP_TEST_NUMBERS=              # comma-separated; the only numbers a test profile may link
WHATSAPP_NUDGE_CRON=*/5 * * * *
WHATSAPP_GRAPH_VERSION=v25.0
WHATSAPP_TEMPLATE_RATE_INR=0.115    # for the report only
```

---

## 5. UI

Two things are drawn (Y1, `design/whatsapp.html`, the ui-craft skill, light and dark at 390 px):

1. **The Account card** "SwipeApply on WhatsApp": unlinked (one line of what it does, the button "Open WhatsApp"); linking (the code shown, "Send the message WhatsApp opened"; the card polls `GET /api/whatsapp/link` until linked); linked (the masked number, "Mornings at 08:30", "2 job drops a day", Pause, Unlink); paused; stopped by STOP; disabled (the flag off). Loading, empty and error states as every screen.
2. **The chat, as copy**: the transcript of one day (link, the morning digest, a card with its three buttons, Apply's reply, a drop at 15:10, a question with a list, the answer, "Sent"). Not an app screen; a page in the design folder so the owner approves the words and the order before any template is submitted (a rejected template costs a day). No emoji; the match in words ("Strong fit"); the company and role in bold (WhatsApp's `*bold*`).

The feed and application pages do not change except the `via whatsapp` note on an event.

---

## 6. API

| Route | Auth | Does |
|---|---|---|
| `GET /api/whatsapp/webhook` | Meta's verify token | echoes `hub.challenge` |
| `POST /api/whatsapp/webhook` | HMAC | stores each message or status, enqueues `whatsapp-inbound` per message, 200 |
| `POST /api/whatsapp/link` | user | `{ url, code, expiresAt }` |
| `GET /api/whatsapp/link` | user | `{ linked, phoneMasked, morningAt, dropsPerDay, timezone, pausedUntil, optedOut }` |
| `DELETE /api/whatsapp/link` | user | unlink |
| `PATCH /api/whatsapp/settings` | user | `morningAt`, `dropsPerDay` (0–rule), `timezone` (IANA), `pausedUntil` |

Bodies validated with Zod; every user route scoped by `userId`; the webhook never returns anything but 200 or 403.

---

## 7. Testing

- `scripts/whatsapp-test.ts` (offline, PASS/FAIL): signature verification on a recorded payload (and a tampered one); `parseEvents` on recorded text, button, list, status and duplicate payloads; the state machine through the §4.4 transitions with stubbed loaders (link, jobs, apply ok, apply blocked, skip, end of deck, a 3-option ask, a 7-option ask, a free-text ask, a code, a wrong code, stop and confirm, pause); `schedule.plan` draws inside the window, respects quiet hours, gap and back-off, and is deterministic for a seed; `intent` rules before the model.
- `scripts/whatsapp-smoke.ts` (real, Meta's test number → the owner's phone, a test profile): link with a code; the digest template; a card; Apply runs on `/mock/greenhouse`; a question comes as buttons and the tap resumes the run; "Sent" arrives; STOP stops the next drop. Prints each step.
- The runner tests do not change: WhatsApp is a client of `swipeRight` and the answers path.

---

## 8. Rollout

1. Y1 drawn and approved (copy and card).
2. W2–Y6 behind `WHATSAPP_ENABLED=0` on main; dev against Meta's test number (5 recipients: the owner and testers).
3. A real number: a new SIM for SwipeApply (not on consumer WhatsApp), Meta business verification, display name "SwipeApply", the three templates approved (utility; if Meta recategorizes one as marketing, its copy is rewritten before launch, §9).
4. Y7: the owner's own phone and real profile, a real Greenhouse job applied from the chat end to end; then `WHATSAPP_ENABLED=1` for everyone. The number starts at 250 unique users a day, which is above the user count for months.

---

## 9. Risks

| Risk | Handling |
|---|---|
| Meta classes the digest or drop template as marketing (₹0.86 instead of ₹0.115) | the copy stays transactional (counts, a job, no "don't miss out"); if still marketing, the drop template is dropped and drops go only inside an open window |
| Pricing: service-window messages billed since 1 Oct 2026 (unconfirmed) | the per-user-per-day rule bounds it; Y2 reads the rate card and writes the real numbers into §2 and the report |
| Users block or report, the quality rating falls, the number is limited | drops default to 2, back-off after 3 ignored, STOP in one word, nothing to strangers |
| A reply saved as the wrong answer | buttons and lists carry the option's exact value; free text is stored as typed with the question kept, as the app does; never through the model |
| The 24-hour window closes mid-ask | the template re-opens it; the question follows the tap |
| The deck in the chat shows a job the app also shows at the same time | both read the same set and `Swipe` rows; a swipe in either removes it from the other within the feed cache's minute (the rule of 25 Nov) |
| Meta's API or policy changes | the Graph version is env; `client.ts` is the only caller |
| Two users on one phone | a phone links to one user (`@unique`); the second link moves it after a confirmation in the app |

---

## 10. Tasks

In [TASKS.md](TASKS.md) beside this file: W1–Y7, with Y8 only on numbers. Root `docs/TASKS.md` Phase Y lists them one line each. Order Y1 → Y2 → Y3 → Y4 → Y5 → Y6 → Y7; everything stays behind `WHATSAPP_ENABLED` until Y7.

---

## 11. Decisions closed with the owner (26 Nov)

The owner confirmed all seven defaults on 26 Nov; no open questions remain for W1–Y7.

1. **Direct Cloud API, no BSP** (§3). Needs a Meta business portfolio verified for SwipeApply and a fresh SIM.
2. **The morning default** 08:30 local and **2 drops a day** between 10:00 and 21:00, 3 hours apart.
3. **Results at night wait for the morning** (§4.7 item 4) rather than one paid message per application.
4. **The model reads free text for intent only** (§4.1 item 6), never to answer a form question.
5. **Apply to all** is refused in v1 (one real application per tap).
6. **WhatsApp does not replace push for linked users.** Both, until the numbers say which one users act on.
7. **Resume as a WhatsApp document** (Y8): only after Y7's numbers.

---

## 12. Research notes and sources

Read 26 Nov 2026; the vendor pages report Meta's numbers second-hand and should be checked against WhatsApp Manager before the first spend.

- Interactive message limits (reply buttons 3, list rows 10, mixed buttons, carousel 2–10 cards): [Meta: supported features and limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send/supported-features-and-limits/), [Meta: interactive list messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-list-messages), [Meta: interactive messages](https://developers.facebook.com/docs/whatsapp/guides/interactive-messages/), [Meta: media card carousel](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-media-carousel-messages/).
- Opt-in and the 24-hour window, templates outside it: [Meta: getting opt-in](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in), [WhatsApp Business messaging policy](https://whatsappbusiness.com/policy/), [Infobip: sender behaviour](https://www.infobip.com/docs/whatsapp/manage-integration/integration-essentials).
- Messaging limits and quality (250 → 2,000 → 10,000, per portfolio since 7 Oct 2025): [Meta: messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits), [Meta: upcoming messaging limits changes](https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/).
- Pricing in India (₹0.115 utility and authentication, ₹0.86 marketing, service messages charged from 1 Oct 2026 after an allowance): [DEV: pricing in rupees and 1 Oct 2026](https://dev.to/preciousky_45d956626d31c3/whatsapp-business-platform-pricing-in-rupees-and-the-two-things-that-change-on-1-october-2026-4ko0), [Amomic: India per-message rates](https://amomic.in/blog/whatsapp-business-api-pricing-india), [QuickReply: pricing 2026](https://www.quickreply.ai/whatsapp-automation/whatsapp-business-api-pricing), [AiSensy pricing (higher, with markup)](https://aisensy.com/pricing).
- Webhooks, signature, mark as read and typing: [Meta: create a webhook endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint), [Meta: mark message as read](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/mark-message-as-read/), [Meta: typing indicators](https://developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators/), [Hookdeck: verify WhatsApp webhooks](https://hookdeck.com/webhooks/whatsapp/verify).
- Flows (forms inside the chat, completion webhook, endpoint-driven screens): [Meta: Flows guides](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides), [Meta: receive a Flow response](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/receiveflowresponse), [Meta: Flow JSON](https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson).
