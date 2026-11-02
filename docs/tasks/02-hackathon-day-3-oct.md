# Hackathon day (3 Oct)

Full entries of this phase. The index is [docs/TASKS.md](../TASKS.md). Status is marked here first, then on the index line.


<a id="t8"></a>
### [x] T8 — Resume upload + parse + confirm (50 min) — 10:00

Do: upload page; `POST /api/profile/resume` → storage → pdf-parse → `callJson(profileSchema)` → Profile upsert → seed Answer rows (`source=resume`); confirm page edits everything (`PUT /api/profile`, `PUT /api/answers`). Keep `src/modules/profile/sampleProfile.ts` as fallback if the LLM fails.
Done when: a real resume shows name, email, phone, city, links, years, skills, experience within 15 s; edits persist; the PDF is in `FileBlob` under `resumes/`.

<a id="t9"></a>
### [x] T9 — 5 common questions (25 min) — 10:50

Do: questions page → answers `source=user`: current_ctc, expected_ctc, notice_period, employment_type (select), preferred_location (multi); show work_authorization + needs_sponsorship if US/Other selected; save → `/feed`.
Done when: `GET /api/answers` returns the keys; revisiting shows saved values.

<a id="t10"></a>
### [x] T10 — Feed with filters (45 min) — 11:15

Do: `match.ts` (§6.3); `GET /api/jobs?boards&country&expMax&days` → scored, sorted, excludes swiped; feed page with filter chips + cards. UI per CLAUDE.md.
Done when: filters change the list; cards show title, company, location, "x days ago", match %, reason; swiped jobs never reappear.

<a id="t11"></a>
### [x] T11 — Swipe (30 min) — 12:00

Do: Framer Motion card stack; right → `POST /api/swipes {direction:'right'}`; left → 'left'; toast; keyboard ← → for demo reliability.
Done when: right-swipe creates Application `queued` and a pg-boss `apply` job; left-swipe creates only a Swipe.

Lunch 12:30–13:00

<a id="t12"></a>
### [x] T12 — Governance + apply runner + mock adapter (75 min) — 13:00

Do: `governance/rules.ts` + `audit.ts` (§7); `apply/browser.ts`; `adapter.ts`; `adapters/common.ts`; `adapters/mock.ts`; `fieldMapper.ts`; `valueResolver.ts`; `runner.ts` (§6.5); `worker/handlers/apply.ts` calls the runner; `api/applications` list + detail.
Done when: a test profile (`isTest=true`) right-swiping the mock job → worker fills every field, uploads the resume, submits, stores the screenshot in `FileBlob` under `screenshots/`, Application `submitted` with ≥ 10 events incl. `rule_check fill screenshot submit`. Same test profile on a real job → `blocked` with rule `test_profile_mock_only`.

<a id="t13"></a>
### [x] T13 — Needs-input loop (40 min) — 14:15

Do: pending questions from `valueResolver`; runner → `needs_input`; modal on feed + application page (text / select); `POST /api/applications/:id/answers` → upsert → `enqueueApply`.
Done when: with `notice_period` deleted, the mock run pauses, the modal asks, the user answers, the run completes; a second run doesn't ask.

<a id="t14"></a>
### [x] T14 — Greenhouse adapter, real submit (50 min) — 14:55

Do: `adapters/greenhouse.ts`: inspect inputs/selects/textareas/comboboxes/file inputs on both `boards.greenhouse.io` and `job-boards.greenhouse.io` forms; fill via common helpers; submit + `waitForConfirmation`.
Done when: with the presenter's real profile (`isTest=false`), right-swipe on a pre-tested Greenhouse job → worker fills live (headed), submits, confirmation detected, `submitted` with screenshot and the fields list with sources.
Night-before prep: pick 3 Greenhouse jobs you genuinely want, open each form by hand, note any unusual fields.

<a id="t15"></a>
### [x] T15 — Applications list + detail + governance page (40 min) — 15:45

Status: list, detail and the governance page (T42) are done.

Do: list with status badges (polls while running); detail: fields table (label, value, source badge), screenshot via signed URL, event timeline; governance page: rules + today's counters + last 20 events.
Done when: both pages show T12–T14 data; temporarily setting `min_match_score=95` produces a `blocked` application showing the rule name.

<a id="t16"></a>
### [ ] T16 — Retry + failure UX (20 min) — 16:25

Do: runner retry (`max_attempts`), `failed` status with readable error, "Open form" link on failed/needs-input cards.
Done when: forcing an error (bad selector) in the mock adapter → one `retry` event, then `failed` with the message visible in the UI.

<a id="t17"></a>
### [ ] T17 — Full run + backup video + pitch (45 min) — 16:45

Do: fresh Google account or reset user; run the full demo on the mock job and one real Greenhouse job; record screen; write `docs/PITCH.md` from PRD §11.
Done when: video saved; demo passes twice in a row without manual fixes.

---
