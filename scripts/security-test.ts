// Multi-user safety: two temporary users try to read and change each other's data through every route; limits,
// the URL allow-list, headers, the rate limiter, the in-flight cap, and account export and deletion.
// Needs `npm run dev`. Creates and removes its own users and fixtures. npx tsx scripts/security-test.ts
import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { db } from "../src/lib/db";
import { isAdmin } from "../src/lib/admin";
import { mockFormEnabled } from "../src/lib/mock-gate";
import { rateLimit } from "../src/lib/rate-limit";
import { storage } from "../src/lib/storage";
import { check as governance, historyFor, loadRules } from "../src/modules/governance";
import { deleteAccount, exportAccount } from "../src/modules/account";
import { formUrlAllowed } from "../src/modules/apply/urls";
import { PROFILE_ROOT } from "../src/modules/apply/browser";
import { pruneOrphanProfiles } from "../src/worker/reaper";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const BASE = "http://localhost:3000";
const stamp = Date.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function makeUser(label: string) {
  const user = await db.user.create({ data: { email: `sec-${label}-${stamp}@swipeapply.local`, name: `Sec ${label}` } });
  await db.profile.create({
    data: { userId: user.id, resumeKey: `resumes/${user.id}/resume.pdf`, resumeText: `resume of ${label}`, fullName: `Person ${label}`, email: user.email, skills: [], experience: [], education: [], rawJson: {} },
  });
  const token = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  return { user, cookie: `authjs.session-token=${token}` };
}

