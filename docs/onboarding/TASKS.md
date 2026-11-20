# Phase S — A shorter onboarding: tasks

Design: [TDD.md](TDD.md).

<a id="s1"></a>
### [x] S1 — The resume reads on pick and goes straight on
Do: `onboarding/resume/upload-form.tsx`: reading starts when a PDF is picked; the reading screen without the findings list and "keep this screen open"; on success straight to the profile screen; errors back on the upload screen.
**Done when:** a fresh user picks a PDF and lands on the profile screen with no other tap; a bad PDF shows its error; typecheck, lint, ui-lint pass.
Done 21 Nov: pick to profile screen with no tap (about 30 s on dev; the read was 18.2 s before, plus a "Got it" tap and a findings screen); a text-less PDF lands back on the drop zone with the no-text error. `onboarding/resume/upload-form.tsx`, `patterns/layout.tsx` (`StepHeader of`).

<a id="s2"></a>
### [ ] S2 — One profile screen with the few answers every form needs
Do: `onboarding/confirm/page.tsx`, `confirm-form.tsx`: the summary card, details behind "Edit details", expected CTC, current CTC and notice pre-filled under a year, job type, location and citizenship from the resume, the consent tick; saves profile then answers, full load of /feed; `StepHeader` of 2; DESIGN.md, ARCHITECTURE.
**Done when:** a fresh fresher reaches the feed after typing only expected CTC; the saved answers match what the screen showed; a replaced resume still shows what changed; typecheck, lint, ui-lint, feed-prefs-test pass.

<a id="s3"></a>
### [ ] S3 — No "needs answers" line before the first swipe
Do: `components/gaps-link.tsx`.
**Done when:** a user with no swipes sees no gaps line; after one swipe it shows when there are gaps.

<a id="s4"></a>
### [ ] S4 — The new onboarding, end to end
Do: a fresh user through the UI, light and dark, timed; regression.
**Done when:** sign-in to first card in 3 screens; resolver-test, cover-letter-smoke, feed-prefs-test, daily-set-test PASS.
