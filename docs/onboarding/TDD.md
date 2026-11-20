# A shorter onboarding — technical design (Phase S)

Owner, 21 Nov: "we don't want to lose users during the onboarding". A first-run walkthrough as a new fresher
(fictional resume, 390 px) took 7 screens, about 16 taps and 2 typed answers, and three long waits before the feed.

## 1. Goals and non-goals

Goals: sign-in to the first card in 3 screens and about 4 taps; no screen that only says what the next one shows; no
required question the resume or a default already answers; waits that never look stuck.

Non-goals: no change to what the agent may guess (sensitive keys still come from the user, consents still need the
standing permission, EEO never guessed), to resume parsing, or to matching.

## 2. Facts the design rests on (walkthrough, 21 Nov)

- Upload needed two actions (pick, then "Read my resume"); the read took 18 s against a promised 5 to 15, showing
  "Found 0 of 5 · keep this screen open" throughout (the findings arrive only at the end).
- "Got it" repeated what the next screen shows. The confirm screen was 3 phone screens and needed no change.
- Questions 1 of 2: current CTC, expected CTC, notice, all required; a fresher types "0" and picks "Immediate".
- Questions 2 of 2: job type, where, citizenship, moving abroad, sponsorship, routine consents, all required; the
  error showed below the fold. Moving abroad and sponsorship are asked by the agent on the form that needs them
  (`modules/apply/abroad.ts` returns `ask`), only for jobs outside the home country. Citizenship also answers "authorized
  to work in India?" (abroad.ts), so it stays saved. The consent permission gates every acknowledgement box.
- "Start swiping" used `router.push`, which waited 10–20 s for the server render on "Saving…"; the feed then led with
  "Your agent needs 4 answers to apply to 2 more jobs".

## 3. Decision

Two onboarding steps instead of three. Step 1 reads the resume as soon as it is picked and goes straight on. Step 2,
"Your profile": a summary card; the full details, fields, nearby and "Never show me" behind "Edit details"; expected CTC
(required); current CTC and notice pre-filled for someone under a year (0 and Immediate, shown and editable: the user
confirms them, so they stay the user's answers); job type Full-time and location from the resume's country (in the
details); citizenship pre-filled from the resume's country (in the details); the consent permission as one pre-ticked box.
Saving writes the profile and the answers, then a full load of /feed (the reading scene covers the build). Moving abroad
and sponsorship are no longer asked up front. The feed shows no "needs answers" line before the first swipe.
`/onboarding/questions` stays reachable for an existing link but is out of the flow.

## 4. Code map

`onboarding/resume/upload-form.tsx` (read on pick, no findings screen), `onboarding/confirm/page.tsx` and
`confirm-form.tsx` (the profile screen, answers saved with the profile), `patterns/layout.tsx` (`StepHeader` of N),
`components/gaps-link.tsx` (hidden before the first swipe), DESIGN.md (onboarding rows), ARCHITECTURE (onboarding).

## 5. Testing

A fresh user through the UI at 390 px light and dark, timed screen by screen; the answers saved (keys and sources);
the first application's questions still answered (resolver-test, the abroad and acknowledgement checks);
typecheck, lint, ui-lint, feed-prefs-test, resolver-test, cover-letter-smoke.

## 6. Tasks

[docs/onboarding/TASKS.md](TASKS.md): S1 to S4.
