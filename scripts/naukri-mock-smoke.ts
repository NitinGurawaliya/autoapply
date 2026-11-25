// K4b (docs/naukri/TASKS.md#k4b): Naukri's Apply end to end on the mock Naukri page, for a test profile.
//
// npx tsx scripts/naukri-mock-smoke.ts
//   Serves the mock Naukri page (app/mock/naukri/mock.ts, the same page the app serves at /mock/naukri) and its two
//   services on 127.0.0.1, then runs the real runner (runApplication, headless, no account) for a test profile on a mock
//   job: three questions answered from the user's answers, the date of birth (never guessed) asked once with the drawer
//   abandoned and nothing sent, then, after the answer, the run again through to the mock's "applied" reply, with the
//   answers' sources, a confirmation and a screenshot. Also the hard rule: the same test profile on a real Naukri job is
//   blocked before any window, and a mock address on another host is refused. Its own rows, removed at the end. Calls the
//   model where the answering chain does (mapping the date-of-birth wording once).
process.env.ENABLE_NAUKRI = "1";
process.env.ENABLE_NAUKRI_APPLY = "1";

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text));
  });

async function main() {
  // Imported after the switches are set: the boards are read when their module loads.
  const { db } = await import("../src/lib/db");
  const { storage } = await import("../src/lib/storage");
  const { upsert } = await import("../src/modules/answers");
  const { runApplication } = await import("../src/modules/apply/runner");
  const { APPLY_PATH, mockApplyReply, mockNaukriHtml, mockRespondReply, MOCK_NAUKRI_PATH, RESPOND_PATH } = await import("../src/app/mock/naukri/mock");

  const sent: string[][] = [];
  let presses = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === MOCK_NAUKRI_PATH) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(mockNaukriHtml({ jobId: url.searchParams.get("job") ?? "mock", services: MOCK_NAUKRI_PATH }));
    }
    if (req.method === "POST" && url.pathname === `${MOCK_NAUKRI_PATH}${APPLY_PATH}`) {
      const parsed = JSON.parse((await body(req)) || "{}");
      presses += 1;
      if (parsed.applyData) sent.push(parsed.applyData.answers ?? []);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockApplyReply(parsed)));
    }
    if (req.method === "POST" && url.pathname === `${MOCK_NAUKRI_PATH}${RESPOND_PATH}`) {
      await body(req);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(mockRespondReply()));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const stamp = Date.now();
  const user = await db.user.create({ data: { email: `naukri-mock-${stamp}@swipeapply.local` } });
  const company = await db.company.create({ data: { slug: `naukri-mock-${stamp}`, name: "Mock Naukri Co", source: "mock", active: false } });
  const jobRow = (source: string, externalId: string, applyUrl: string) =>
    db.job.create({ data: { companyId: company.id, source, externalId, title: "Java Full Stack Developer", location: "Bengaluru", country: "IN", remoteType: "onsite", description: "Java, Spring Boot, React. 1-3 years.", applyUrl, postedAt: new Date(), fetchedAt: new Date(), raw: {} } });
  const appFor = (jobId: string) => db.application.create({ data: { userId: user.id, jobId, status: "queued", fields: [], pendingQuestions: [] } });
  try {
    await db.profile.create({
      data: { userId: user.id, isTest: true, resumeKey: "x", resumeText: "Full stack developer, Java, Spring Boot, React", fullName: "Mock Tester", email: user.email, city: "Bengaluru", country: "India", yearsExperience: 2, currentTitle: "Full Stack Developer", tracks: ["fullstack"], skills: ["Java", "Spring Boot", "React"], experience: [], education: [], rawJson: {} },
    });
    for (const [key, question, answer] of [
      ["willing_to_relocate", "Are you willing to relocate?", "Yes"],
      ["current_ctc", "Current CTC", "12 LPA"],
      ["notice_period", "Notice period", "1 Month"],
    ] as const) {
      await upsert(user.id, { key, question, answer, source: "user" });
    }

    const externalId = `mock${stamp}`;
    const mockJob = await jobRow("mock", externalId, `http://127.0.0.1:${port}${MOCK_NAUKRI_PATH}?job=${externalId}`);
    const app = await appFor(mockJob.id);

    // Run 1: the date of birth is never guessed, so it is asked; nothing is sent.
    await runApplication(app.id);
    const first = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    const pending = (first.pendingQuestions as Array<{ key: string; label: string }>) ?? [];
    check("run 1 stops for the user", first.status === "needs_input", `${first.status} ${first.error ?? ""}`);
    check("asked once: the date of birth", pending.length === 1 && pending[0].label === "What is your date of birth?", JSON.stringify(pending));
    check("nothing was sent while a question was open", sent.length === 0 && presses === 1, `${sent.length} sent, ${presses} presses`);
    const events1 = await db.applicationEvent.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" } });
    const fills1 = events1.filter((event) => event.type === "fill").map((event) => `${(event.data as { key?: string }).key}:${(event.data as { source?: string }).source}`);
    // Relocation to a named city is a question about this job: settled from the profile and the job (guess and send),
    // never from the standing answer; pay and notice come from the user's own answers.
    check("three answered: relocation worked out for this job, pay and notice from the user's answers", fills1.length === 3 && /:(guessed|derived|matched|user)$/.test(fills1[0]) && fills1[1] === "current_ctc:user" && fills1[2] === "notice_period:user", fills1.join(","));
    check("the rules ran as the mock's (start, submit) and the press was recorded", ["start", "submit"].every((rule) => events1.some((event) => event.type === "rule_check" && event.rule === rule)) && events1.some((event) => event.type === "submit_attempt"));

    // The user answers (as the app's answers route saves it), and the run goes again.
    await upsert(user.id, { key: pending[0].key, question: pending[0].label, answer: "1998-04-07", source: "user" });
    await db.application.update({ where: { id: app.id }, data: { status: "queued", pendingQuestions: [] } });
    await runApplication(app.id);
    const done = await db.application.findUniqueOrThrow({ where: { id: app.id } });
    check("run 2 is sent", done.status === "submitted", `${done.status} ${done.error ?? ""}`);
    // Pay asked with no currency goes in the candidate's own, in rupees (valueResolver rupeesFor, 23 Nov): 12 LPA is 1200000.
    check("the mock received every answer in Naukri's own words", sent.length === 1 && sent[0].join("|") === "Yes|1200000|1 Month|07/04/1998", JSON.stringify(sent));
    const fields = (done.fields as Array<{ key: string; source: string }>) ?? [];
    check("the application keeps the four answers with their sources, the date of birth as the user's", fields.length === 4 && fields.every((field) => field.source) && fields[3].source === "user", fields.map((field) => `${field.key}:${field.source}`).join(","));
    const events2 = await db.applicationEvent.findMany({ where: { applicationId: app.id, createdAt: { gt: first.updatedAt } } });
    check("a confirmation from the apply service's reply", events2.some((event) => event.type === "submit" && /apply service answered 200/.test(event.message)));
    check("a screenshot of the confirmation", events2.some((event) => event.type === "screenshot" && /sent-\d+\.jpg$/.test(event.message)));

    // The hard rule: a test profile never reaches real Naukri, and the mock is only this app's own address.
    const realJob = await jobRow("naukri", `real${stamp}`, "https://www.naukri.com/job-listings-real-job-123");
    const realApp = await appFor(realJob.id);
    await runApplication(realApp.id);
    const real = await db.application.findUniqueOrThrow({ where: { id: realApp.id } });
    check("a test profile on a real Naukri job is blocked before any window", real.status === "blocked" && real.error === "test_profile_mock_only", `${real.status} ${real.error}`);
    const elsewhere = await jobRow("mock", `else${stamp}`, "http://evil.example/mock/naukri?job=x");
    const elseApp = await appFor(elsewhere.id);
    await runApplication(elseApp.id);
    const other = await db.application.findUniqueOrThrow({ where: { id: elseApp.id } });
    check("a mock address on another host is refused", other.status === "blocked" && other.error === "unsafe_form_url", `${other.status} ${other.error}`);
    // Run 1 pressed Apply once; run 2 pressed it and its last answer posted the apply: 3, and none from the blocked runs.
    check("no other press reached the mock", presses === 3, `${presses}`);
  } finally {
    server.close();
    // Screenshots the runs stored (through lib/storage.ts, the only code that touches FileBlob).
    const shots = await db.applicationEvent.findMany({ where: { application: { userId: user.id }, type: "screenshot" }, select: { message: true } }).catch(() => []);
    for (const shot of shots) await storage.delete(shot.message).catch(() => false);
    await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
    await db.job.deleteMany({ where: { companyId: company.id } });
    await db.company.delete({ where: { id: company.id } }).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS naukri-mock-smoke" : `FAIL naukri-mock-smoke (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
