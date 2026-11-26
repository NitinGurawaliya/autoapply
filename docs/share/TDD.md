# Share links: one job from LinkedIn or X to a sent application — technical design (Phase U)

Owner's ask (22 Nov): post the link of one job on LinkedIn or X. A person scrolling clicks it, sees the job, taps
Apply, signs in and onboards fast, and lands back on that job with the application going out. They came for fun and
want to go back to the feed they left, so every screen between the click and "your agent is applying" must keep the
one job in view and ask for as little as possible. Tasks: [TASKS.md](TASKS.md).

## 1. Goals and non-goals

Goals:
- A public page per job, readable without signing in, with a preview card that sells the job inside the LinkedIn or X
  feed before the click.
- One tap on Apply goes straight to Google (no splash, no sign-in page), then the two onboarding screens with the job
  shown on each, then the application queued for that job with no second tap.
- The landed screen shows the agent at work on that job and today's other picks underneath: the retention hook.
- A closed job, a job the agent cannot apply to, or one that does not fit the person never ends in a dead end: it says
  so plainly and shows similar open jobs.
- Every step of the funnel counted, from link open to submitted, by source.

Non-goals:
- No change to governance: the Apply tap is the right swipe, and the `swipe_right` checks (minimum score 40, caps,
  duplicates) apply unchanged.
- No search-engine indexing of job pages in this phase (`noindex`). Phase W7 (27 Nov, owner) reverses this for open jobs of public sources: `JobPosting` data and `index, follow` (docs/employers/TDD.md 4.2).
- No referral rewards, sharer attribution or invite links.
- No daily email; retention after the first apply uses push as today (ARCHITECTURE 6.11).
- No change to onboarding's questions or resume parsing (Phase S stays as built).

## 2. Facts the design rests on (code read, 22 Nov)

- `src/proxy.ts` sends every signed-out path except `/sign-in` to `/sign-in` and clears the query string; sign-in's
  Google button uses `redirectTo: "/"`, and `/` then goes to `/feed` or `/onboarding/resume`. A job link is forgotten
  before Google opens.
- A signed-in user without a Profile is held on `/onboarding/resume` (and `/account`) by the proxy. The Profile row is
  written by the resume upload (ARCHITECTURE 6.1), so from the confirm screen on, `hasProfile` is true.
- The confirm screen ends with a full load of `/feed` (`onboarding/confirm/confirm-form.tsx`, `FEED`); the first feed
  load builds the day's set behind the reading scene (Phase R, R4).
- `/jobs/[id]` sits in the `(app)` group, whose layout redirects signed-out users; it shows a match score worked out
  against a profile. There is nothing to show a stranger.
- `Job` has a cuid id and no slug. The reading (`modules/jobs/reading.ts`) gives a `summary` and 4 to 6 `requirements`
  lines copied word for word from the posting; `lib/description.ts describe()` turns the description into plain
  blocks without markup. Pay comes only from the board's structured fields (`salaryMin/Max/Currency/Period`).
- `swipeRight` (`modules/apply/lifecycle.ts`) refuses a closed job (`job_closed`), a board outside `APPLY_BOARDS`
  (`board_not_supported`), a missing profile (`profile_required`), a second swipe (`already_swiped`), a full queue
  (`max_in_flight`), and through governance a score under `min_match_score` 40. A refused swipe that reached governance
  leaves an Application `blocked` with the rule and an `ApplicationEvent`.
- `APPLY_BOARDS` (`modules/jobs/pool.ts`): greenhouse, ashby, keka, workable, smartrecruiters, zohorecruit.
- `/applications/[id]` already shows the stages live (`AutoRefresh`), and the `(app)` layout mounts the needs-input
  sheet and the "Sent" celebration.
- Next 16: `generateMetadata({ params })` with `params` a Promise; `opengraph-image.tsx` beside a page with
  `ImageResponse` from `next/og` (part of Next, no new library), `size`, `alt`, `contentType`; `robots` in metadata.
- Google refuses OAuth inside embedded web views (`disallowed_useragent`). LinkedIn's in-app browser is such a web
  view on Android and iOS; X opens links in a system browser view on iOS. To verify on real phones (U8).
- Someone scrolling on a phone often has no resume file on it. The iOS and Android file pickers do reach Google Drive
  and iCloud.

## 3. Options and decision

Slug: a `Job.slug` column, or a decorative slug in front of the id. Decision: `/j/<company>-<title>-<id>`, parsed by
the trailing id only; a request whose text part differs is redirected (308) to the canonical one. No migration, the
link never breaks when a title changes, and the URL still reads well in a post.

