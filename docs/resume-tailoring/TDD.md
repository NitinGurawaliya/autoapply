# Resume tailored to each job — technical design (Phase L: L1–L6)

Version 1, 5 Nov 2026. Owner's ask (5 Nov): "modify each resume as per the job … so there are higher chances of getting the resume screened in", on the fly while applying, and at what latency cost. Users have sent 389 applications through SwipeApply, every one with the same resume file. PRD §8 lists "resume tailoring" as out of scope; L6 moves it into scope (PRD FR11) when it lands. ARCHITECTURE stays the source of truth: L4 copies the decisions here into a new §6.21.

The one-line design: **per application, the worker rewrites the order and wording of the user's own resume for that job, code checks that nothing new was claimed, renders a PDF in the user's own measured style, and uploads it instead of the original; if anything is late or fails a check, the original goes.** The application is never held for it.

---

## 1. Goals and non-goals

Goals
1. Each application sends a resume whose summary, skills order, bullet order and wording lead with what this job asks for, so keyword filters (applicant-tracking systems) and a recruiter's first skim find the match.
2. Truthful by construction: no company, title, date, degree, number, skill or link that is not on the user's own resume. Enforced in code (§4.8), not only in the prompt.
3. No added wait: tailoring runs alongside reading the form; the upload step waits at most `TAILOR_WAIT_MS` (default 10 s) and then sends the original.
4. The user can see, per application, which resume went, what changed and why, and download the exact file.
5. Measurable: shadow mode first (built, checked, stored, not sent), then a split where half the applications send the tailored resume, recorded per application, so the effect can be measured once replies are tracked.

Non-goals
- A pixel-identical copy of the user's design. The tailored resume is rebuilt in their measured style (§4.7a): close to theirs, with their fonts (or metric-compatible equivalents), sizes, colours, columns and section order. Photos, icons and graphics are not reproduced; resumes that depend on them are not tailored. The original file is sent whenever tailoring is off, late or refused.
- Inventing, inflating or "keyword stuffing": no skill the resume does not show, no hidden text, no white-on-white keywords.
- A resume editor or builder in the app. The user edits their resume where they made it and uploads it again.
- Cover letters (already drafted by `essay.ts` when a form asks for one).
- Tracking replies and interviews (needed to prove the effect; a separate design, §9).
- DOCX output. PDF only, which every board we apply on accepts.

---

## 2. Facts the design rests on (measured 5 Nov 2026)

| Fact | Where it comes from | What it decides |
|---|---|---|
| The resume is read once per run, before any browser opens (`runner.ts` ~192), and uploaded in `uploadNow()` (`runner.ts` ~300) through `adapter.uploadFile` or `uploadResume`, which take the bytes and a `ResolvedValue` whose `fileName` names the file (`adapter.ts:20`). | code | One hook, no adapter change: the runner passes the tailored bytes (and `{...resume, fileName}` if the name changes). |
| Every upload today is named `resume.pdf` (`resumeKey` is always `resumes/{userId}/resume.pdf`, `parseResume.ts:197`, `valueResolver.ts:49`), and Greenhouse (`greenhouse.ts:71`), Lever (`lever.ts:117`) and Ashby (`ashby.ts:182`) confirm the upload by finding that name on the page. | code, verifier 5 Nov | The tailored file is uploaded under the same name, `resume.pdf`. Original and tailored are told apart by sha256, not by name. A friendlier name is a separate, per-board-tested change (§11 Q7). |
| Lever and Keka upload first (`uploadFirst: true`), right after the form is read and resolved; Greenhouse and Ashby upload after filling (`runner.ts:312`). | `adapters/lever.ts:296`, `adapters/keka.ts:532` | Upload-first boards have the least time to hide the tailoring in; the wait cap (§4.6) protects them. |
| Time from run start to the "Resolved" event (the moment the upload can start), first-attempt submits of the last 5 days: p10 18 s Greenhouse, 21 s Ashby, 20 s Keka; minimum 8 s. 41 of the 68 measured runs were Keka. | DB query, verifier re-run 5 Nov | The per-job work (plan + render ≈ 9–13 s) fits before upload on most runs only if the `ResumeDoc` is already built. So the doc is built when the resume is uploaded, not on the first application (§4.4). |
| `gpt-4o-mini` in the worker log writes ≈100 output tokens/s (290 tokens in 2.9 s, 282 in 2.8 s), ≈1–3 s first-token latency. | worker log, 4 Nov | A tailoring plan of ≈600–900 output tokens takes ≈7–11 s. The plan returns only changes by id (§4.5), never the whole resume. The `ResumeDoc` build copies the whole resume (median `resumeText` 3,388 chars, ≈1–1.5k output tokens, ≈12–15 s), so it runs off the apply path. |
| `callJson` has no timeout, no abort and no `max_tokens`, and retries once internally (`llm.ts:136`). | code | L2 adds `timeoutMs` and `maxTokens` options to `callJson` (AbortController); callers add no retry of their own. |
| The stored profile has no bullets: `experience[]` is `{title, company, start, end, summary}`; the full text is `resumeText`, with pdf-parse's page markers removed (`parseResume.ts:52`). | `profile/profileSchema.ts` | A structured resume (`ResumeDoc`, §4.3) has to be built once per resume, every bullet its own item; the original page count is read from the stored PDF, not from `resumeText`. |
| Playwright's `page.pdf()` works only in headless Chromium. The worker's shared browser is headed Chrome when `DEMO_HEADED=1` (`browser.ts`). | Playwright docs; `browser.ts:85` | Rendering uses its own headless Chromium, launched once per worker and reused (§4.7). No new library. |
| `pdf-parse` v2 reads text back out of a PDF; its page count is `total` (not `numpages`); the reader in `parseResume.ts:36` is not exported. | code, `node_modules/pdf-parse` types | L1 exports `readPdf(bytes) → {text, pages}` from `modules/profile`, used for the original's page count and the read-back check (§4.8 R). |
| Greenhouse and Lever read the uploaded resume to prefill fields. Upload-first boards fill our values after the parse; Greenhouse uploads after our fill. | adapters, `runner.ts:312` | A clean single-column text PDF parses better than many designed resumes; on upload-first boards our values still win. |
| There is no general tech-skill vocabulary in the code (`jobs/functions.ts` has only track regexes). `mentions()` in `jobs/match.ts:136` expects lower-case text, and `match.ts` imports `db`. | code | L2 adds `tailor/vocab.ts` and moves `mentions` to a dependency-free `jobs/mentions.ts`, so the checks stay pure and offline. |
| Storage: `lib/storage.ts`, `FileBlob` in Postgres, `put(key, bytes, contentType, userId)`; `GET /api/files/{key}` streams only to the owner. | ARCHITECTURE §9 | Tailored files are stored there with `userId`, linked from the application page. |
| Migrations: never run `migrate dev`/`migrate diff` against Neon with `DIRECT_URL` as shadow (it wiped the DB on 10 Oct). | owner memory | L1/L4 migrations are written by hand and applied with `prisma migrate deploy`. |