async function main() {
  const job = await db.job.findFirst({ where: { source: "greenhouse" } });
  if (!job) throw new Error("no greenhouse job");
  const A = await makeUser("a");
  const B = await makeUser("b");
  const cleanupUsers = [A.user.id, B.user.id];
  const call = (who: { cookie: string } | null, method: string, path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, { method, redirect: "manual", headers: { ...(who ? { Cookie: who.cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });

  try {
    // Fixtures that belong to A.
    const appA = await db.application.create({ data: { userId: A.user.id, jobId: job.id, status: "needs_input", fields: [{ key: "email", label: "Email", value: "a@x", source: "user", selector: "#e" }], pendingQuestions: [{ key: "notice_period", label: "Notice period", type: "text", required: true }] } });
    const appB = await db.application.create({ data: { userId: B.user.id, jobId: job.id, status: "needs_input", fields: [], pendingQuestions: [{ key: "notice_period", label: "Notice period", type: "text", required: true }] } });
    await db.answer.create({ data: { userId: A.user.id, key: "notice_period", question: "Notice", answer: "A-SECRET-ANSWER", source: "user" } });
    await storage.put(`screenshots/${appA.id}/1.png`, new Uint8Array([137, 80, 78, 71]), "image/png", A.user.id);

    // ---- signed out: every protected route says 401, none crashes
    const anon: Array<[string, string, unknown?]> = [
      ["GET", "/api/answers"], ["PUT", "/api/answers", { answers: [] }], ["GET", "/api/applications"], ["GET", "/api/applications/summary"], ["GET", `/api/applications/${appA.id}`],
      ["POST", `/api/applications/${appA.id}/cancel`], ["POST", `/api/applications/${appA.id}/retry`], ["POST", `/api/applications/${appA.id}/answers`, { answers: [{ key: "notice_period", answer: "1" }] }],
      ["GET", "/api/profile"], ["PUT", "/api/profile", {}], ["GET", "/api/jobs"], ["POST", "/api/swipes", { jobId: job.id, direction: "right" }],
      ["GET", `/api/files/screenshots/${appA.id}/1.png`], ["POST", "/api/jobs/ingest", { days: 7 }], ["GET", "/api/account/export"], ["POST", "/api/account/delete", { confirm: "DELETE MY ACCOUNT" }],
    ];
    const anonResults = await Promise.all(anon.map(async ([m, p, b]) => [`${m} ${p.replace(appA.id, "<id>")}`, (await call(null, m, p, b)).status] as const));
    const notDenied = anonResults.filter(([, s]) => s !== 401);
    check("every protected route answers 401 when signed out", notDenied.length === 0, notDenied.map(([n, s]) => `${n} ${s}`).join("; "));

    // ---- B tries to reach A's things
    const cross: Array<[string, string, unknown?]> = [
      ["GET", `/api/applications/${appA.id}`], ["POST", `/api/applications/${appA.id}/cancel`], ["POST", `/api/applications/${appA.id}/retry`],
      ["POST", `/api/applications/${appA.id}/answers`, { answers: [{ key: "notice_period", answer: "hijack" }] }],
    ];
    const crossResults = await Promise.all(cross.map(async ([m, p, b]) => [`${m} ${p.replace(appA.id, "<A's application>")}`, (await call(B, m, p, b)).status] as const));
    check("another user's application is not found for read, cancel, retry and answer", crossResults.every(([, s]) => s === 404), crossResults.map(([, s]) => `${s}`).join(","));
    const stillA = await db.application.findUnique({ where: { id: appA.id } });
    check("none of those attempts changed it", stillA?.status === "needs_input" && (await db.answer.count({ where: { userId: B.user.id, key: "notice_period" } })) === 0);
    const fileAsB = await call(B, "GET", `/api/files/screenshots/${appA.id}/1.png`);
    check("another user's file is not served", fileAsB.status === 404, String(fileAsB.status));
    const fileAsA = await call(A, "GET", `/api/files/screenshots/${appA.id}/1.png`);
    check("the owner's file is served, private and unsniffable", fileAsA.status === 200 && /no-store/.test(fileAsA.headers.get("cache-control") ?? "") && fileAsA.headers.get("x-content-type-options") === "nosniff", `${fileAsA.status} ${fileAsA.headers.get("cache-control")}`);
    const listB = (await (await call(B, "GET", "/api/applications")).json()) as { applications: Array<{ id: string }> };
    check("a user's list holds only their own applications", listB.applications.length === 1 && listB.applications[0].id === appB.id);
    const summaryB = JSON.stringify(await (await call(B, "GET", "/api/applications/summary")).json());
    const summaryA = (await (await call(A, "GET", "/api/applications/summary")).json()) as { waiting: Array<{ id: string }> };
    check("the waiting-for-you summary is per user", !summaryB.includes(appA.id) && summaryA.waiting.some((row) => row.id === appA.id), summaryB.slice(0, 80));
    const answersB = JSON.stringify(await (await call(B, "GET", "/api/answers")).json());
    check("a user's answers never include another's", !answersB.includes("A-SECRET-ANSWER"));
    const profileB = JSON.stringify(await (await call(B, "GET", "/api/profile")).json());
    check("a user's profile is their own", profileB.includes("Person b") && !profileB.includes("Person a"));
    const swipeOwn = await call(B, "POST", "/api/swipes", { jobId: "no-such-job", direction: "left" });
    check("swiping on an unknown job is refused cleanly", swipeOwn.status === 404, String(swipeOwn.status));

    // ---- operator-only ingest
    check("a normal user cannot trigger ingest", (await call(B, "POST", "/api/jobs/ingest", { days: 7 })).status === 403);
    process.env.ADMIN_EMAILS = " Boss@Example.com , other@example.com ";
    check("operators come only from ADMIN_EMAILS (case-insensitive)", isAdmin("boss@example.com") && isAdmin("OTHER@example.com") && !isAdmin("user@example.com") && !isAdmin(null));
    delete process.env.ADMIN_EMAILS;
    check("with no ADMIN_EMAILS nobody is an operator", !isAdmin("boss@example.com"));

    // ---- input limits
    check("an over-long saved answer is refused", (await call(B, "PUT", "/api/answers", { answers: [{ key: "notice_period", question: "q", answer: "x".repeat(2001), source: "user" }] })).status === 400);
    check("too many answers in one request are refused", (await call(B, "PUT", "/api/answers", { answers: Array.from({ length: 61 }, () => ({ key: "notice_period", question: "q", answer: "1", source: "user" })) })).status === 400);
    check("an over-long answer to a running application is refused", (await call(B, "POST", `/api/applications/${appB.id}/answers`, { answers: [{ key: "notice_period", answer: "y".repeat(2001) }] })).status === 400);
    check("a normal answer is accepted", (await call(B, "PUT", "/api/answers", { answers: [{ key: "notice_period", question: "Notice", answer: "30", source: "user" }] })).status === 200);

    // ---- headers
    const page = await fetch(`${BASE}/sign-in`, { redirect: "manual" });
    const h = (name: string) => page.headers.get(name) ?? "";
    check("pages carry the security headers", h("x-content-type-options") === "nosniff" && h("x-frame-options") === "DENY" && /strict-origin/.test(h("referrer-policy")) && /camera=\(\)/.test(h("permissions-policy")) && !h("x-powered-by"));

    // ---- the rate limiter
    const key = `sectest:${stamp}`;
    const first = [];
    for (let i = 0; i < 5; i += 1) first.push((await rateLimit(key, 3, 60)).ok);
    check("a limit of 3 lets exactly 3 through", first.filter(Boolean).length === 3 && first.slice(0, 3).every(Boolean), first.join(","));
    const limited = await rateLimit(key, 3, 60);
    check("a refused call says how long to wait", !limited.ok && limited.retryAfterSeconds >= 1 && limited.retryAfterSeconds <= 60, `${limited.retryAfterSeconds}s`);
    const parallel = await Promise.all(Array.from({ length: 12 }, () => rateLimit(`${key}:p`, 4, 60)));
    check("parallel calls cannot exceed the limit", parallel.filter((r) => r.ok).length === 4, `${parallel.filter((r) => r.ok).length} of 12`);
    check("one user's limit does not use another's", (await rateLimit(`sectest-other:${stamp}`, 3, 60)).ok);
    await rateLimit(`${key}:short`, 1, 2);
    await sleep(2300);
    check("a limit lifts after its window", (await rateLimit(`${key}:short`, 1, 2)).ok);
    await db.$executeRaw`DELETE FROM "RateEvent" WHERE "key" LIKE ${`%${key}%`} OR "key" = ${`sectest-other:${stamp}`}`;

    // ---- mock form gate
    const was = { node: process.env.NODE_ENV, flag: process.env.ENABLE_MOCK_FORM };
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production"; delete env.ENABLE_MOCK_FORM;
    const prodOff = mockFormEnabled();
    env.ENABLE_MOCK_FORM = "1";
    const prodOn = mockFormEnabled();
    env.NODE_ENV = "development"; delete env.ENABLE_MOCK_FORM;
    const devOn = mockFormEnabled();
    env.NODE_ENV = was.node; if (was.flag === undefined) delete env.ENABLE_MOCK_FORM; else env.ENABLE_MOCK_FORM = was.flag;
    check("the mock form is off in production unless enabled, and on in development", !prodOff && prodOn && devOn);

    // ---- the worker opens only job-board addresses
    const ok = [["https://job-boards.greenhouse.io/embed/job_app?for=x&token=1", "greenhouse"], ["https://job-boards.eu.greenhouse.io/embed/job_app?for=x&token=1", "greenhouse"], ["https://jobs.lever.co/acme/123/apply", "lever"], ["https://jobs.eu.lever.co/acme/123/apply", "lever"], ["http://localhost:3000/mock/greenhouse", "mock"]] as const;
    const bad = [
      ["http://job-boards.greenhouse.io/x", "greenhouse"], ["https://job-boards.greenhouse.io.evil.com/x", "greenhouse"], ["https://evil.com/job-boards.greenhouse.io", "greenhouse"],
      ["https://job-boards.greenhouse.io@evil.com/x", "greenhouse"], ["https://job-boards.greenhouse.io:8443/x", "greenhouse"], ["https://jobs.lever.co/acme/1", "greenhouse"],
      ["https://job-boards.greenhouse.io/x", "lever"], ["file:///etc/passwd", "greenhouse"], ["javascript:alert(1)", "lever"], ["not a url", "greenhouse"],
      ["http://localhost:3000/admin", "mock"], ["http://evil.com/mock/greenhouse", "mock"], ["https://jobs.lever.co/acme/1/apply", "mock"], ["https://x.com/", "unknown-source"],
    ] as const;
    check("every genuine job-board address is allowed", ok.every(([u, s]) => formUrlAllowed(u, s)), ok.filter(([u, s]) => !formUrlAllowed(u, s)).map(([u]) => u).join(" "));
    check("lookalikes, wrong ports, userinfo, other schemes and other sources are refused", bad.every(([u, s]) => !formUrlAllowed(u, s)), bad.filter(([u, s]) => formUrlAllowed(u, s)).map(([u]) => u).join(" "));

    // ---- one user cannot fill the shared queue
    const cap = loadRules().max_in_flight_per_user;
    for (let i = 0; i < cap; i += 1) await db.application.create({ data: { userId: B.user.id, jobId: job.id, status: i % 2 ? "queued" : "filling", fields: [], pendingQuestions: [] } });
    const hist = await historyFor(B.user.id, { title: "Anything", companyId: job.companyId });
    check("running and queued applications count toward the cap, ones waiting on the user do not", hist.inFlight === cap, `${hist.inFlight}`);
    const probe = await db.application.create({ data: { userId: B.user.id, jobId: job.id, status: "queued", fields: [], pendingQuestions: [] } });
    const capped = await governance("swipe_right", { applicationId: probe.id, profileExists: true, score: 90, inFlight: hist.inFlight });
    check("one past the cap is blocked with its rule name", !capped.ok && capped.rule === "max_in_flight", String(capped.rule));
    const under = await governance("swipe_right", { applicationId: probe.id, profileExists: true, score: 90, inFlight: cap - 1 });
    check("one below the cap is still allowed", under.ok);
    check("another user is not affected by it", (await historyFor(A.user.id, { title: "Anything", companyId: job.companyId })).inFlight === 0);

    // ---- export and deletion
    const exported = JSON.stringify(await exportAccount(A.user.id));
    check("a user's export holds their data and nobody else's", exported.includes("A-SECRET-ANSWER") && exported.includes("Person a") && !exported.includes("Person b"));
    const exportRoute = await call(A, "GET", "/api/account/export");
    check("the export download is an attachment, uncached", exportRoute.status === 200 && /attachment/.test(exportRoute.headers.get("content-disposition") ?? "") && /no-store/.test(exportRoute.headers.get("cache-control") ?? ""));
    mkdirSync(`${PROFILE_ROOT}/${A.user.id}/slot-0`, { recursive: true });
    mkdirSync(`${PROFILE_ROOT}/${B.user.id}/slot-0`, { recursive: true });
    check("deleting needs the exact confirmation", (await call(A, "POST", "/api/account/delete", { confirm: "yes" })).status === 400 && (await db.user.count({ where: { id: A.user.id } })) === 1);
    await db.$executeRaw`INSERT INTO "SubmitLock" ("userId", "holderId", "expiresAt") VALUES (${A.user.id}, ${appA.id}, now() + interval '1 minute')`;
    await db.rateEvent.create({ data: { key: `resume:${A.user.id}` } });
    const deleted = await call(A, "POST", "/api/account/delete", { confirm: "DELETE MY ACCOUNT" });
    check("the right phrase deletes the account", deleted.status === 200, String(deleted.status));
    const left = {
      user: await db.user.count({ where: { id: A.user.id } }), profile: await db.profile.count({ where: { userId: A.user.id } }), answers: await db.answer.count({ where: { userId: A.user.id } }),
      apps: await db.application.count({ where: { userId: A.user.id } }), events: await db.applicationEvent.count({ where: { applicationId: appA.id } }), files: await db.fileBlob.count({ where: { userId: A.user.id } }),
      sessions: await db.session.count({ where: { userId: A.user.id } }), rate: await db.rateEvent.count({ where: { key: { endsWith: A.user.id } } }),
      locks: Number((await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "SubmitLock" WHERE "userId" = ${A.user.id} OR "holderId" = ${appA.id}`)[0].n),
    };
    check("everything about the user is gone", Object.values(left).every((n) => n === 0), JSON.stringify(left));
    check("the other user's data is untouched", (await db.application.count({ where: { userId: B.user.id } })) >= 1 && (await db.answer.count({ where: { userId: B.user.id } })) === 1 && (await db.profile.count({ where: { userId: B.user.id } })) === 1);
    check("the deleted user's old session no longer works", (await call(A, "GET", "/api/applications")).status === 401);
    const removed = await pruneOrphanProfiles();
    check("the worker removes the deleted user's browser folder and keeps the live one", !existsSync(`${PROFILE_ROOT}/${A.user.id}`) && existsSync(`${PROFILE_ROOT}/${B.user.id}`) && removed >= 1, `${removed} removed`);
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    for (const id of cleanupUsers) {
      await deleteAccount(id).catch(() => undefined);
    }
    await pruneOrphanProfiles().catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS security" : `FAIL security (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
