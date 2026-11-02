# Tonight (2 Oct) — infrastructure + backend, ~5 hours

Full entries of this phase. The index is [docs/TASKS.md](../TASKS.md). Status is marked here first, then on the index line.


<a id="t0"></a>
### [x] T0 — Accounts + project setup (40 min, half manual)

Manual: create a Neon project (copy the pooled `-pooler` URL and the direct URL);  create a Google OAuth client (web app, redirect `http://localhost:3000/api/auth/callback/google`); get an Anthropic API key.
Do: `npx create-next-app@latest swipeapply --ts --tailwind --app --src-dir --eslint`; shadcn/ui init + button card input label select textarea dialog badge tabs progress toast; deps: `framer-motion lucide-react zod @anthropic-ai/sdk prisma @prisma/client pdf-parse playwright pg-boss next-auth@beta @auth/prisma-adapter tsx`; `npx playwright install chromium`; folders from ARCHITECTURE §3; `.env` from §11; scripts in package.json: `dev, worker (tsx watch src/worker/index.ts), ingest (tsx scripts/ingest.ts), typecheck, lint, seed`; `.gitignore .env`; git init + commit.
Done when: `npm run dev` serves a page; `npm run typecheck && npm run lint` pass.

<a id="t1"></a>
### [x] T1 — Prisma schema on Postgres + seed (30 min)

Do: `prisma/schema.prisma` from ARCHITECTURE §4 (plus Auth.js adapter models); `lib/db.ts`; `npx prisma migrate dev --name init`; `prisma/seed.ts` reads a `COMPANIES` array (fill in T5) and upserts `Company`.
Done when: `npx prisma studio` shows all models; `npm run seed` upserts without error and re-running is idempotent.

<a id="t2"></a>
### [x] T2 — Google auth (30 min)

Do: Auth.js v5 with Google provider + Prisma adapter; `lib/auth.ts` exports `auth()` and `getCurrentUser()`; sign-in page with a Google button; middleware: unauthenticated → `/sign-in`; authenticated without Profile → `/onboarding/resume`; else `/feed`.
Done when: Google sign-in creates a User row; refreshing keeps the session; sign-out works.

<a id="t3"></a>
### [x] T3 — Storage + LLM gateway (30 min)

Do: `lib/storage.ts` (Postgres `FileBlob` driver, interface per ARCHITECTURE §9) + `GET /api/files/[...key]` streaming to the owner only; `lib/llm.ts` per §8.
Done when: `scripts/infra-smoke.ts` uploads a 1 KB file under `resumes/`, and `GET /api/files/resumes/...` returns it with the right content type, and `callJson` returns a Zod-validated `{city, country}` for "I live in Bengaluru"; a second call with the same cacheKey logs a cache hit.

<a id="t4"></a>
### [x] T4 — Canonical keys + answer bank (30 min)

Do: `modules/answers/keys.ts` (every key in §5 with synonyms, type, default, policy); `answerBank.ts` (`getAll`, `get`, `upsert`); `questionKey.ts` (`matchKeyBySynonym`).
Done when: `scripts/keys-test.ts` maps: "Notice period (in days)" → notice_period; "Current CTC" → current_ctc; "LinkedIn Profile" → linkedin; "Are you legally authorized to work in the United States?" → work_authorization; "Do you now or will you in the future require sponsorship" → needs_sponsorship; "How did you hear about us?" → how_heard; "Gender" → gender. Prints PASS.

<a id="t5"></a>
### [x] T5 — Company list (40 min, manual, do in parallel with T6)

Do: collect 25–30 companies on these boards that hire in India or remote. Slugs come from careers URLs: `boards.greenhouse.io/{slug}` or `job-boards.greenhouse.io/{slug}`, `jobs.lever.co/{slug}`, `jobs.ashbyhq.com/{slug}`. Verify each API URL (ARCHITECTURE §6.2) returns 200 with jobs. Target: 10 Greenhouse, 10 Lever, 8 Ashby. Put them in `prisma/seed.ts`; `npm run seed`.
Done when: `Company` has ≥ 25 active rows.

<a id="t6"></a>
### [x] T6 — Queue + worker skeleton + ingest job (60 min)

Do: `lib/queue.ts` (pg-boss on `DIRECT_URL`; `enqueueApply`, `enqueueIngest`); `src/worker/index.ts` registers handlers `apply` (stub) and `ingest`; fetchers + `normalize.ts` + `tagging.ts` + `modules/jobs/ingest.ts` per §6.2; `scripts/ingest.ts --days N` enqueues and waits; `POST /api/jobs/ingest`.
Done when: with `npm run worker` running, `npm run ingest -- --days 30` logs `source | company | fetched | kept` for every company, and `Job` has ≥ 30 rows across all 3 sources with `postedAt`, `country`, `applyUrl` set.

<a id="t7"></a>
### [x] T7 — Mock Greenhouse form (25 min)

Do: `app/mock/greenhouse/page.tsx` per §10; `api/mock/submit` stores payload (table `MockSubmission` or in `Application.fields` of a mock Job); add one `Company {source:'mock'}` + one mock `Job` with `applyUrl=http://localhost:3000/mock/greenhouse` in seed.
Done when: manual submit shows the payload on `/mock/submissions`, including the file name.

Commit: "infra + backend foundations".

---
