// Phase U5: handing a shared job to the agent (modules/share/claim.ts, POST /api/share/claim). Two throwaway test users
// (an invented Android engineer with a test profile, and one without a profile). The claim module runs with a stubbed
// queue, so nothing is enqueued; the route is called over HTTP for the session, profile and intent-cookie cases (every
// job it gets there is one the rules stop before the queue). Jobs are picked from the database at run time. Both users
// are deleted at the end. Needs this checkout's dev server.
// npx tsx scripts/share-claim-test.ts [baseUrl]
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { ingestResume } from "../src/modules/profile";
import { claimShare, shareOutcome } from "../src/modules/share";

const BASE = process.argv[2] ?? "http://localhost:3000";
const APPLY = ["greenhouse", "ashby", "keka", "workable", "smartrecruiters", "zohorecruit"];
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

function pdf(lines: string[]) {
  const body = ["BT /F1 10 Tf 50 760 Td 13 TL", ...lines.map((line) => `(${line.replace(/[()\\]/g, "")}) '`), "ET"].join("\n");
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

// An invented person (no real data).
const RESUME = [
  "Arjun Menon",
  "Android Engineer | Bengaluru, Karnataka, India | arjun.menon.dev@example.test | +91 90000 12345",
  "",
  "SUMMARY",
  "Android engineer with 4 years of experience shipping consumer apps in Kotlin and Java.",
  "",
  "EXPERIENCE",
  "Android Engineer, Orbit Pay, Bengaluru (Jun 2021 - Present)",
  "- Built the payments app in Kotlin with Jetpack Compose, Coroutines, Flow and MVVM; 2M monthly users.",
  "- Cut cold start by 40% and crash rate by half; owned the release pipeline on Play Store.",
  "",
  "EDUCATION",
  "B.E., Computer Science, RV College of Engineering, 2021",
  "",
  "SKILLS",
  "Kotlin, Java, Android, Jetpack Compose, Coroutines, Flow, MVVM, Retrofit, Room, Dagger Hilt, Git, Firebase",
];

async function user(withProfile: boolean) {
  const created = await db.user.create({ data: { email: `share-claim-${Date.now()}-${withProfile ? "p" : "n"}@swipeapply.local`, name: "Arjun Menon" } });
  const sessionToken = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken, userId: created.id, expires: new Date(Date.now() + 1_800_000) } });
  if (withProfile) {
    const read = await ingestResume(created.id, pdf(RESUME));
    if (!read.ok) throw new Error(`resume not read: ${read.failure}`);
    await db.profile.update({ where: { userId: created.id }, data: { isTest: true } });
  }
  return { id: created.id, sessionToken };
}