Carrying the job through sign-in: a `?next=` parameter, a database row, or a cookie. Decision: an httpOnly cookie
`sa_intent` holding the job id, set by the Apply server action, 2 hours, SameSite=Lax, consumed once; and the Google
`redirectTo` is the job's own path. The path survives a fresh browser; the cookie survives the onboarding redirects,
which clear the query. No open redirect: the return path is built on the server from the job id.

Where the person lands: a new screen on the share page, or the existing application page. Decision:
`/applications/<id>?from=share`, which already shows live stages, asks for missing answers and celebrates the send;
it gets an arrival card with today's picks. Less new UI, and the person is inside the app shell from the first second.

Not a fit: let it run and rely on cancel, or stop. Decision: governance already stops it (score under 40); the share
page says "Your agent won't apply to this one" with the reason and similar jobs.

Funnel: a third-party analytics script, or our own table. Decision: a `FunnelEvent` table, a random first-party visitor
id, no personal data, a report script. No new library, no third party.

## 4. Architecture

### 4.1 Components

1. `lib/job-slug.ts`: `jobPath(job)` builds `/j/<slug>-<id>` (lower case, ASCII, 60 characters of text at most);
   `jobIdFromSlug(slug)` returns the id.
2. `src/app/j/[slug]/page.tsx` (outside `(app)`, own layout at 480 px): the public job page. Reads the job with an
   explicit select (company name and logo, title, location, remote type, experience, pay, posted, closed, source,
   reading summary and requirements, described blocks); never `raw`, `questions`, `embedding` or anything about other
   users. States: open and applyable; closed; board outside `APPLY_BOARDS`; not found. For a signed-in user with a
   profile it adds their match badge.
3. `src/app/j/[slug]/opengraph-image.tsx`: the preview card, 1200 x 630, company tile, role, place, pay if given,
   "Apply in one tap with your agent".
4. `lib/share-intent.ts`: set, read and clear `sa_intent` (job id only).
5. Apply server action on the share page: signed out, set the intent and call `signIn("google", { redirectTo:
   jobPath })`; signed in without a profile, set the intent and go to `/onboarding/resume`; signed in with a profile,
   claim at once.
6. `POST /api/share/claim`: needs a session; the job id from the body (a tap) or the intent cookie (back from Google
   or onboarding); runs `swipeRight`; clears the intent; returns the outcome.
7. Onboarding job strip: `components/patterns/share-job-strip.tsx` on `/onboarding/resume` and `/onboarding/confirm`
   when an intent is set ("Applying to Backend Engineer at Razorpay"); the confirm screen's exit goes to the job's path
   instead of `/feed`.
8. Arrival card on `/applications/[id]` when `from=share`: "Your agent is applying to <company>", the push switch
   ("Tell me when it's sent"), and "<N> more picked for you today" opening `/feed` (the reveal plays there).
9. `modules/jobs/similar.ts similarJobs(jobId, n)`: nearest open jobs by `embedding`, in `APPLY_BOARDS`, eligibility
   india or remote_india, not the same company; used on the closed, not-applyable and not-a-fit states.
10. `lib/in-app-browser.ts`: detects LinkedIn, X, Instagram and Facebook in-app browsers from the user agent; the share
    page then shows "Open in your browser to apply" (Android: an `intent://` link to Chrome; iOS: the steps).
11. `lib/funnel.ts track(step, ctx)`, the `sa_vid` visitor cookie, `scripts/share-funnel.ts` (report).
12. "Share" on `/jobs/[id]` for an open, applyable job: `navigator.share` or copy, with `?s=li|x|wa|copy`.

### 4.2 Data model

One table (U7), migration applied with `prisma migrate deploy` only (never `migrate diff` against the real database):

```prisma
model FunnelEvent {
  id        String   @id @default(cuid())
  at        DateTime @default(now())
  step      String   // view | apply_tap | signed_in | resume_read | profile_saved | landed | queued | blocked | submitted
  visitorId String   // random, from the sa_vid cookie; never derived from the person
  userId    String?  // set once signed in
  jobId     String
  source    String?  // li | x | wa | copy | null
  detail    String?  // the block rule, the application id, or "in_app_browser"
  @@index([at, step])
  @@index([visitorId])
}
```

No slug column (decision in 3). The intent lives in a cookie, not a table.

### 4.3 Sequence: signed out to sent

