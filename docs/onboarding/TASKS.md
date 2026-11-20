# Phase S — A shorter onboarding: tasks

Design: [TDD.md](TDD.md).

<a id="s1"></a>
### [x] S1 — The resume reads on pick and goes straight on
Do: `onboarding/resume/upload-form.tsx`: reading starts when a PDF is picked; the reading screen without the findings list and "keep this screen open"; on success straight to the profile screen; errors back on the upload screen.
**Done when:** a fresh user picks a PDF and lands on the profile screen with no other tap; a bad PDF shows its error; typecheck, lint, ui-lint pass.
Done 21 Nov: pick to profile screen with no tap (about 30 s on dev; the read was 18.2 s before, plus a "Got it" tap and a findings screen); a text-less PDF lands back on the drop zone with the no-text error. `onboarding/resume/upload-form.tsx`, `patterns/layout.tsx` (`StepHeader of`).

<a id="s2"></a>
### [x] S2 — One profile screen with the few answers every form needs
Do: `onboarding/confirm/page.tsx`, `confirm-form.tsx`: the summary card, details behind "Edit details", expected CTC, current CTC and notice pre-filled under a year, job type, location and citizenship from the resume, the consent tick; saves profile then answers, full load of /feed; `StepHeader` of 2; DESIGN.md, ARCHITECTURE.
**Done when:** a fresh fresher reaches the feed after typing only expected CTC; the saved answers match what the screen showed; a replaced resume still shows what changed; typecheck, lint, ui-lint, feed-prefs-test pass.
Done 21 Nov: a fresher typed only "6" and reached the feed (about 10 s on dev, full load); saved current_ctc 0, expected_ctc 6, notice 0, Full-time, India, citizenship India, consents Yes, all `source=user`; a re-upload showed "What changed"; dark checked. `onboarding/confirm/page.tsx`, `confirm-form.tsx`, DESIGN.md, ARCHITECTURE 6.1.

<a id="s3"></a>
### [x] S3 — No "needs answers" line before the first swipe
Do: `components/gaps-link.tsx`.
**Done when:** a user with no swipes sees no gaps line; after one swipe it shows when there are gaps.
Done 21 Nov: a fresh user's feed had no line; after one skip it read "Your agent needs 1 answer to apply to 1 more job". `components/gaps-link.tsx`.

<a id="s4"></a>
### [x] S4 — The new onboarding, end to end
Do: a fresh user through the UI, light and dark, timed; regression.
**Done when:** sign-in to first card in 3 screens; resolver-test, cover-letter-smoke, feed-prefs-test, daily-set-test PASS.
Done 21 Nov: sign-in to first card in 3 screens and 3 actions (pick, type expected CTC, Start swiping), was 7 screens and about 16 taps; the reveal showed today's 12. typecheck, eslint src scripts prisma, ui-lint and 19 scripts PASS (daily-set, daily-reveal, resolver, cover-letter, feed-prefs among them).