async function post(token: string | null, body: unknown, intent?: string) {
  const cookies = [token ? `authjs.session-token=${token}` : "", intent ? `sa_intent=${intent}` : ""].filter(Boolean).join("; ");
  const response = await fetch(`${BASE}/api/share/claim`, { method: "POST", headers: { "Content-Type": "application/json", ...(cookies ? { cookie: cookies } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown>, setCookie: response.headers.get("set-cookie") ?? "" };
}

async function main() {
  const pick = (where: object) => db.job.findFirst({ where, orderBy: { postedAt: "desc" }, select: { id: true, title: true } });
  const [fit, low, closed, workday] = await Promise.all([
    pick({ source: { in: APPLY }, closedAt: null, eligibility: "india", readingCurrent: true, title: { contains: "Android", mode: "insensitive" } }),
    pick({ source: { in: APPLY }, closedAt: null, eligibility: "india", title: { contains: "Sales", mode: "insensitive" } }),
    pick({ source: { in: APPLY }, closedAt: { not: null } }),
    pick({ source: "workday", closedAt: null }),
  ]);
  if (!fit || !low || !closed || !workday) throw new Error("test jobs not found");

  const withProfile = await user(true);
  const noProfile = await user(false);
  try {
    // The module, with a stubbed queue.
    const queued: string[] = [];
    const stub = async (applicationId: string) => {
      queued.push(applicationId);
      return `stub-${applicationId}`;
    };

    const first = await claimShare(withProfile.id, fit.id, stub);
    check("a fitting job is handed to the agent", first.ok && !first.already && queued.length === 1, `${fit.title}: ${JSON.stringify(first)}`);
    const swipe = await db.swipe.findUnique({ where: { userId_jobId: { userId: withProfile.id, jobId: fit.id } } });
    check("the claim is a right swipe", swipe?.direction === "right");
    const again = await claimShare(withProfile.id, fit.id, stub);
    check("a second claim answers with the same application", again.ok && again.already && first.ok && again.applicationId === first.applicationId && queued.length === 1);
    const handed = await shareOutcome(withProfile.id, fit.id);
    check("the outcome is the queued application", handed?.status === "queued" && handed.rule === null);

    const shut = await claimShare(withProfile.id, closed.id, stub);
    check("a closed job is stopped before any application", !shut.ok && shut.reason === "blocked" && shut.rule === "job_closed" && !shut.applicationId);
    const board = await claimShare(withProfile.id, workday.id, stub);
    check("a board the agent can't use is stopped", !board.ok && board.reason === "blocked" && board.rule === "board_not_supported");

    const poor = await claimShare(withProfile.id, low.id, stub);
    check("a job under the minimum score is blocked by governance", !poor.ok && poor.reason === "blocked" && poor.rule === "min_match_score" && Boolean(poor.applicationId), `${low.title}: ${JSON.stringify(poor)}`);
    if (!poor.ok && poor.reason === "blocked" && poor.applicationId) {
      const application = await db.application.findUnique({ where: { id: poor.applicationId }, select: { status: true, error: true } });
      const events = await db.applicationEvent.count({ where: { applicationId: poor.applicationId } });
      check("blocked with the rule, and the check wrote events", application?.status === "blocked" && application.error === "min_match_score" && events > 0, `${events} events`);
      const outcome = await shareOutcome(withProfile.id, low.id);
      check("the page's outcome names the rule", outcome?.rule === "min_match_score", JSON.stringify(outcome));
    }
    check("nothing else was queued", queued.length === 1);

    // The route, over HTTP.
    const anonymous = await post(null, { jobId: fit.id });
    check("signed out: 401", anonymous.status === 401);
    const bare = await post(noProfile.sessionToken, { jobId: fit.id });
    check("no profile: 400 profile_required", bare.status === 400 && bare.body.error === "profile_required");
    const fromCookie = await post(withProfile.sessionToken, {}, closed.id);
    check("the intent cookie names the job when the body doesn't", fromCookie.status === 403 && fromCookie.body.blocked === "job_closed", JSON.stringify(fromCookie.body));
    check("the intent is cleared after the claim", /sa_intent=;/.test(fromCookie.setCookie) || /sa_intent=[^;]*;[^,]*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(fromCookie.setCookie), fromCookie.setCookie.slice(0, 120));
    const repeat = await post(withProfile.sessionToken, { jobId: fit.id });
    check("the body's job: an already handed job answers 200 with it", repeat.status === 200 && repeat.body.already === true && first.ok && repeat.body.applicationId === first.applicationId);
    const blocked = await post(withProfile.sessionToken, { jobId: low.id });
    check("a blocked job answers 403 with the rule and its application", blocked.status === 403 && blocked.body.blocked === "min_match_score" && typeof blocked.body.applicationId === "string");
    const none = await post(withProfile.sessionToken, {});
    check("no body and no intent: 400", none.status === 400 && none.body.error === "no_job");
  } finally {
    await deleteAccount(withProfile.id).catch(() => undefined);
    await deleteAccount(noProfile.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS share-claim-test" : `FAIL share-claim-test (${failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