1. LinkedIn shows the preview card (U3). Click: `GET /j/<slug>?s=li`. The proxy lets `/j/` through. `view` tracked;
   `sa_vid` set if missing.
2. Apply (form POST, server action): `apply_tap`; `sa_intent = jobId`; `signIn("google", { redirectTo:
   "/j/<slug>" })`. Google's account chooser opens directly.
3. Back on `/j/<slug>`, signed in. No profile: `signed_in`, redirect to `/onboarding/resume` (intent kept). With a
   profile: step 6.
4. `/onboarding/resume` with the job strip; pick a file, the read starts on pick (Phase S); `resume_read`.
5. `/onboarding/confirm` with the job strip; Save writes profile and answers (`profile_saved`), then a full load of
   `/j/<slug>` instead of `/feed`.
6. The page sees a profile and an intent for this job: shows "Sending to your agent", POSTs `/api/share/claim`.
7. Claim runs `swipeRight`. `ok`: `queued` and `landed`, full load of `/applications/<id>?from=share`. `already_swiped`:
   the existing application. `blocked` (score, closed, caps, board): `blocked` with the rule; the share page shows the
   reason and similar jobs. The intent is cleared in every case but a failed queue.
8. When an application that came from a claim is submitted, `submitted` is written (the `queued` event holds the
   application id in `detail`; the runner's submit looks it up).

Taps from click to queued, for a person with a resume on the phone: Apply, the Google account, the file, expected CTC
and Save: about 5.

### 4.4 Proxy

`src/proxy.ts` lets `/j/` (and its `opengraph-image`) through for everyone, signed in or not, profile or not, when
`SHARE_LINKS=1`; otherwise `/j/` is a 404 like `/mock`. Nothing else changes.

### 4.5 Checks and security

- The Apply tap is the right swipe: the claim calls `swipeRight`, which writes the Swipe row and runs governance.
  Nothing applies on a page view alone; the intent cookie is set only by the POST server action.
- The intent holds a job id and nothing else, expires in 2 hours, is cleared on claim, and must match the job of the
  page that claims it.
- The public page selects named columns only; the preview image renders the same public fields.
- The visitor id is random and first-party; `FunnelEvent` stores no name, email, phone, resume text or IP.
- Test profiles stay mock-only (the runner's rule is untouched).

### 4.6 Failures

- Google refused in an in-app browser: U8's open-in-browser screen shows before the Apply action runs; `detail =
  in_app_browser` on the `view`.
- Job closed between the tap and the landing: claim returns `job_closed`; the page shows closed and similar jobs.
- Claim fails (queue down): the page says it did not go through, with Try again; the intent is kept for that retry.
- Cookie lost (a different browser after Google): the person is signed in on the job page; one more tap on Apply.

### 4.7 Observability

`scripts/share-funnel.ts --days 7` prints counts per step and source and the drop between steps. Each claim also
leaves the usual `ApplicationEvent`s.

### 4.8 Code map

| Path | Change |
|---|---|
| `src/lib/job-slug.ts` | new (U2) |
| `src/app/j/[slug]/page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx` | new (U2) |
| `src/proxy.ts`, `src/lib/share-gate.ts` | `/j/` public behind `SHARE_LINKS` (U2) |
| `src/app/j/[slug]/opengraph-image.tsx` | new (U3) |
| `src/lib/share-intent.ts`, the share page's Apply action | new (U4) |
| `src/app/onboarding/resume/page.tsx`, `confirm/page.tsx`, `confirm-form.tsx` | job strip, exit to the job (U4) |
| `src/components/patterns/share-job-strip.tsx` | new (U4) |
| `src/app/api/share/claim/route.ts` | new (U5) |
| `src/app/(app)/applications/[id]/page.tsx`, `arrival-card.tsx` | arrival card (U5) |
| `src/modules/jobs/similar.ts` | new (U6) |
| `prisma/schema.prisma`, migration `share_funnel`, `src/lib/funnel.ts`, `scripts/share-funnel.ts` | new (U7) |
| `src/lib/in-app-browser.ts` | new (U8) |
| `src/app/(app)/jobs/[id]/share-button.tsx`, `scripts/share-link.ts` | new (U9) |

### 4.9 Env (ARCHITECTURE §11)

`SHARE_LINKS=1` switches `/j/` on. The app's public base URL (the existing setting if there is one, else
`NEXT_PUBLIC_APP_URL`) gives absolute URLs for the preview card and the share button.

## 5. UI

The owner's design is the spec (`docs/DESIGN.md`); there is none yet for these screens, so U1 draws them in
`design/share.html` first, light and dark, 390 px, for approval:

- Public job page: company tile and name, role, posted time, location and experience chips, pay if given, the
  summary, "What they ask for" (the requirements lines), the full description folded. One lime Apply button, sticky at
  the bottom, with one line under it: "Upload your resume once. Your agent fills the form and sends it."
- Closed or not applyable: the same header, "This job has closed" or "Your agent can't apply here yet", and three
  similar jobs as cards that open their own `/j/` pages.
- In-app browser: the Apply button becomes "Open in your browser to apply" with the steps for the phone.
- Job strip on the two onboarding screens: a slim card with the company tile, role and "Applying".
- Sending: the button turns into the segmented progress with "Sending to your agent".
- Not a fit: "Your agent won't apply to this one" and the reason in words (score: "Your resume doesn't show what this
  role asks for"), then similar jobs.
- Arrival card on the application page: "Your agent is applying to Razorpay", the push switch, "12 more picked for you
  today" and See today's jobs.

Every screen has loading, empty and error states. No emoji, one accent.

## 6. API

- `POST /api/share/claim` `{ jobId? }` → `200 { applicationId }` | `200 { applicationId, already: true }` |
  `403 { blocked: rule, applicationId? }` | `400 { error: "profile_required" }` | `401`. The job id from the body wins
  over the cookie; the cookie is cleared in every outcome except a failed queue.
- `GET /j/<slug>` public HTML; `GET /j/<slug>/opengraph-image` PNG.

## 7. Testing

- `scripts/job-slug-test.ts`: build and parse, unicode and long titles, canonical redirect cases.
- `scripts/share-claim-test.ts`: claim from body, from cookie, cleared after, `already_swiped`, `job_closed`, a score
  under 40, no session, no profile; the enqueue stubbed as in the other swipe tests.
- `scripts/similar-jobs-test.ts`: open, applyable, eligible, other companies, the source job excluded.
- `scripts/in-app-browser-test.ts`: real user agent strings of LinkedIn, X, Instagram, Facebook, Chrome, Safari.
- `scripts/share-funnel-test.ts`: each step written once, no personal fields, the report's numbers.
- In the browser pane at 390 px light and dark: the signed-out page, the preview image, the onboarding strip and the
  landing on a clone of a real profile (Google itself is the owner's step).
- On real phones, by the owner: the link from the LinkedIn and X apps on Android and iOS, through to queued.

## 8. Rollout

Built behind `SHARE_LINKS` (off: `/j/` is a 404). U10 switches it on in production after the phone check, and the
owner posts the first links with `?s=li` and `?s=x`. Workers need no change except the `submitted` funnel step (U7),
so the local worker is restarted only after checking no run is inspecting or filling.

## 9. Risks

- The resume upload is the biggest drop for a person on a phone. The upload copy says one upload covers this job and
  every job after, and the picker reaches Drive and iCloud. A "finish on your laptop" path is out of scope.
- Google in the LinkedIn web view: if the open-in-browser step loses most people, another sign-in method is a later
  decision.
- A shared job most people don't fit: the not-a-fit state and similar jobs carry them on; the posts should pick broad
  roles.
- Retention after the first apply rests on push, which needs permission, and on iOS an installed app. Email stays a
  later phase.
- Load from a post that spreads: the public page is one read by primary key; the preview image is cached by the
  platforms.

## 10. Tasks

[TASKS.md](TASKS.md): U1 to U10, in build order.

## 11. Decisions proposed, for the owner to confirm (22 Nov)

Made in this design and open until the owner confirms: the decorative slug with the id as the key; `noindex` for now;
landing on the application page with an arrival card; governance's minimum score stops a poor fit instead of sending;
our own funnel table instead of an analytics service; behind `SHARE_LINKS` until the phone check passes.

## 12. Sources

Code read on 22 Nov: `src/proxy.ts`, `src/lib/auth.ts`, `src/app/(auth)/sign-in/page.tsx`, `src/app/(app)/layout.tsx`,
`src/modules/apply/lifecycle.ts` (`swipeRight`, `candidateScore`), `config/rules.json`, `src/modules/jobs/pool.ts`,
`src/modules/jobs/reading.ts`, `prisma/schema.prisma` (`Job`); ARCHITECTURE 6.1, 6.4, 6.11; `docs/onboarding/TDD.md`
2–3; Next 16 docs `generate-metadata.md`, `opengraph-image.md`.