Cost: ≈3–4k input + ≈0.8k output tokens per job on `gpt-4o-mini` ≈ $0.001; the one-time `ResumeDoc` build ≈ $0.002. 200 applications ≈ $0.25.

---

## 3. Options and decision

**A. Edit the user's own PDF in place** (replace text runs inside their file). Keeps their design. Rejected: PDF text is positioned glyph runs; a reworded bullet of a different length overflows or leaves gaps, fonts are subset (new words may have no glyphs), and two-column or image-based resumes cannot be edited reliably. Failure would be silent and visible to recruiters.

**B. Free rewrite by the model, rendered into a template.** Simple, but the model writes the whole resume, so any fact can drift (a date, a number, a skill), and checking a free rewrite against the original is fuzzy. Rejected.

**C. Structured resume + change plan + template (chosen).**
1. Once per resume: split it into a `ResumeDoc` (header, summary, roles with bullets, projects, education, skills, other sections), every item with an id, checked to cover the original text (§4.4).
2. Per job: the model returns a *plan*: a new summary, an order for skills, roles' bullets and projects, a reworded text for some bullets by id, a few items to drop for space. It never returns header, company, title, date, school or degree; code copies those from the `ResumeDoc`.
3. Code checks every reworded line against the bullet it came from (§4.8) and keeps the original line where a check fails.
4. Render the result into the user's measured style (template below, section 4.7a), print to PDF in headless Chromium, read it back.

Why C: facts that matter most (employers, titles, dates, education, contact) are copied by code and cannot change; the model's freedom is limited to order and wording of lines that already exist, and each reworded line is checked against its own source. The output is one page in a layout every ATS parses.

