# PRD — SwipeApply

Hackathon: AgentForge — Build. Govern. Automate. (3 Oct 2026, Bangalore, 10:00–18:00)
Build window: evening of 2 Oct + hackathon day. The architecture is the production architecture; only the feature set is cut for the demo.

## 1. One-line pitch

Upload your resume once, swipe right on jobs, and a governed AI agent applies for you — every answer traceable, every action logged, nothing submitted without your swipe.

## 2. Problem

- Applying to one job on an ATS form takes 10–20 minutes of repetitive data entry.
- Early-career candidates in India send 100–400 applications per cycle.
- Existing auto-apply bots spam and invent facts; recruiters and ATS vendors now filter them out.

## 3. Target user

Indian software engineers with 0–5 years' experience applying to startups and global companies on Greenhouse, Lever and Ashby job boards.

## 4. Why it fits "Create → Govern → Automate"

| Theme | What we show |
|---|---|
| Create | An agent that parses a resume, matches jobs, reads forms, decides values, and submits applications |
| Govern | Rules the agent must obey in code: no fabricated facts, sensitive answers only from the user, no submit without a right-swipe, test profiles never touch real sites, daily cap, full audit log |
| Automate | Job ingest from 3 boards → match → swipe → queue → worker fills and submits → tracked application |

## 5. User flow

1. **Sign in with Google.**
2. **Upload resume** (PDF). Stored via the storage interface (Postgres for the MVP). The agent extracts: name, email, phone, city, links, experience, education, skills, years of experience, current title/company.
3. **Confirm + 5 common questions** — user checks the extracted fields, then answers: current CTC, expected CTC, notice period, employment type wanted, preferred countries (work authorization and sponsorship asked only if a non-India country is chosen). All saved to the **answer bank**.
4. **Applying screen** — the feed.
5. **Matched jobs + filters** — sorted by match score and freshness; filter by job board (Greenhouse / Lever / Ashby), country (India / Remote / US / Other), experience band, posted-within (1 / 7 / 30 days).
6. **Swipe** — right = apply, left = skip. One job per card.
7. **Auto-apply** — right-swipe queues an application. A worker opens the real form, asks the user in-app for any required answer it doesn't have (saved forever), fills, **submits**, screenshots, and logs every step.

## 6. Screens

| # | Screen | Contents |
|---|---|---|
| S1 | Sign in | Google button |
| S2 | Resume upload | Drop zone, parse progress |
| S3 | Confirm profile | Extracted fields, editable |
| S4 | Common questions | 5 questions, one screen |
| S5 | Feed | Filter chips; swipe cards: title, company, location, posted date, match %, 2-line reason |
| S6 | Needs input (modal) | "This job asks: {question}" → input → Save |
| S7 | Applications | List with live status; detail = every field + value + source (resume / you / AI draft / default), screenshot, audit log |
| S8 | Governance (tab) | Active rules; today's counters (submitted, blocked, questions asked) |
| S9 | Mock Greenhouse form | `/mock/greenhouse` — our own form, used for test profiles and automated tests only |

## 7. Functional requirements

- **FR1** Resume → profile JSON via LLM; every field editable.
- **FR2** Answer bank: key → answer with source. A canonical question is never asked twice.
- **FR3** Job ingest from the Greenhouse, Lever, Ashby, SmartRecruiters and Keka public APIs for the companies in the `Company` table; filter by posted date; normalize to one Job model; tag country, remote type, experience band. Runs as a worker job on a schedule and on demand.
- **FR4** Deterministic match score (0–100) with a short reason.
- **FR5** Right-swipe → Application `queued` → enqueued for the worker. Left-swipe → Swipe row only.
- **FR6** Apply runner (worker), two phases: (a) inspect → missing required answers → `needs_input`; (b) fill → submit → screenshot → `submitted`. Failures → `failed` with reason; one automatic retry.
- **FR7** Live progress: the application page updates while the worker runs; the worker runs Playwright headed during the demo.
- **FR8** Governance enforced in code (ARCHITECTURE §7); every decision writes an audit event.
- **FR9** Mock Greenhouse form for test profiles and the smoke test.
- **FR10** (Phase K, after Phase J; owner, 29 Oct) Naukri and LinkedIn: the user connects their own account by signing in themselves in a visible browser; the worker reads job listings with that session into the same Job model and applies with it under the same submit rules. The user sees the account risk before connecting and can disconnect at any time, which deletes the saved session. See ARCHITECTURE §6.20.

## 8. Out of scope

Payments, mobile app, push notifications, WhatsApp / extension / MCP, Workday apply, resume tailoring, cover-letter studio, interview prep, admin panel, cloud deployment of the worker (it runs on the laptop for the demo but is a separate process already).

## 9. Hard rules (also in CLAUDE.md)

- Submit only after a right-swipe, only for a profile marked `isTest = false`. Test profiles are routed to the mock form; the runner refuses real URLs for them.
- Never invent a fact. Values come from the resume, the user, a default, or an AI draft that is labelled and limited to free-text fields.
- Sensitive keys (CTC, notice period, work authorization, sponsorship, relocation, salary) are never AI-drafted. EEO defaults to "Decline to answer".
- Daily cap per user (default 20). Minimum match score (default 40).
- Naukri and LinkedIn only through the user's own signed-in account, only after Phase J; we never handle their password or OTP and never bypass a CAPTCHA.
- Demo rule: the presenter applies with their own real resume and swipes right only on jobs they genuinely want.

## 10. Demo success criteria

- [ ] Google sign-in → upload resume → confirm → 5 questions in under 3 minutes.
- [ ] Feed shows ≥ 30 jobs from all 3 boards with working filters.
- [ ] Right-swipe on a real Greenhouse job → worker fills live on the laptop → submits → `submitted` with screenshot and field list in the app.
- [ ] One job triggers a needs-input question → user answers → worker resumes → the same question is not asked again.
- [ ] Governance tab shows rules and the audit log; one rule block demonstrated live (match threshold or a sensitive question pausing the run).
- [ ] Backup video recorded by 17:30.

## 11. Demo script (4 minutes)

1. 20 s — problem; "most bots spam, ours is governed".
2. 60 s — Google sign-in → resume → profile → 5 questions.
3. 60 s — feed, filters, swipe right on two real jobs.
4. 60 s — browser fills live; needs-input popup; answer; submit.
5. 40 s — application detail: fields, sources, screenshot, audit log; governance tab.
6. Close — India-first, Android-first next; strict governance is the difference from Tsenta / Sorce / Simplify.

## 12. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Lever/Ashby adapter not done | Their jobs show in the feed; apply demo on Greenhouse |
| Company API down | Jobs already in Postgres from last ingest; demo from DB |
| Venue Wi-Fi fails | Hotspot; worker and web both local; Neon needs network, so keep a local Postgres (Docker) as plan B |
| Real form has a CAPTCHA | Pick 3 pre-tested Greenhouse jobs the night before; mock form as last resort |
| LLM API down | Cached sample profile; field mapping falls back to the synonym table |
