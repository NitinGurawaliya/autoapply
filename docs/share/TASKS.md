# Phase U — Share links, from a LinkedIn or X post to a sent application: tasks

Design: [TDD.md](TDD.md). Build order U1 → U10; everything stays behind `SHARE_LINKS` until U10, so each task lands on
main with the app unchanged for everyone else.

<a id="u1"></a>
### [~] U1 — The share screens, drawn for approval
Do: `design/share.html` (the ui-craft skill): the public job page (open, closed, not applyable, in-app browser), the
job strip on both onboarding screens, "Sending to your agent", "Your agent won't apply to this one" with similar jobs,
and the arrival card on the application page; light and dark at 390 px, from the tokens and patterns already in
`design/`; the preview card at 1200 x 630 on the same page; `docs/DESIGN.md` gets a Share section.
Design: [5](TDD.md#5-ui), [4.1 items 2, 3, 7, 8, 10](TDD.md#41-components).
**Done when:** every state above is on the page in light and dark, screenshots taken in the browser pane at 390 px,
and the owner has approved it (or the changes they asked for are made). No app code changes.

<a id="u2"></a>
### [x] U2 — The public job page
Do: `src/lib/job-slug.ts` (`jobPath`, `jobIdFromSlug`); `src/app/j/[slug]/` with `layout.tsx`, `page.tsx`,
`loading.tsx`, `error.tsx`, `not-found.tsx`: an explicit select, the open, closed, not-applyable and not-found states
as U1 drew them, the canonical 308 redirect, `generateMetadata` (title, description, `robots` noindex, Open Graph and
Twitter card fields with absolute URLs); a signed-in user with a profile also sees their match badge; the Apply button
renders but does nothing yet beyond a disabled state; `src/lib/share-gate.ts` and `src/proxy.ts` let `/j/` through
for everyone when `SHARE_LINKS=1`, else 404; `scripts/job-slug-test.ts`; ARCHITECTURE 3 (folder), 6.23 (new section:
share links, what this task adds), 11 (`SHARE_LINKS`, base URL).
Design: [3](TDD.md#3-options-and-decision), [4.1 items 1–2](TDD.md#41-components), [4.4](TDD.md#44-proxy),
[4.5](TDD.md#45-checks-and-security), [4.9](TDD.md#49-env-architecture-11).
**Done when:** `job-slug-test` PASS; signed out in the browser pane at 390 px light and dark, `/j/<slug>` of a real
open Greenhouse job shows the job as U1 drew it, a closed job and an unknown id show their states, a wrong slug text
redirects with 308; `curl` of the page shows `og:title`, `og:image`, `twitter:card` and `noindex`; with `SHARE_LINKS`
unset `/j/...` is a 404; `/feed`, `/jobs/[id]` and sign-in behave as before; typecheck, lint pass.
Done 23 Nov: `job-slug-test` PASS (18, gate included: production unset off, `SHARE_LINKS=0` off); open (Bjak, Ashby), closed (Celonis) and Workday pages seen at 390 px light and dark; a wrong slug 308 with `?s=li` kept, unknown 404, 0.64 s; LinkedInBot gets og:title, twitter:card, noindex in the head (og:image is U3); a test user saw the match (85) streamed in; /feed, /jobs, /sign-in 200. No `loading.tsx` (it made the 308 and 404 a 200); `getCurrentUser` carries `hasProfile`.
Paths: `lib/job-slug.ts`, `lib/share-gate.ts`, `lib/auth.ts`, `modules/jobs/public.ts`, `modules/share/`, `app/j/[slug]/`, `proxy.ts`, `scripts/job-slug-test.ts`; ARCHITECTURE 3, 6.23, 11; `.env.example`.

<a id="u3"></a>
### [x] U3 — The preview card
Do: `src/app/j/[slug]/opengraph-image.tsx` with `ImageResponse` from `next/og`: company tile (logo or initials),
role, place, pay if the board gave it, the line "Apply in one tap with your agent", as U1 drew it; a closed job gets
the same card with "Closed"; fonts loaded as the Next docs show for `ImageResponse`.
Design: [4.1 item 3](TDD.md#41-components), [5](TDD.md#5-ui).
**Done when:** `GET /j/<slug>/opengraph-image` returns a 1200 x 630 PNG for three real jobs (with a logo, without one,
with pay), each viewed and matching U1; the page's `og:image` points at it with an absolute URL; a long title wraps
inside the card; typecheck, lint pass.
Done 23 Nov: four real jobs drawn and viewed (Glomopay: logo, pay, 2-line title; Madhus Garage: no logo, initials; SonicWall: title cut with an ellipsis; Celonis: closed, outlined "Closed · see similar jobs"), each 1200 × 630 PNG, 57–75 KB, 0.6–0.8 s warm (6.5 s cold with the font fetch); LinkedInBot gets og:image with an absolute URL, type and size.
Paths: `app/j/[slug]/opengraph-image.tsx`, `lib/share-card.ts`; ARCHITECTURE 6.23.

<a id="u4"></a>
### [x] U4 — Apply carries the job through Google and onboarding
Do: `src/lib/share-intent.ts` (set, read, clear `sa_intent`: job id, httpOnly, SameSite=Lax, 2 h); the share page's
Apply server action: signed out, set the intent and `signIn("google", { redirectTo: jobPath })`; signed in without a
profile, set the intent and redirect to `/onboarding/resume`; the page itself sends a signed-in user without a profile
who has this job's intent to `/onboarding/resume`; `src/components/patterns/share-job-strip.tsx` on
`onboarding/resume/page.tsx` and `onboarding/confirm/page.tsx` while an intent is set; `confirm-form.tsx` exits with a
full load of the job's path instead of `/feed` when an intent is set (the page passes it); ARCHITECTURE 6.1 and 6.23.
Design: [3](TDD.md#3-options-and-decision), [4.1 items 4, 5, 7](TDD.md#41-components),
[4.3 steps 2–5](TDD.md#43-sequence-signed-out-to-sent), [4.5](TDD.md#45-checks-and-security).
**Done when:** signed out, Apply on `/j/<slug>` answers a redirect to Google's account chooser whose callback ends at
that path (seen in the network log; the owner signs in); on a fresh signed-in test user without a profile the job
strip shows on both onboarding screens and Save lands on `/j/<slug>` with the intent still set; without an intent,
onboarding looks and exits exactly as before (to `/feed`); typecheck, lint pass.
Done 23 Nov: signed out, Apply opened Google's sign-in (accounts.google.com, redirect_uri `/api/auth/callback/google`) with no page between; a test user without a profile and that intent was sent from the job to `/onboarding/resume` (strip, "Used for this job and every one after it."), the profile step showed the strip and "Save and apply", Save landed on `/j/bjak-…` with the match (85); a profile user's Apply went back to the job; without the intent the steps read "We read it once…" and "Looks right", no strip. The Google sign-in itself is the owner's (U10).
Paths: `lib/share-intent.ts`, `modules/share/intent.ts`, `app/j/[slug]/actions.ts`, `apply-button.tsx`, `page.tsx`, `components/patterns/share-job-strip.tsx`, `onboarding/resume/page.tsx`, `upload-form.tsx`, `onboarding/confirm/page.tsx`, `confirm-form.tsx`; ARCHITECTURE 6.1, 6.23.

<a id="u5"></a>
### [x] U5 — The claim and the landing
Do: `src/app/api/share/claim/route.ts` (session required; job id from the body, else `sa_intent`; `swipeRight`; clears
the intent except on a failed queue; responses as TDD 6); the share page claims on load for a signed-in user with a
profile and this job's intent, and on the Apply tap for one with a profile, showing "Sending to your agent"; `ok` and
`already_swiped` do a full load of `/applications/<id>?from=share`; a block shows "Your agent won't apply to this one"
with the reason in words (similar jobs come in U6); `src/app/(app)/applications/[id]/arrival-card.tsx` on that page
when `from=share`: the agent applying to the company, the push switch from `components/notifications.tsx`, today's
count and See today's jobs; `scripts/share-claim-test.ts`; ARCHITECTURE 6.4 and 6.23.
Design: [4.1 items 5, 6, 8](TDD.md#41-components), [4.3 steps 6–7](TDD.md#43-sequence-signed-out-to-sent),
[4.6](TDD.md#46-failures), [6](TDD.md#6-api).
**Done when:** `share-claim-test` PASS (body, cookie, cleared after, already swiped, closed, score under 40, no
session, no profile); on a clone of a real profile with the intent set, opening `/j/<slug>` of a fitting Greenhouse job
lands on its application page with the arrival card and a `queued` application (the clone has `isTest = true`, so
the runner blocks the real URL and nothing is sent); a job under the minimum score shows the not-a-fit state and its
Application is `blocked` with `min_match_score` and an event; each governance check wrote its `ApplicationEvent`;
typecheck, lint pass.
Done 23 Nov: `share-claim-test` PASS (17: handed, a right swipe, the same application twice, closed and Workday stopped before an application, EPC Sales Head blocked `min_match_score` with an event, 401, 400 profile_required and no_job, the intent from the cookie and cleared, 200 already, 403 with the application). In the pane a test user back from onboarding with the Bjak intent was claimed on load: `swipe_right` passed, queued, the worker's `start` check blocked it (test profile, real form; nothing sent); the arrival card seen live ("11 more picked for you today") and only the picks once stopped; Apply on a sales job showed the not-a-match state (0, muted) with See today's jobs.
Paths: `modules/share/claim.ts`, `today.ts`, `api/share/claim/route.ts`, `app/j/[slug]/share-claim.tsx`, `page.tsx`, `applications/[id]/arrival-card.tsx`, `page.tsx`, `scripts/share-claim-test.ts`; ARCHITECTURE 6.4, 6.23.

<a id="u6"></a>
### [x] U6 — Similar jobs instead of a dead end
Do: `src/modules/jobs/similar.ts similarJobs(jobId, n)` (nearest by `embedding`, open, in `APPLY_BOARDS`, eligibility
india or remote_india, not the same company, raw SQL as `semantic.ts` does), exported through the module's
`index.ts`; three of them as cards linking to their `/j/` pages on the closed, not-applyable and not-a-fit states;
an empty state when none are found; `scripts/similar-jobs-test.ts`.
Design: [4.1 item 9](TDD.md#41-components), [5](TDD.md#5-ui).
**Done when:** `similar-jobs-test` PASS; for a closed real job and a Workday job the page shows three similar open
applyable jobs from other companies, each opening its own page; a job without an embedding shows the empty state;
the query takes under 300 ms on the real database (measured); typecheck, lint pass.
Done 23 Nov: `similar-jobs-test` PASS (20: closed, Workday and open jobs each get three open, applyable, India, other-company, one-per-company picks; none without an embedding or for an unknown id); EXPLAIN ANALYZE 68 ms (0.3–1.6 s wall with today's Neon round trips); the Celonis page showed Cognite, Nexla and Sarvam AI under "Open jobs like it" and Nexla opened its own page. The not-a-match heading is "Open jobs like it" too (DESIGN.md).
Paths: `modules/jobs/similar.ts`, `modules/jobs/index.ts`, `app/j/[slug]/share-sections.tsx`, `page.tsx`, `scripts/similar-jobs-test.ts`; ARCHITECTURE 6.23; DESIGN.md.

<a id="u7"></a>
### [x] U7 — The funnel, counted
Do: `prisma/schema.prisma` `FunnelEvent` and migration `share_funnel` (applied with `prisma migrate deploy` only);
`src/lib/funnel.ts track(step, ctx)` (never throws, never blocks a page) and the `sa_vid` cookie; steps wired: `view`
and `apply_tap` (share page), `signed_in` (first return from Google with an intent), `resume_read` and `profile_saved`
(onboarding, only with an intent), `queued`, `blocked`, `landed` (claim), `submitted` (the runner's submit, for an
application with a `queued` event); `?s=` read into `source`; `scripts/share-funnel.ts --days N`;
`scripts/share-funnel-test.ts`; ARCHITECTURE 4 (the table) and 6.23.
Design: [4.2](TDD.md#42-data-model), [4.3](TDD.md#43-sequence-signed-out-to-sent), [4.5](TDD.md#45-checks-and-security),
[4.7](TDD.md#47-observability).
**Done when:** `share-funnel-test` PASS (each step once per visitor and job, no personal fields, a failing write does
not break the page); walking U5's path on a clone writes view, apply_tap, queued, landed with one visitor id and the
source `li`; `share-funnel --days 1` prints those counts and the drop between steps; typecheck, lint pass.
Done 23 Nov: migration applied with `migrate deploy` (counts before and after equal: User 20, Profile 16, Application 867, Company 31,033, Job 52,445); `prisma generate` wrote the client but not the engine DLL, which the running worker holds (same engine, so no effect; the worker writes `submitted` once restarted, U10). `share-funnel-test` PASS (12); a fresh test user from `?s=li` wrote view, apply_tap, queued, landed under one visitor id (the worker then stopped the test profile at the form); `share-funnel --days 1` printed them; `share-claim-test` still PASS.
Paths: `prisma/schema.prisma`, migration `20261123120000_share_funnel`, `lib/funnel.ts`, `lib/visitor.ts`, `proxy.ts`, `modules/share/funnel.ts`, `app/j/[slug]/page.tsx`, `actions.ts`, `share-claim.tsx`, `api/share/claim`, `api/profile/route.ts`, `api/profile/resume/route.ts`, `applications/[id]/page.tsx`, `modules/apply/runner.ts`, `lifecycle.ts`, `scripts/share-funnel.ts`, `share-funnel-test.ts`; ARCHITECTURE 4, 6.23.

<a id="u8"></a>
### [~] U8 — In-app browsers
Do: `src/lib/in-app-browser.ts` (LinkedIn, X, Instagram, Facebook from the user agent); on the share page in one of
them, Apply becomes "Open in your browser to apply": on Android an `intent://` link that opens the same URL in Chrome,
on iOS the steps for the app's menu; the `view` event carries `detail = in_app_browser`;
`scripts/in-app-browser-test.ts` with real user agent strings.
Design: [4.1 item 10](TDD.md#41-components), [4.6](TDD.md#46-failures), [5](TDD.md#5-ui).
**Done when:** `in-app-browser-test` PASS; the page drawn with a LinkedIn Android user agent shows the open-in-browser
state and its link is a valid `intent://` URL; the owner opens a link from the LinkedIn and X apps on an Android and an
iPhone and reports for each whether Google sign-in opened, and the result goes in the Done line; typecheck, lint pass.
Built 23 Nov, open for the owner's phone check: `in-app-browser-test` PASS (14: LinkedIn, Instagram, Facebook on Android and iPhone, X on Android; Chrome, Safari, Chrome on iPhone and desktop not caught; the intent keeps host, path, `?s=` and falls back to the page); served as LinkedIn on Android the page's bar is "Open in Chrome to apply" with `intent://localhost:3000/j/bjak-…?s=li#Intent;scheme=http;package=com.android.chrome;…;end`, as LinkedIn on iPhone the two Safari steps and no Apply form, as Chrome the Apply form. Not done: LinkedIn and X opened on a real Android and iPhone (needs a deployed URL, U10).
Paths: `lib/in-app-browser.ts`, `app/j/[slug]/page.tsx`, `share-sections.tsx` (`OpenInBrowser`), `scripts/in-app-browser-test.ts`; ARCHITECTURE 6.23.

<a id="u9"></a>
### [x] U9 — Sharing a job from the app
Do: `src/app/(app)/jobs/[id]/share-button.tsx` on the job page for an open job in `APPLY_BOARDS`: `navigator.share`
where the browser has it, else copy, the URL being the job's `/j/` path with `?s=` (`li`, `x`, `wa`, `copy`), absolute;
`scripts/share-link.ts <jobId> [--s li]` prints the link for the owner's posts.
Design: [4.1 item 12](TDD.md#41-components).
**Done when:** on a real job page at 390 px the button copies (desktop) the right absolute link and a closed or
not-applyable job shows no button; `share-link` prints a link that opens the right page signed out; typecheck, lint
pass.
Done 23 Nov: Share shows on an open Greenhouse job (Nexla) and not on a closed one (Celonis) or a Workday one; in the pane (no share sheet, clipboard writes refused by the embedded browser) the click took the fallback toast with `http://localhost:3000/j/nexla-staff-software-engineer-cmvze3m41001mp4077kzjxc8o?s=app`; `share-link cmvalti… --s li` printed `/j/bjak-android-software-engineer-…?s=li`, 200 signed out; a closed job's link carries a note. Source `app` added for shares from the app.
Paths: `app/(app)/jobs/[id]/share-button.tsx`, `page.tsx`, `lib/funnel.ts`, `scripts/share-link.ts`; ARCHITECTURE 6.23; DESIGN.md.

<a id="u10"></a>
### [~] U10 — End to end and switch-on
Do: every check in TDD 7 on main; `SHARE_LINKS=1` in production (`docs/DEPLOY.md`); the local worker restarted only
after checking no run is inspecting or filling; the owner's first post; Done lines.
Design: [7](TDD.md#7-testing), [8](TDD.md#8-rollout).
**Done when:** every listed test PASS; the owner, signed out on a phone, goes from a LinkedIn post's link to a queued
application on a fresh Google account, and the funnel report shows that path; the docker and local workers run the
new code; `/feed`, onboarding without an intent and `/jobs/[id]` behave as before.
Checked 23 Nov, open for the owner's steps: on this checkout (uncommitted) PASS for job-slug, in-app-browser, explain, share-funnel, similar-jobs, share-claim, swipe-batch, submit-guard, security, feed-prefs and applications-pages; typecheck and lint clean on `src` and the new scripts (the repo-wide lint's 550 errors are another worktree's `.next` output); ui-lint `--check` PASS. Test users and test funnel rows deleted. Left for the owner: approve `design/share.html` (U1); commit; deploy with `SHARE_LINKS=1` and `APP_URL` set to the public address; the phone check from LinkedIn and X on Android and iPhone, signing in with Google once (U8); restart the local worker once no application is inspecting or filling (13 were filling at the check), so it records `submitted` (the Docker worker only ingests and needs nothing); the first post from `scripts/share-link.ts <jobId> --s li`.
