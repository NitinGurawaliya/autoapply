# TASKS — SwipeApply

The index of every task, one line each, linked to its full entry (Do, Done when, the Done line once it lands). Pick the next open task here, then read only its entry and what that entry links. Full entries live in `docs/tasks/<phase>.md` for the phases before K and in `docs/<feature>/TASKS.md` for a feature with a design (`docs/naukri/`). Status is marked in the entry first, then mirrored here. Process: CLAUDE.md "Design to tasks".

Session prompt: `Do task Tn. Read its entry and the sections it links, nothing more. Run its "Done when" check, paste the output, stop.`

Status: [ ] todo  [~] in progress  [x] done  [-] skipped

---

## Tonight (2 Oct) — infrastructure + backend, ~5 hours

Full entries: [tasks/01-tonight-2-oct.md](tasks/01-tonight-2-oct.md)

- [x] [T0 — Accounts + project setup (40 min, half manual)](tasks/01-tonight-2-oct.md#t0)
- [x] [T1 — Prisma schema on Postgres + seed (30 min)](tasks/01-tonight-2-oct.md#t1)
- [x] [T2 — Google auth (30 min)](tasks/01-tonight-2-oct.md#t2)
- [x] [T3 — Storage + LLM gateway (30 min)](tasks/01-tonight-2-oct.md#t3)
- [x] [T4 — Canonical keys + answer bank (30 min)](tasks/01-tonight-2-oct.md#t4)
- [x] [T5 — Company list (40 min, manual, do in parallel with T6)](tasks/01-tonight-2-oct.md#t5)
- [x] [T6 — Queue + worker skeleton + ingest job (60 min)](tasks/01-tonight-2-oct.md#t6)
- [x] [T7 — Mock Greenhouse form (25 min)](tasks/01-tonight-2-oct.md#t7)

## Hackathon day (3 Oct)

Full entries: [tasks/02-hackathon-day-3-oct.md](tasks/02-hackathon-day-3-oct.md)

- [x] [T8 — Resume upload + parse + confirm (50 min) — 10:00](tasks/02-hackathon-day-3-oct.md#t8)
- [x] [T9 — 5 common questions (25 min) — 10:50](tasks/02-hackathon-day-3-oct.md#t9)
- [x] [T10 — Feed with filters (45 min) — 11:15](tasks/02-hackathon-day-3-oct.md#t10)
- [x] [T11 — Swipe (30 min) — 12:00](tasks/02-hackathon-day-3-oct.md#t11)
- [x] [T12 — Governance + apply runner + mock adapter (75 min) — 13:00](tasks/02-hackathon-day-3-oct.md#t12)
- [x] [T13 — Needs-input loop (40 min) — 14:15](tasks/02-hackathon-day-3-oct.md#t13)
- [x] [T14 — Greenhouse adapter, real submit (50 min) — 14:55](tasks/02-hackathon-day-3-oct.md#t14)
- [x] [T15 — Applications list + detail + governance page (40 min) — 15:45](tasks/02-hackathon-day-3-oct.md#t15)
- [ ] [T16 — Retry + failure UX (20 min) — 16:25](tasks/02-hackathon-day-3-oct.md#t16)
- [ ] [T17 — Full run + backup video + pitch (45 min) — 16:45](tasks/02-hackathon-day-3-oct.md#t17)

## Stretch

Full entries: [tasks/03-stretch.md](tasks/03-stretch.md)

- [ ] [T21 — LLM match reasons for top 30, cached (20 min).](tasks/03-stretch.md#t21)
- [ ] [T22 — `tests/smoke.spec.ts` (30 min) — sign-in (test profile) → upload → questions → feed → right-swipe mock job → `submitted`.](tasks/03-stretch.md#t22)
- [ ] [T23 — SSE for live application status instead of polling (30 min).](tasks/03-stretch.md#t23)

## Next phase — polished MVP

Full entries: [tasks/04-polished-mvp.md](tasks/04-polished-mvp.md)


**Phase A — Safe for more than one user**
- [x] [T24 — Browser profile isolation per user (30 min)](tasks/04-polished-mvp.md#t24)
- [x] [T25 — Duplicate and mismatch guards (30 min)](tasks/04-polished-mvp.md#t25)
- [x] [T26 — Database-backed submit lock and stale-job reaper (40 min)](tasks/04-polished-mvp.md#t26)
- [x] [T44 — Multi-user safety hardening (new, from the endpoint audit)](tasks/04-polished-mvp.md#t44)

**Phase B — Remove friction**
- [x] [T27 — Notify when the user is needed (40 min)](tasks/04-polished-mvp.md#t27)
- [x] [T28 — Cancel and retry buttons (30 min)](tasks/04-polished-mvp.md#t28)
- [x] [T29 — Saved answers page (40 min)](tasks/04-polished-mvp.md#t29)
- [x] [T30 — Per-company results (30 min)](tasks/04-polished-mvp.md#t30)

**Phase C — Coverage**
- [~] [T18 — Lever adapter (40 min) — Done when: a real Lever form reaches `submitted`. Un-hide Lever in `APPLY_BOARDS` only after this passes.](tasks/04-polished-mvp.md#t18)
- [x] [T19 — Ashby adapter (40 min) — Done when: a real Ashby form reaches `submitted`. Un-hide Ashby in `APPLY_BOARDS` only after this passes.](tasks/04-polished-mvp.md#t19)
- [x] [T20 — Scheduled ingest (pg-boss cron every 6 h) (15 min) — Done when: the cron is registered and visible in the worker logs.](tasks/04-polished-mvp.md#t20)
- [x] [T31 — Ingest module boundary and cross-source dedupe (40 min)](tasks/04-polished-mvp.md#t31)
- [-] [T32 — More public ATS fetchers (40 min) — replaced by T95 (SmartRecruiters) and T96 (Keka), 18 Oct: Workable and Recruitee had no Indian employers in the probe](tasks/04-polished-mvp.md#t32)

**Phase D — UI polish**
- [x] [T33 — Design tokens and theme (40 min)](tasks/04-polished-mvp.md#t33)
- [x] [T34 — App shell and navigation (30 min)](tasks/04-polished-mvp.md#t34)
- [x] [T35 — Feed card and filter redesign (60 min)](tasks/04-polished-mvp.md#t35)
- [x] [T36 — Applications list and detail polish (40 min)](tasks/04-polished-mvp.md#t36)
- [ ] [T37 — Onboarding polish (40 min)](tasks/04-polished-mvp.md#t37)
- [ ] [T38 — Popups and live status (40 min)](tasks/04-polished-mvp.md#t38)
- [ ] [T39 — Sign-in and landing page (30 min)](tasks/04-polished-mvp.md#t39)
- [ ] [T40 — Accessibility, empty/loading/error states, responsive pass (40 min)](tasks/04-polished-mvp.md#t40)

**Phase E — Ship**
- [ ] [T41 — Deploy (60 min)](tasks/04-polished-mvp.md#t41)
- [x] [T42 — Governance page (30 min)](tasks/04-polished-mvp.md#t42)
- [ ] [T43 — End-to-end test and CI (40 min)](tasks/04-polished-mvp.md#t43)
- [x] [T45 — Adapter hardening and many swipes at once](tasks/04-polished-mvp.md#t45)
- [x] [T46 — Greenhouse form gaps (from the 9 Oct failure review)](tasks/04-polished-mvp.md#t46)
- [x] [T47 — Acknowledgements on every adapter, and the invisible Ashby questions](tasks/04-polished-mvp.md#t47)
- [x] [T48 — Performance quick wins (from the 9 Oct audit)](tasks/04-polished-mvp.md#t48)
- [x] [T70 — Feed without descriptions (audit decision 1)](tasks/04-polished-mvp.md#t70)
- [x] [T71 — One query to sign in (audit decision 5, light option)](tasks/04-polished-mvp.md#t71)
- [x] [T72 — Sponsorship asked once for every country abroad](tasks/04-polished-mvp.md#t72)
- [x] [T73 — Applications list in pages; detail page re-renders only on a change (audit decisions 3 and 4)](tasks/04-polished-mvp.md#t73)
- [x] [T74 — Pages kept between tabs; the feed kept on the server for a minute](tasks/04-polished-mvp.md#t74)
- [x] [T75 — Bugs found testing Greenhouse end to end (10 Oct)](tasks/04-polished-mvp.md#t75)
- [x] [T76 — A real Greenhouse application end to end](tasks/04-polished-mvp.md#t76)

## Phase F — Smarter answers (ask only what we cannot know)

Full entries: [tasks/05-phase-f-smarter-answers.md](tasks/05-phase-f-smarter-answers.md)

- [x] [T49 — Embedding experiment (decision gate)](tasks/05-phase-f-smarter-answers.md#t49)
- [x] [T50 — Replay scoreboard](tasks/05-phase-f-smarter-answers.md#t50)
- [x] [T51 — pgvector storage and backfill](tasks/05-phase-f-smarter-answers.md#t51)
- [x] [T52 — Retrieve-then-verify in the run](tasks/05-phase-f-smarter-answers.md#t52)
- [x] [T53 — AI option mapping](tasks/05-phase-f-smarter-answers.md#t53)
- [x] [T54 — Derivation with evidence](tasks/05-phase-f-smarter-answers.md#t54)
- [x] [T55 — Essay drafts](tasks/05-phase-f-smarter-answers.md#t55)
- [x] [T56 — Ask before the run, fill in one go](tasks/05-phase-f-smarter-answers.md#t56)
- [x] [T57 — Badges, basis and audit](tasks/05-phase-f-smarter-answers.md#t57)

## Phase G — Design system rebuild (the owner's design, 10 Oct)

Full entries: [tasks/06-phase-g-design-system.md](tasks/06-phase-g-design-system.md)

- [x] [T58 — Tokens, fonts and motion](tasks/06-phase-g-design-system.md#t58)
- [x] [T59 — Icons, primitives and the /dev/ui gallery](tasks/06-phase-g-design-system.md#t59)
- [x] [T60 — Patterns](tasks/06-phase-g-design-system.md#t60)
- [x] [T61 — App shell and theme](tasks/06-phase-g-design-system.md#t61)
- [x] [T62 — Discover (boards 08–12)](tasks/06-phase-g-design-system.md#t62)
- [x] [T63 — Needs-you sheet (boards 13–14)](tasks/06-phase-g-design-system.md#t63)
- [x] [T64 — Applications list (board 16)](tasks/06-phase-g-design-system.md#t64)
- [x] [T65 — Application detail (boards 17–18)](tasks/06-phase-g-design-system.md#t65)
- [x] [T66 — Onboarding (boards 03–07)](tasks/06-phase-g-design-system.md#t66)
- [x] [T67 — Opening animation and sign-in (boards 01–02)](tasks/06-phase-g-design-system.md#t67)
- [x] [T68 — Saved answers, Fill your gaps, Account and data, Governance in the design's language](tasks/06-phase-g-design-system.md#t68)
- [x] [T69 — Final pass](tasks/06-phase-g-design-system.md#t69)

## Phase H — Greenhouse India jobs: many companies, fresh daily, eligibility-first matching

Full entries: [tasks/07-phase-h-greenhouse-india.md](tasks/07-phase-h-greenhouse-india.md)

- [x] [T77 — Eligibility tag on every job](tasks/07-phase-h-greenhouse-india.md#t77)
- [x] [T78 — Company list: compile, validate, approve](tasks/07-phase-h-greenhouse-india.md#t78)
- [x] [T79 — Fast, safe ingest at hundreds of companies](tasks/07-phase-h-greenhouse-india.md#t79)
- [x] [T80 — Feed shows India-eligible jobs first, with company type and a fresher level](tasks/07-phase-h-greenhouse-india.md#t80)
- [x] [T81 — Tech tracks for every job and every user](tasks/07-phase-h-greenhouse-india.md#t81)
- [x] [T82 — Scoring v2 for tech: gates, fit, tiers](tasks/07-phase-h-greenhouse-india.md#t82)
- [x] [T83 — Onboarding and feed by track](tasks/07-phase-h-greenhouse-india.md#t83)
- [~] [T84 — Daily freshness numbers](tasks/07-phase-h-greenhouse-india.md#t84)
- [ ] [T85 — Other fields (HR, finance, marketing, sales, operations...) — after T81–T83 are right for tech](tasks/07-phase-h-greenhouse-india.md#t85)

## Phase I — Greenhouse end to end, fresh jobs and the retention hook (owner, 11 Oct)

Full entries: [tasks/08-phase-i-greenhouse-end-to-end.md](tasks/08-phase-i-greenhouse-end-to-end.md)

- [x] [T86 — Application reliability on Greenhouse](tasks/08-phase-i-greenhouse-end-to-end.md#t86)
- [x] [T87 — New-match alerts by browser push](tasks/08-phase-i-greenhouse-end-to-end.md#t87)
- [~] [T88 — Always-on worker](tasks/08-phase-i-greenhouse-end-to-end.md#t88)
- [x] [T89 — Company list grows by itself](tasks/08-phase-i-greenhouse-end-to-end.md#t89)
- [x] [T90 — End-to-end check of the Greenhouse pipeline (11 Oct)](tasks/08-phase-i-greenhouse-end-to-end.md#t90)

## Phase J — More boards: expand the existing ones, then India's own (owner, 18 Oct)

Full entries: [tasks/09-phase-j-more-boards.md](tasks/09-phase-j-more-boards.md)

- [x] [T91 — Board registry](tasks/09-phase-j-more-boards.md#t91)
- [x] [T92 — Greenhouse and Lever discovery from the crawl index](tasks/09-phase-j-more-boards.md#t92)
- [x] [T93 — India company probe](tasks/09-phase-j-more-boards.md#t93)
- [ ] [T94 — Lever apply with the handoff](tasks/09-phase-j-more-boards.md#t94)
- [-] [T95 — SmartRecruiters → moved to M7 (owner, 9 Nov)](tasks/09-phase-j-more-boards.md#t95)
- [x] [T96 — Keka](tasks/09-phase-j-more-boards.md#t96)
- [ ] [T97 — Board report and docs](tasks/09-phase-j-more-boards.md#t97)
- [-] [T98 — Every company on a board: more slug sources → moved to M3 and M4 (owner, 9 Nov)](tasks/09-phase-j-more-boards.md#t98)
- [x] [T99 — Workday and Zoho Recruit job sources (discovery only)](tasks/09-phase-j-more-boards.md#t99)
- [x] [T100 — One shared browser per worker](tasks/09-phase-j-more-boards.md#t100)
- [x] [T101 — Ashby: one save at a time, Ashby's own read-back and submit answer (29 Oct)](tasks/09-phase-j-more-boards.md#t101)
- [x] [T102 — Fixed-shape feed card, deck depth and the job page (owner, 1 Nov)](tasks/09-phase-j-more-boards.md#t102)
- [x] [T103 — Whole-app test, verify and fix pass (1 Nov)](tasks/09-phase-j-more-boards.md#t103)
- [x] [T104 — Job page: readable, and Apply or Skip goes to the next job (1 Nov, owner)](tasks/09-phase-j-more-boards.md#t104)
- [x] [T105 — Board logos, one job count, swiping by drag, jobs you skipped (1 Nov, owner)](tasks/09-phase-j-more-boards.md#t105)
- [x] [T106 — The "Sent!" moment (1 Nov, owner)](tasks/09-phase-j-more-boards.md#t106)
- [x] [T107 — Strict feed matching: only jobs in the user's band, level and field (9 Nov, owner)](tasks/09-phase-j-more-boards.md#t107)

## Phase K — Naukri and LinkedIn through the user's own account (owner, 29 Oct)

Starts only when Phase J is done: T94 (Lever handoff), T95 (SmartRecruiters), T96 (Keka) in `APPLY_BOARDS`, T97 (board report). Rules in CLAUDE.md and ARCHITECTURE §6.20.

Design: [docs/naukri/TDD.md](naukri/TDD.md) (final, 3 Nov). Tasks with their Do, the design sections each builds, Done-when and the Done lines: [docs/naukri/TASKS.md](naukri/TASKS.md). Status is marked there first, then on the line here. Order K1 → K2 → K4; K3 and K5 (LinkedIn) are designed after K4's real runs.

- [ ] [K1 — Connect flow and tooling decision](naukri/TASKS.md#k1)
- [ ] [K2 — Naukri job ingest](naukri/TASKS.md#k2)
- [ ] [K3 — LinkedIn job ingest](naukri/TASKS.md#k3)
- [ ] [K4 — Naukri apply adapter](naukri/TASKS.md#k4)
- [ ] [K4b — Mock Naukri drawer](naukri/TASKS.md#k4b)
- [ ] [K5 — LinkedIn Easy Apply adapter](naukri/TASKS.md#k5)

## Phase L — Resume tailored to each job (owner, 5 Nov)

Design: [docs/resume-tailoring/TDD.md](resume-tailoring/TDD.md) (v1, 5 Nov; owner decisions closed in its section 11). Tasks with their Do, the design sections each builds, Done-when and the Done lines: [docs/resume-tailoring/TASKS.md](resume-tailoring/TASKS.md). Order L1 → L6.

- [ ] [L1 — Structured resume (ResumeDoc)](resume-tailoring/TASKS.md#l1)
- [ ] [L2 — Tailoring plan and the truth checks](resume-tailoring/TASKS.md#l2)
- [ ] [L3 — The user's style, template and PDF renderer](resume-tailoring/TASKS.md#l3)
- [ ] [L4 — Tailor on every run: doc queue, cache, wait cap, event](resume-tailoring/TASKS.md#l4)
- [ ] [L5 — "Resume sent" on the application page, switch on Account](resume-tailoring/TASKS.md#l5)
- [ ] [L6 — Shadow, measure, switch on](resume-tailoring/TASKS.md#l6)

## Phase M — More boards, employer accounts and discovery at scale (owner, 7 and 9 Nov)

This phase comes before the signed-in portals (Naukri, foundit, hirist, iimjobs, Instahyre). Design: [docs/boards/TDD.md](boards/TDD.md) (v2, 9 Nov; the owner's decisions in [§11](boards/TDD.md#11-decisions-closed-with-the-owner-9-nov)). Tasks with their Do, the design sections each builds, Done-when and the Done lines: [docs/boards/TASKS.md](boards/TASKS.md).

Order (owner, 9 Nov): measure and scale, seed every known company, then the boards with public forms; boards that need an employer account later, as one block. M1's daily numbers confirm the rest.

- [~] [M1 — Board measurement, daily](boards/TASKS.md#m1)
- [~] [M2 — Watch every company cheaply: tiers, India-only storage, per-company ingest](boards/TASKS.md#m2)
- [~] [M3 — Seed every known company on the boards we apply on](boards/TASKS.md#m3)
- [x] [M7 — SmartRecruiters (T95, moved here)](boards/TASKS.md#m7)
- [x] [M12 — Workable](boards/TASKS.md#m12)
- [x] [M13 — Zoho Recruit apply](boards/TASKS.md#m13)
- [ ] [M4 — Continuous discovery and re-validation (supersedes T98)](boards/TASKS.md#m4)
- [~] [M21 — Discovery and ingest on a GitHub Actions schedule](boards/TASKS.md#m21)
- [ ] [M16 — Board health: success rate, alert, pause](boards/TASKS.md#m16)
- [ ] [M17 — The feed at 200,000 jobs](boards/TASKS.md#m17)
- [ ] [M18 — Model cost: filter, cap, measure](boards/TASKS.md#m18)
- [ ] [M19 — Apply fleet and per-IP pace](boards/TASKS.md#m19)

Later, boards that need an employer account:

- [ ] [M5 — Employer accounts: application password, vault, permission, the email step by the user](boards/TASKS.md#m5)
- [ ] [M6 — Workday apply (K12 in the Naukri plan)](boards/TASKS.md#m6)
- [ ] [M8 — SuccessFactors](boards/TASKS.md#m8)
- [ ] [M10 — Darwinbox](boards/TASKS.md#m10)
- [ ] [M15 — iCIMS (later)](boards/TASKS.md#m15)

Parked (owner, 9 Nov):

- [-] [M9 — The email step, automatic](boards/TASKS.md#m9)
- [-] [M11 — Oracle Recruiting](boards/TASKS.md#m11)
- [-] [M20 — The user's own live view for bot checks](boards/TASKS.md#m20)
- [-] [M14 — The long tail of public boards (parked by the owner, 17 Nov: few India jobs)](boards/TASKS.md#m14)

## Phase M — A job card and job page that explain the match (owner, 18 Nov)

Design: [docs/job-match/TDD.md](job-match/TDD.md) (v1, 18 Nov; owner decisions closed in its section 11). Tasks: [docs/job-match/TASKS.md](job-match/TASKS.md). Order M1 → M7.

- [x] [M1 — Card and job page mockups](job-match/TASKS.md#m1)
- [x] [M2 — Job skills from a fixed vocabulary](job-match/TASKS.md#m2)
- [x] [M3 — Required or nice-to-have, labelled by the model](job-match/TASKS.md#m3)
- [x] [M4 — Score breakdown and the skills comparison on FeedJob](job-match/TASKS.md#m4)
- [x] [M5 — Pay from the board](job-match/TASKS.md#m5)
- [x] [M6 — The card](job-match/TASKS.md#m6)
- [x] [M7 — The job page](job-match/TASKS.md#m7)

## Phase N — A match score the skills decide (owner, 18 Nov)

Design: [docs/match-score/TDD.md](match-score/TDD.md). Tasks: [docs/match-score/TASKS.md](match-score/TASKS.md). Order N1 → N3.

- [x] [N1 — Tracks: no QA or DevOps from tools alone, ML/AI from AI skills](match-score/TASKS.md#n1)
- [x] [N2 — The score: work 50, skills 40, experience 10](match-score/TASKS.md#n2)
- [x] [N3 — Measure on real feeds](match-score/TASKS.md#n3)

## Phase O — UI craft: a designed UI, not an AI template (owner, 18 Nov)

Audit and plan: [docs/ui-craft/AUDIT.md](ui-craft/AUDIT.md). Tasks: [docs/ui-craft/TASKS.md](ui-craft/TASKS.md). Skill: `.claude/skills/ui-craft/SKILL.md`. Order O1 → O6.

- [x] [O1 — Direction mockups, owner picks one](ui-craft/TASKS.md#o1)
- [x] [O2 — Foundations and ui-lint](ui-craft/TASKS.md#o2)
- [x] [O3 — Components](ui-craft/TASKS.md#o3)
- [x] [O4 — Screens, one at a time](ui-craft/TASKS.md#o4)
- [x] [O5 — Copy and voice](ui-craft/TASKS.md#o5)
- [x] [O6 — Motion and the small things](ui-craft/TASKS.md#o6)

## Phase P — Relevance: a feed built from what the user wants and what each job is (owner, 18 Nov)

Design: [docs/relevance/TDD.md](relevance/TDD.md) (v5, 19 Nov, after four independent reviews; built on `main` after the boards merge; decisions in its section 11). Tasks: [docs/relevance/TASKS.md](relevance/TASKS.md), in build order.

- [x] [P1 — One after-ingest tail, job reading, gate functions, LLM resilience](relevance/TASKS.md#p1)
- [x] [P2 — Evaluation harness and round-1 labels](relevance/TASKS.md#p2)
- [x] [P3 — One gate in the feed, the score and the swipe check](relevance/TASKS.md#p3)
- [x] [P4 — Fields and avoids on the confirm screen](relevance/TASKS.md#p4)
- [x] [P5 — The candidate brief](relevance/TASKS.md#p5)
- [~] [P6 — Fit with evidence, in its own table](relevance/TASKS.md#p6)
- [x] [P7 — The daily set](relevance/TASKS.md#p7)
- [x] [P8 — Learning from skips](relevance/TASKS.md#p8)
- [ ] [P9 — Cleanup](relevance/TASKS.md#p9)

## Phase R — Today's jobs, revealed (owner, 20 Nov)

Design: [docs/reveal/TDD.md](reveal/TDD.md); approved prototype `design/daily-reveal.html`. Tasks: [docs/reveal/TASKS.md](reveal/TASKS.md), in build order.

- [x] [R1 — Counts and the seen flag](reveal/TASKS.md#r1)
- [x] [R2 — The reveal in the feed](reveal/TASKS.md#r2)
- [x] [R3 — Today's jobs without sets, the end of the day](reveal/TASKS.md#r3)
- [x] [R4 — The first run after onboarding](reveal/TASKS.md#r4)
- [ ] [R5 — Regression and switch-on](reveal/TASKS.md#r5)