Template (owner, 5 Nov: keep the user's look): one HTML template driven by a `ResumeStyle` measured from the user's own PDF (§4.7a): their page size and margins, one or two columns as they had them, their fonts mapped to bundled equivalents, their sizes, colours, heading case and rules, bullet glyph and date placement, their section order and headings' own words. Always real, selectable text, no tables or images, so ATSs read it at least as well as the original. Page budget = the original's page count.

---

## 4. Architecture

### 4.1 Components

| Component | Where | Runs in | Does |
|---|---|---|---|
| `ResumeDoc` schema | `src/modules/profile/resumeDoc.ts` | web + worker | Zod schema, `assignIds(doc)` (ids are given by code, never by the model, so they are stable), `docText(doc)` (all text), `docHash(doc)`. |
| `readPdf` | `src/modules/profile/parseResume.ts` (exported) | web + worker | `readPdf(bytes) → {text, pages}` (pdf-parse v2 `total`). |
| `buildResumeDoc` | `src/modules/profile/resumeDoc.ts` | worker, queue `resume-doc` | One `callJson` over `resumeText` → `ResumeDoc`; coverage check (§4.4); writes `Profile.resumeDoc`; then renders the preview (§5). |
| `planTailoring` | `src/modules/apply/tailor/plan.ts` | worker | One `callJson` (`timeoutMs` 25 s, `maxTokens` 1500) → `TailorPlan` (§4.5). |
| `applyPlan` + checks | `src/modules/apply/tailor/check.ts` | worker | Pure: `ResumeDoc` + `TailorPlan` + job → `TailoredDoc` + `changes[]` + `refused[]` (§4.8). Offline-testable; imports no Prisma. |
| Aliases | `src/modules/apply/tailor/aliases.ts` | worker | The fixed table of same-skill spellings (`Postgres`↔`PostgreSQL`, `JS`↔`JavaScript`, `K8s`↔`Kubernetes`, `GCP`↔`Google Cloud`, …). Only these renames are allowed. |
| Vocabulary | `src/modules/apply/tailor/vocab.ts` | worker | A fixed list of ≈400 tech terms (languages, frameworks, databases, clouds, tools), plus the profile's own skills at call time; used by check K and by `jobKeywords`. |
| `mentions` | `src/modules/jobs/mentions.ts` (moved out of `match.ts`, which re-imports it) | web + worker | `mentions(text, needle)`; callers pass lower-case text (documented on the function). |
| Keywords | `src/modules/apply/tailor/keywords.ts` | worker | `jobKeywords(job, doc)`: vocabulary terms and the candidate's skills (with aliases) the job mentions; `coverage(text, keywords)` before and after. |
| Style | `src/modules/apply/tailor/style.ts` | worker, queue `resume-doc` | `extractStyle(pdfBytes) → {style, confidence, reasons}` with `pdfjs-dist` (already installed as `pdf-parse`'s dependency, 5.4.296; this design allows importing it directly): text items' fonts, sizes, positions, fill colours and line paths (§4.7a). Stored as `Profile.resumeStyle`. |
| Fonts | `src/modules/apply/tailor/fonts/` | worker | Bundled open-licence fonts (OFL/Apache) that stand in for common resume fonts with the same metrics: Carlito (Calibri), Caladea (Cambria), Liberation Sans/Serif (Arial, Helvetica / Times), Latin Modern (LaTeX), plus Lato, Open Sans, Roboto, Source Sans 3, EB Garamond, Merriweather. Loaded into the page by `@font-face` from local files. |
| Renderer | `src/modules/apply/tailor/render.ts` | worker | HTML template + `ResumeStyle` → fit to the page budget in the page → one `page.pdf()` on a dedicated headless Chromium → bytes. |
| Orchestrator | `src/modules/apply/tailor/index.ts` | worker | `tailorResume({profile, job})`: cache lookup → plan → check → render → read-back → store → `TailoredResume` row. Never throws to the runner; returns `{ok:true, bytes, sha256, tailoredId, ...}` or `{ok:false, reason}`. |
| Runner hook | `src/modules/apply/runner.ts` | worker | Decides the arm, starts `tailorResume` at run start, waits ≤ `TAILOR_WAIT_MS` at upload, writes the `resume` event. |
| `callJson` options | `src/lib/llm.ts` | web + worker | `timeoutMs` (AbortController) and `maxTokens`; default behaviour unchanged for existing callers. |
| UI | application page, Account | web | "Resume sent" row; Account switch (§5). |

Code rule kept: Playwright (the renderer) lives under `src/modules/apply` and runs only in the worker. `modules/profile` holds no Playwright.

### 4.2 Queues

One new queue, `resume-doc`, payload `{userId}`, singleton per user (pg-boss `singletonKey: userId`), so two builds for one user never run at once. Enqueued only for users who opted in: when `tailor_resume` is saved as Yes (`PUT /api/answers`), by `saveParsedResume` on a resume upload or replace while opted in, and by the runner when it finds the doc missing or stale (that run sends the original, reason `doc_building`). The handler runs on every worker (no screen needed): builds the doc (§4.4), measures the style and renders the preview (§4.7a). No backfill for users who have not opted in (§11 Q8).

Tailoring itself runs inside the `apply` handler, as a promise started at run start. (A `tailor` prefetch queue on swipe is a later option if the queue backlog grows; §9.)

### 4.3 Data model

Migrations are written by hand and applied with `prisma migrate deploy` (§2).

```prisma
model Profile {
  // ... existing
  resumeDoc      Json?    // ResumeDoc (§4.4); null until built or when the resume is unsupported
  resumeDocFrom  String?  // md5 of resumeText it was built from; stale when it differs
  resumeDocError String?  // "low_coverage" | "parse_failed" | null: why there is no doc
}

model TailoredResume {
  id          String   @id @default(cuid())
  userId      String
  jobId       String
  docHash     String   // hash of the ResumeDoc it was made from
  version     Int      // TAILOR_VERSION (code constant): bumped when the prompt, checks or template change, so old results are not reused
  status      String   // "building" | "ready" | "refused" | "failed"
  reason      String?  // refused/failed: the check or error, short, no resume text
  fileKey     String?  // storage key of the PDF, when ready
  sha256      String?  // of the PDF bytes, when ready
  pages       Int?
  keywordsBefore Int?
  keywordsAfter  Int?
  changes     Json     // TailorChange[] (§4.5): what moved / was reworded / dropped, with ids and the short reason (holds bullet text: personal data)
  latencyMs   Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, jobId, docHash, version])
  @@index([userId])
}
```

Write-once: the row is created as `building` with `createMany … skipDuplicates` before any model call; a run that finds an existing `building` row younger than 60 s waits on it (polls every 1 s within its own wait cap) instead of starting a second plan; a `ready` row's file is never overwritten. So a retry or a re-run of the same application sends byte-identical file (same `sha256`), and "download the exact file sent" stays true. A `building` row older than 60 s, or `failed`, is taken over; `refused` is final for that version.

`ResumeDoc` (Zod, `resumeDoc.ts`):

```ts
type ResumeDoc = {
  header: { name: string; email: string | null; phone: string | null; location: string | null; links: string[] }; // copied from Profile at render time, never from the model
  summary: string | null;
  roles: Array<{ id: string; company: string; title: string; location: string | null; start: string | null; end: string | null;
                 bullets: Array<{ id: string; text: string }> }>;            // ids "r1", "r1b1" …
  projects: Array<{ id: string; name: string; link: string | null; tech: string[]; bullets: Array<{ id: string; text: string }> }>;
  education: Array<{ id: string; school: string; degree: string | null; detail: string | null; start: string | null; end: string | null }>;
  skills: Array<{ id: string; group: string | null; items: string[] }>;     // the resume's own groups
  other: Array<{ id: string; heading: string; items: Array<{ id: string; text: string }> }>; // certifications, awards, publications…
  pages: number;                                                              // pages of the original PDF (readPdf on the stored file)
};

// Profile.resumeStyle (L4 migration), measured from the original PDF (§4.7a)
type ResumeStyle = {
  page: { width: number; height: number; margin: { top: number; right: number; bottom: number; left: number } }; // pt
  columns: { count: 1 | 2; sidebar?: { side: "left" | "right"; width: number; sections: string[] } };
  fonts: { body: FontRef; heading: FontRef; name: FontRef };                  // FontRef = { family: bundled family, weight, italic, size (pt), color (hex) }
  heading: { case: "upper" | "title" | "as-is"; rule: "below" | "none"; ruleColor: string | null; spaceBefore: number };
  bullet: { glyph: string; indent: number };
  dates: "right" | "inline";
  lineHeight: number;                                                         // body leading / size
  headerAlign: "left" | "center";
  sectionOrder: string[];                                                     // the doc's section ids as on the original
};
```

Storage keys: `resumes/{userId}/tailored/{jobId}-{docHash8}-v{version}.pdf`, `userId` set, `application/pdf`. File name sent to the form: `resume.pdf`, as today, for original and tailored alike (§2; §11 Q7).

`Application` gets no new column: the `resume` event (§4.11) carries `{arm, sent, tailoredId, sha256}`.

### 4.4 Building the ResumeDoc (L1)

When: in the background right after a resume is uploaded or replaced (queue `resume-doc`, §4.2), so the ≈12–15 s build never sits on an application's path. Upload and the review screen stay as fast as today. A resume replace makes the doc stale by its hash (`resumeDocFrom` ≠ md5(`resumeText`)) and enqueues a new build; an application that runs before the build finishes sends the original (reason `doc_building`).

How: `callJson(resumeDocSchema, SYSTEM, resumeText, {timeoutMs: 45_000, maxTokens: 4000})` with a prompt to split, not rewrite: every line copied verbatim into exactly one item, bullets as on the resume, sections the resume has under their own headings. Ids are assigned by code afterwards (`assignIds`). `pages` comes from `readPdf` on the stored original. No retry beyond `callJson`'s own one.

Coverage check (code): both texts are normalised the same way: NFKC, hyphenated line breaks rejoined (`-\n` → ``), bullet glyphs and pdf-parse page markers removed, the header's name/email/phone/links removed (they come from Profile), lower-cased, split into tokens of 2+ letters or digits. Compared as **multisets** (a word that appears twice must appear twice). Pass when ≥ 92 % of the resume's tokens are in the doc and ≥ 95 % of the doc's tokens are in the resume (the model neither dropped nor added). Fail → `resumeDoc = null`, `resumeDocError = "low_coverage"`, and every application of this resume sends the original (reason `resume_unsupported`). L1 tunes the two thresholds on all 10 real profiles (numbers only, no text) and records the chosen values in its Done line.

The header is never taken from the model: name, email, phone, city/country and links come from `Profile` at render time (the user confirmed them on the review screen).

### 4.5 The tailoring plan (L2)

Input to the model (JSON): the job (company, title, location, description ≤ 4000 chars), `jobKeywords` (skills the job mentions that the candidate has, with alias spellings), and the `ResumeDoc` with ids (header left out). No other personal data.

Output (`TailorPlan`, Zod; unknown ids are dropped):

```ts
type TailorPlan = {
  summary: string | null;                                // 2–3 lines, first person implied, from the resume only
  skills: { order: string[]; rename: Array<{ from: string; to: string }>; promote: string[] }; // promote = skills shown in bullets but missing from the skills list
  roles: Array<{ id: string; bulletOrder: string[]; rewrite: Array<{ id: string; text: string; why: string }>; drop: string[] }>;
  projects: { order: string[]; drop: string[]; rewrite: Array<{ id: string; text: string; why: string }> };
  other: { drop: string[] };
};
```

Prompt rules (also checked in code, §4.8): roles stay in date order (never reordered); bullets reorder only within their role; rewrite a bullet only to lead with what this job asks for or to use the job's spelling of a skill the bullet already shows; keep every number, name and tool; keep the claim (never turn "helped" into "led"); never merge two bullets; `drop` is the model's ranking of what matters least for this job (code uses it only when the page overflows, §4.7), never a role, never education, never the only bullet of a role; summary uses only skills and facts present in the doc and `floor(yearsExperience)`.

`TailorChange` (stored, shown in the UI): `{ kind: "summary"|"reorder"|"rewrite"|"rename"|"promote"|"drop", id?, from?, to?, why }`.

### 4.6 Sequence: one application (L4)

```
runner: load application, job, profile, answers …              (unchanged)
arm = chooseArm(applicationId, answers)                        off when TAILOR_RESUME=off or the user has not opted in (tailor_resume ≠ Yes; opt-in, §11 Q2),
                                                               or resumeStyle is unsupported (reason style_unsupported);
                                                               shadow | on (TAILOR_RESUME); with on and TAILOR_SHARE<1: hash(appId) < share ? on-tailored : on-original
docReady = profile.resumeDoc && resumeDocFrom == md5(resumeText); if not and arm != off: enqueue resume-doc (singleton), reason doc_building
tailoring = arm in {shadow, on-tailored} && docReady ? tailorResume(...) : null   // started now, not awaited; never rejects
open browser, inspect, resolve, (fill)                          (unchanged; upload point p10 ≈ 18–21 s, min 8 s)
uploadNow():                                                    (only when the form has a resume field; no field → event "resume" {sent:"none"})
  result = arm == "on-tailored" ? await withTimeout(tailoring, TAILOR_WAIT_MS) : null
  bytes = result?.ok ? result.bytes : original                  // file name stays resume.pdf
  adapter.uploadFile / uploadResume(page, resume, bytes)
  fill row for the resume: value "resume.pdf (tailored)" or "resume.pdf"
  event "resume" {arm, sent: "tailored"|"original", reason?, tailoredId?, sha256, keywordsBefore?, keywordsAfter?, waitedMs}
shadow arm: the tailoring promise is NOT awaited. It finishes on its own and writes its own TailoredResume row; the run,
its browser and its queue slot are released as today. (Needs-input early returns and finally are unchanged.)
```

`tailorResume` inside:

```
row   = TailoredResume(userId, jobId, docHash, TAILOR_VERSION)  ready → storage.get(fileKey) → return the same bytes and sha256
                                                               building < 60 s old → wait for it (1 s polls, within the caller's cap)
                                                               refused → {ok:false, reason}; missing, failed or stale building → create/take over as building
plan  = planTailoring(doc, job)                                → error/timeout: row failed "plan_failed", {ok:false}
out   = applyPlan(doc, plan, job)                              → TailoredDoc, changes, refused lines
pdf   = renderPdf(renderHtml(out, header, paper), plan.drop)   → one fit-and-print (§4.7); cannot fit after trimming: refused "too_long"
check R (read back)                                            → fail: refused "readback_failed"
storage.put(key, pdf, "application/pdf", userId); row → ready (fileKey, sha256, pages, changes, keywords, latency)
```

Every `{ok:false}` leaves the row `refused` or `failed` with its `reason`, so the reason is visible and a re-run does not repeat a paid call that will fail the same way (`failed`, a network or timeout error, is retried on the next run; `refused` is final for that `TAILOR_VERSION`).

Account deletion: `deleteAccount` (`account/index.ts`) already deletes files by `userId` (`storage.ts:44`), which covers `tailored/`; the `TailoredResume` rows go by the cascade. A tailoring promise still running when the account is deleted fails its `put`/row write (the user is gone) and is dropped; L4 makes `tailorResume` check the user still exists before `storage.put`.

### 4.7 Rendering (L3)

- `renderHtml(doc, header, paper)`: a string template (no React on the worker), escaped text, one embedded `<style>`; tested by snapshot of its text order.
- `renderPdf(html, dropOrder)`: a headless `chromium.launch({ headless: true })` owned by the renderer, launched on first use (a shared launch promise, so two concurrent runs never launch two) and reused for the worker's life (closed on worker shutdown); one new page per render, closed in `finally`, so concurrent renders (up to the worker's run slots) are separate pages of one browser.
- Fit before print, in the page: `page.setContent(html)`, then measure the content height against the page budget (`page.evaluate`) and, while it overflows, remove bullets in this order: the model's `drop` list first, then the last bullet of the oldest role that still has 2+ bullets, then the last project; at most 12 removals, all in the DOM, no re-render. Still over: refused `too_long`. Then one `page.pdf({ format, printBackground: false, margin })`. ≈0.5–1.5 s per render after launch.
- Page count from `readPdf` (pdf-parse v2 `total`) in the read-back. Budget = the original's page count (`doc.pages`).

### 4.7a Measuring the user's style (L3)

Run once per resume in the `resume-doc` handler, after the doc is built: `extractStyle(originalPdfBytes, doc)` with `pdfjs-dist`.
- **Text items** (`getTextContent`): font name (embedded names like `ABCDEF+Calibri-Bold` → family `Calibri`, weight, italic), size (from the transform), x/y. The most common size and font by character count = body; the largest on page 1 = name; lines that match the doc's section headings = heading font, size and case (all upper-case → `upper`).
- **Colours and rules** (`getOperatorList`): fill colour in force for name, heading and body text; thin horizontal paths right under headings → `rule: below` with its colour.
- **Layout**: margins = the text's bounding box per page; two columns when the lines split into two x-bands that each hold whole sections over most of the page height (the narrower band = sidebar, with the sections in it); dates right-aligned when date tokens of roles end within 2 % of the right margin; header centred when the name's centre is within 3 % of the page centre; bullet glyph = the most common first character of bullet lines; line height from the median baseline gap of body lines.
- **Fonts**: the family maps to a bundled font: same family if bundled (Lato, Open Sans, Roboto, Source Sans 3, EB Garamond, Merriweather), metric-compatible stand-in (Calibri → Carlito, Cambria → Caladea, Arial/Helvetica → Liberation Sans, Times → Liberation Serif, CMR/LM → Latin Modern), else the closest by class (serif / sans / mono).
- **Confidence** (0–1, code): starts at 1; minus for an image on page 1 larger than 5 % of the page (photo, graphic header), text drawn as images (pdf text covers < 60 % of the page's ink area, rendered with `@napi-rs/canvas`, also already installed), more than two x-bands, a font mapped only by class, table-like grids. Below 0.7 → `resumeDocError = "style_unsupported"`, the switch is disabled with the notice in §5, and the original is always sent.
- Then the preview is rendered (the doc, no job changes, in this style) and stored at `resumes/{userId}/preview-{docHash8}.pdf`.

Fidelity check on the preview (also code): its page size equals the original's; margins within 4 pt; body size within 0.5 pt; same column count; same section order; page count ≤ the original's. A failed fidelity check counts as `style_unsupported`.

### 4.8 Checks (code, `tailor/check.ts`; all pure)

Per rewritten line (bullet, project bullet), against its own source line:
- **N numbers**: every number token (`\d[\d.,]*%?`, `\$?\d+[kKmM+]?`) in the new text appears in the source line.
- **T terms**: every capitalised token anywhere in the new text (sentence start included), and every token with digits, `+`, `#`, `.` or `/`, appears in the source line, or is an alias (§4.1) of a term in the source line. Exempt: a short fixed list of action verbs and stop words (`Built`, `Led`, `Designed`, `The`, `A`, …, in `check.ts`), and only when the source line uses that verb or the token is a stop word.
- **K known skill**: any term from `tailor/vocab.ts` or the candidate's skills found in the new text (lower-cased, `mentions`) appears in the source line or as its alias.
- **L length**: ≤ 1.3 × source length + 40 characters; not empty.
- **O orphan words**: no new company, school or person name (no capitalised multi-word phrase absent from the doc).
A failed line keeps its source text; the change is recorded as `refused` with the check letter (logged as letters and ids, never text).

Summary: N against the whole doc plus `floor(yearsExperience)` ("X+ years"; 2.5 years is "2+ years", never "3+"); T and K against the whole doc; ≤ 450 chars. Fails → the doc's own summary (or none).

Structure: roles, their companies, titles and dates, education, contact, links come from the doc, not the plan; role order = doc order; every role keeps ≥ 1 bullet; `drop` never removes a role, education entry or the last bullet of a role; `rename` only along the alias table; `promote` only a skill that appears in some bullet's text (`mentions()`).

**R read back** (after render): `pdf-parse` text of the tailored PDF contains the name and email, every role's company and title, and ≥ 95 % of `docText(tailoredDoc)` tokens; page count within budget. Fail → original.

Keywords: `keywordsBefore` = job keywords found in the original `resumeText`; `keywordsAfter` = found in the tailored PDF text. Shown to the user; never a gate.

### 4.9 Security and privacy

- Resume text and the tailored text are personal data: never logged. Logs and events carry ids, check letters, counts, timings.
- Tailored PDFs only through `lib/storage.ts`, with `userId`, served only to the owner by `GET /api/files/{key}`. Account deletion removes them (files by `userId`) and the `TailoredResume` rows (cascade), §4.6.
- The model receives the job and the `ResumeDoc` (no phone, email, address); the header is added by code.
- Test profiles tailor too (they only run on `/mock/greenhouse`), so the smoke covers the whole path.
- Governance: no `rules.json` key (its Zod schema would strip it, `rules.ts:5`); the rule lives in code (§4.8) and in CLAUDE.md (L6). No new submit rule: a tailored resume never blocks or delays a submit.

### 4.10 Failure handling

| Failure | Result |
|---|---|
| ResumeDoc coverage too low / parse fails twice | `resumeDocError`, original sent on every application, reason `resume_unsupported` shown once on Account ("Your resume's layout can't be tailored; we send it as is"). |
| Doc not built yet (just opted in, or a new resume) | `resume-doc` enqueued, original sent, reason `doc_building`. |
| Style confidence below 0.7 or preview fidelity fails | `resumeDocError = "style_unsupported"`, original sent, switch disabled with the notice (section 5). |
| Plan call fails or times out (25 s, aborted) | `failed` row, original sent; retried on the next run of that application. |
| Check refuses some lines | Those lines keep the original text; the rest is used. |
| Check refuses the whole plan (no line passed and no reorder) | `refused` "no_change", original sent. |
| Render or read-back fails | `failed`/`refused`, original sent. Headless browser crash: relaunched on next use. |
| Not ready by `TAILOR_WAIT_MS` at upload | Original sent, `resume` event reason `late`; the promise finishes and caches for a retry. |
| Storage write fails | Original sent; nothing cached. |

Never: a failed tailoring fails, blocks or retries an application.

### 4.11 Observability

- `ApplicationEvent` type `resume`, message "Sent your resume tailored for this job" / "Sent your original resume (reason)", data `{arm, sent, reason?, tailoredId?, keywordsBefore?, keywordsAfter?, waitedMs, latencyMs?}`.
- Worker log line per tailoring: `tailor app=… ok|refused|failed reason=… ms=… refusedLines=N keywords=a→b` (no text).
- `scripts/tailor-report.ts` (L6): over a date range, arm counts, sent tailored / original by reason, latency p50/p90, late rate, refused-line rate by check letter, keywords before/after.

### 4.12 Code map

| Path | New / changed | Task |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/2026110x_resume_doc/` (hand-written) | Profile columns (`resumeDoc`, `resumeDocFrom`, `resumeDocError`, `resumeStyle`) | L1 |
| `src/modules/profile/resumeDoc.ts`, `parseResume.ts` (export `readPdf`), `index.ts` exports | new / changed | L1 |
| `scripts/resume-doc-test.ts` | new | L1 |
| `docs/ARCHITECTURE.md` §4 (Profile columns) | data model | L1 |
| `src/lib/llm.ts` | `timeoutMs`, `maxTokens` options | L2 |
| `src/modules/apply/tailor/{plan,check,aliases,vocab,keywords}.ts` | new | L2 |
| `src/modules/jobs/mentions.ts` (new), `match.ts` imports it | move `mentions` | L2 |
| `scripts/tailor-check-test.ts`, `scripts/tailor-plan-live.ts` | new | L2 |
| `src/modules/apply/tailor/render.ts`, `style.ts`, `fonts/` (OFL/Apache font files and their licences), `scripts/tailor-render-test.ts`, `scripts/tailor-style-test.ts` | new | L3 |
| `prisma/…_tailored_resume/` (hand-written), `src/modules/apply/tailor/index.ts` | `TailoredResume`, orchestrator | L4 |
| `src/worker/handlers/resume-doc.ts`, `src/worker/index.ts`, `src/lib/queue.ts`, `parseResume.ts saveParsedResume` (enqueue) | `resume-doc` queue, renderer closed on shutdown | L4 |
| `src/app/api/answers/route.ts` | enqueue `resume-doc` when `tailor_resume` is saved as Yes | L4 |
| `src/modules/apply/runner.ts` | arm, start, wait, swap bytes, fill row value, `resume` event | L4 |
| `src/modules/answers/keys.ts` (`tailor_resume`, no synonyms, like `accept_ai_essays`) | the switch's key, read by the runner | L4 |
| `src/modules/account/index.ts` | existence check before `put` covered by the cascade; verify | L4 |
| `src/app/mock/schema.ts`, `src/app/api/mock/submit/route.ts` | store `resumeSha256` of the uploaded file in `MockSubmission.payload` | L4 |
| `scripts/tailor-smoke.ts` | mock form, test profile | L4 |
| `docs/ARCHITECTURE.md` §6.5, §6.21 (new), §9, §11 | decisions | L4 |
| `src/app/(app)/applications/[id]/page.tsx` + a `resume-sent` component, `src/lib/event-labels.ts` | "Resume sent" row | L5 |
| `src/app/(app)/account/…`, `src/lib/storage.ts` (`exists(key)`) | switch, Preview link, unsupported notice | L5 |
| `scripts/tailor-report.ts`; `docs/PRD.md` FR11 and §8; `CLAUDE.md` hard rule | measure, scope, rule | L6 |

### 4.13 Env (ARCHITECTURE §11 additions)

| Var | Default | Meaning |
|---|---|---|
| `TAILOR_RESUME` | `off` | `off` · `shadow` (build, check, store, record; send original) · `on` (send tailored when ready) |
| `TAILOR_SHARE` | `1` | With `on`: share of applications that send the tailored resume (by hash of the application id), the rest original. `0.5` for the split. |
| `TAILOR_WAIT_MS` | `10000` | Longest the upload step waits for tailoring before sending the original. |

---

## 5. UI

Design source: `docs/DESIGN.md` and `design/detail.html` (ink and lime, outline badges, dashed for AI). There is no owner design for these two pieces yet (§11, Q4); L5 builds them from the existing detail-row and badge patterns.

1. **Application page, "Resume sent" row** (with the filled fields): file icon, "Tailored for this job" with the dashed AI-draft badge style, or "Your resume" solid. Under it: "7 of the job's keywords, was 4" and a "What changed" disclosure listing `changes` as plain lines ("Moved your Kafka work to the top", "Renamed Postgres to PostgreSQL, as the job writes it", "Summary rewritten for a backend role"). "Download" opens the exact file sent. Original sent with a reason: one grey line ("Sent your original resume: tailoring wasn't ready in time"). States: loading (skeleton row), empty (no resume event on older applications: row hidden), error (file missing: "File not available").
2. **Account, under Resume**: a switch "Tailor my resume to each job", **off by default** (opt-in, standing answer key `tailor_resume`, §11 Q2). Turning it on saves `tailor_resume` = Yes and enqueues `resume-doc`; the row shows "Preparing a preview in your resume's style" until the preview file exists, then "Preview" downloads the user's own resume rebuilt in their measured style with no job changes, so they can compare it with the original before any application uses it. When `resumeDocError` or a low style confidence is set: "Your resume can't be rebuilt in its own style (it has photos, graphics or tables); we send it as is." and the switch is disabled.

No change to the feed card or the swipe.

---

## 6. API

No new route. The application page reads the `resume` event and the `TailoredResume` row server-side; the file goes through the existing `GET /api/files/{key}`. The Account switch writes the `tailor_resume` answer through the existing `PUT /api/answers`. The Account "Preview" is a plain link to `GET /api/files/resumes/{userId}/preview-{docHash8}.pdf`: the worker renders that file (the doc with no job changes) right after it builds a `ResumeDoc` (L4), because rendering needs Playwright and routes never launch a browser. Until the file exists the link is hidden.

---

## 7. Testing

| Check | Task | What it proves | PASS when |
|---|---|---|---|
| `scripts/resume-doc-test.ts` | L1 | split + coverage on real resumes: every profile in the DB (read-only, 10 today) plus `nitin_resume_1.pdf` passed as an arg | ≥ 9 of 11 build with coverage over the chosen thresholds; a fixture with a dropped section fails coverage; only numbers printed, no resume text |
| `scripts/tailor-check-test.ts` | L2 | §4.8 offline, no model | ≥ 20 cases: invented number, new tool, new company, renamed skill outside aliases, dropped role, reordered roles, summary with an unlisted skill, too long → refused; alias rename, reorder, promote from a bullet, faithful rewrite → kept |
| `scripts/tailor-plan-live.ts` | L2 | the real prompt on 5 real jobs × 2 resumes | 0 whole-plan refusals; refused lines ≤ 15 %; plan ≤ 15 s p90; keywordsAfter ≥ keywordsBefore on every job |
| `scripts/tailor-render-test.ts` | L3 | template + PDF + read back | one page for a 1-page fixture; read-back ≥ 95 %; render ≤ 2 s after launch; works while `DEMO_HEADED=1` |
| `scripts/tailor-style-test.ts` | L3 | style measured and matched, on every profile's stored PDF (read-only) plus `nitin_resume_1.pdf` | each prints confidence and the fidelity numbers (no text); a photo-header fixture and a two-column fixture are classified right; the owner looks at original and preview side by side for 10 resumes and says ≥ 7 "look like mine" |
| `scripts/tailor-smoke.ts` | L4 | the runner on the mock form, test profile, `TAILOR_RESUME=on` | the mock submission's `resumeSha256` equals the `TailoredResume.sha256` and the `resume` event says tailored; a second run reuses the row (no plan call) and uploads the same sha256; `TAILOR_WAIT_MS=1` sends the original (its sha256) with reason `late` and the application still submits; a profile with no doc sends the original with `doc_building` and gets one `resume-doc` job; `shadow` sends the original and the row still appears |
| `npx playwright test` / UI check | L5 | the row in light and dark at 390 px | screenshots match the detail patterns; loading/empty/error states present |
| `scripts/tailor-report.ts` | L6 | shadow then split on real swipes | §8 gates |

---

## 8. Rollout

1. L1–L5 land with `TAILOR_RESUME=off`: nothing changes for users. The owner's own accounts opt in, to check the preview against the original.
2. **Shadow** on the laptop worker for ≥ 40 real applications (`TAILOR_RESUME=shadow`). Gates to go on: ready-by-upload ≥ 90 % of runs, whole-plan refusals ≤ 5 %, refused lines ≤ 15 %, zero read-back failures on supported resumes, owner reads 10 tailored PDFs against the originals and finds no untrue line.
3. **Split**: `TAILOR_RESUME=on`, `TAILOR_SHARE=0.5`. The `resume` event records the arm per application.
4. **All**: `TAILOR_SHARE=1` once the owner decides (§11 Q3); a measured effect needs reply tracking (§9).

Rollback: `TAILOR_RESUME=off` and restart the worker (check runs in flight first, owner memory). Nothing else depends on it.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| A reworded line overstates ("led" for "helped") | Prompt forbids changing the claim, only the order and the job's spelling; L/N/T/K checks; owner review of 10 in shadow; the user sees every change and can turn it off. Residual: verb strength is not code-checked. |
| The rebuilt resume doesn't look like theirs | Style measured from their PDF (§4.7a); low-confidence styles are never tailored; opt-in with a preview first; owner judges 10 real resumes side by side in L3; switch off keeps the original. |
| A font the resume uses has no bundled equivalent | Mapped by class (serif / sans / mono, weight) to the closest bundled family; the style's confidence drops; below the floor, not tailored. |
| Effect unproven | Split recorded per application; reply tracking (a Gmail read-only integration with consent, also wanted for Greenhouse codes) is the follow-up that makes it measurable. |
| A second headless Chromium per worker (≈150 MB) | Launched lazily, one per worker, reused; closed on shutdown. |
| Queue backlog makes tailoring irrelevant to latency but costs calls for skipped/cancelled applications | Started only when the run starts, not on swipe. |
| `ResumeDoc` misses content (two-column, image resumes) | Coverage check refuses; original sent. |
| ATS parsers differ | One conservative template; Greenhouse/Lever/Ashby/Keka all accept text PDFs; read-back check. |

---

## 10. Tasks

In [TASKS.md](TASKS.md) beside this file: L1–L6, each with Do, the sections it builds, Done when and its Done line. Root `docs/TASKS.md` Phase L lists them one line each. Order L1 → L2 → L3 → L4 → L5 → L6; L2 and L3 do not depend on each other and may swap. One session each, plan first, the check run and pasted, typecheck and lint.

---

## 11. Decisions closed with the owner

Closed (5 Nov): tailor per job on the fly; never add facts; never delay or fail an application for it; original sent whenever tailoring is off, late or refused.

Closed with the owner, 5 Nov (after the verifier's review):
- **Q1 Design: keep the user's own look, by matching their style.** Editing the PDF itself was rejected (positioned text runs, subset fonts, old text left where ATSs read it). The tailored resume is rebuilt in the user's own style, measured from their PDF (§4.7a): page size, margins, one or two columns, fonts (mapped to bundled metric-compatible fonts), sizes, colours, heading case and rules, bullet glyph, date placement, section order. Close to theirs, not pixel-identical. A resume whose style cannot be measured with confidence (photo, graphics-heavy, image text, tables) is never tailored: the original goes, reason `style_unsupported`. Not chosen: in-place Word editing, PDF reorder-only.
- **Q2 Opt-in.** Off for every user until they turn it on (Account switch, `tailor_resume` = Yes). Turning it on builds the doc and style and shows a preview first.
- **Q3 50/50 split first** after shadow: `TAILOR_SHARE=0.5` among opted-in users, recorded per application.
- **Q6 Label:** the fill row keeps source `resume`, with a dashed "Tailored" badge and the "What changed" list as its basis; it does not count against `max_ai_drafts_per_application`.

Taken as proposed (the owner can still change them):
- **Q4** UI built from the existing detail-row and badge patterns; no new owner design needed first.
- **Q5** Page budget = the original's page count.
- **Q7** File name stays `resume.pdf`.
- **Q8** No backfill for everyone: a doc is built when a user opts in (and on each resume upload while opted in).

---

## 12. Sources

- Code read 5 Nov: `src/modules/apply/runner.ts` (resume read ~192, `uploadNow` ~300), `src/modules/profile/profileSchema.ts`, `parseResume.ts`, `src/modules/apply/browser.ts`, `src/modules/jobs/match.ts` (`mentions`), `adapters/lever.ts`, `adapters/keka.ts`, `config/rules.json`, `prisma/schema.prisma`.
- DB measurements 5 Nov (read-only): 389 submitted applications all time; first-event→fill on 68 first-attempt submits, 5 days.
- Worker log 4 Nov: `gpt-4o-mini` token rates.
- Playwright docs: `page.pdf()` is supported in headless Chromium only.
