// Phase P, P4: "Also show nearby fields" and "Never show me" on the confirm screen. A throwaway test user (an invented
// data scientist, 1 year, read by the real resume reader) saves the confirm form through PUT /api/profile on the dev
// server, the way the page does, and reads the feed through GET /api/jobs. Checks: the settings persist; nearby on
// brings in an adjacent track's job; each "Never show me" chip removes its kind or flag; no Answer row is written by
// the saves; resume → first feed under 3 minutes. The user is deleted at the end. Needs this checkout's `npm run dev`.
// npx tsx scripts/feed-prefs-test.ts [baseUrl]
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { ADJACENT_TRACKS, feedTracks, jobGate, type FeedJob } from "../src/modules/jobs";
import { titleTrack } from "../src/modules/jobs/gate";
import { ingestResume } from "../src/modules/profile";

const BASE = process.argv[2] ?? "http://localhost:3000";
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

// An invented person (no real data): a data scientist with a year of work, so intern roles still show.
const RESUME = [
  "Meera Iyer",
  "Data Scientist | Bengaluru, Karnataka, India | meera.iyer.ds@example.test | +91 90000 54321",
  "linkedin.com/in/meera-iyer-ds",
  "",
  "SUMMARY",
  "Data scientist with 1 year of experience building forecasting and classification models in Python and SQL.",
  "",
  "EXPERIENCE",
  "Data Scientist, Lumen Analytics, Bengaluru (Jul 2025 - Present)",
  "- Built demand forecasting models with pandas, scikit-learn and XGBoost; cut forecast error by 18%.",
  "- Wrote SQL pipelines on PostgreSQL and dashboards in Tableau for the operations team.",
  "- Ran A/B tests and statistical analysis for pricing experiments.",
  "",
  "EDUCATION",
  "B.Tech, Computer Science, PES University, 2025",
  "",
  "SKILLS",
  "Python, SQL, pandas, NumPy, scikit-learn, XGBoost, statistics, machine learning, A/B testing, Tableau, PostgreSQL",
];

async function main() {
  const stamp = Date.now();
  const user = await db.user.create({ data: { email: `prefs-${stamp}@swipeapply.local`, name: "Meera Iyer" } });
  const sessionToken = randomBytes(16).toString("hex");
  await db.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 1_800_000) } });
  const headers = { cookie: `authjs.session-token=${sessionToken}`, "Content-Type": "application/json" };
  try {
    const started = Date.now();
    const read = await ingestResume(user.id, pdf(RESUME));
    if (!read.ok) throw new Error(`resume not read: ${read.failure}`);
    await db.profile.update({ where: { userId: user.id }, data: { isTest: true } });
    const readMs = Date.now() - started;

    // What the confirm page sends: the profile as read, plus the fields and the two P4 settings.
    const stored = await (await fetch(`${BASE}/api/profile`, { headers })).json();
    const answersBefore = await db.answer.count({ where: { userId: user.id } });
    async function save(settings: { showNearby?: unknown; avoid?: unknown }) {
      const response = await fetch(`${BASE}/api/profile`, { method: "PUT", headers, body: JSON.stringify({ ...stored, yearsExperience: stored.yearsExperience == null ? null : String(stored.yearsExperience), tracks: ["data_science"], ...settings }) });
      if (!response.ok) throw new Error(`PUT /api/profile ${response.status}`);
    }
    type Shown = FeedJob & { track: string | null; roleFamily: string | null; kind: string | null; flags: string[]; readingCurrent: boolean };
    async function feed(): Promise<Shown[]> {
      // The ranked list, also when the daily set (P7, DAILY_SET=1) serves the default view.
      const response = await fetch(`${BASE}/api/jobs?rest=1`, { headers });
      if (!response.ok) throw new Error(`GET /api/jobs ${response.status}`);
      const jobs = ((await response.json()) as { jobs: FeedJob[] }).jobs;
      const rows = new Map((await db.job.findMany({ where: { id: { in: jobs.map((job) => job.id) } }, select: { id: true, title: true, track: true, roleFamily: true, kind: true, flags: true, readingCurrent: true } })).map((row) => [row.id, row]));
      return jobs.map((job) => ({ ...job, ...rows.get(job.id)! }));
    }
    const kindOf = (job: Shown) => (job.readingCurrent ? job.kind : null);

    await save({ showNearby: false, avoid: [] });
    const own = await feed();
    const firstFeedMs = Date.now() - started;
    console.log(`resume read in ${(readMs / 1000).toFixed(1)} s; resume → first feed ${(firstFeedMs / 1000).toFixed(1)} s, ${own.length} cards`);
    check("resume → feed under 3 minutes", firstFeedMs < 180_000, `${(firstFeedMs / 1000).toFixed(1)} s`);

    // Nearby: adjacent tracks the default feed does not show.
    const base = feedTracks(["data_science"])!;
    const adjacent: string[] = ADJACENT_TRACKS.data_science.filter((track) => !base.includes(track));
    const inAdjacent = (job: Shown) => adjacent.includes(titleTrack(job) ?? "");
    check("nearby off: no adjacent-track job in the feed", !own.some(inAdjacent), own.filter(inAdjacent).map((job) => job.title).join("; "));
    await save({ showNearby: true });
    const near = await feed();
    const added = near.filter(inAdjacent);
    check(`nearby on: an adjacent track's job shows (${adjacent.join(", ")})`, added.length > 0, `${added.length} cards, e.g. ${added.slice(0, 3).map((job) => `${job.title} [${titleTrack(job)}]`).join("; ")}; ${own.length} → ${near.length} cards`);

    // Each "Never show me" chip, on the nearby feed.
    for (const [chip, has] of [
      ["contract", (job: Shown) => kindOf(job) === "contract"],
      ["intern", (job: Shown) => kindOf(job) === "intern"],
      ["commission_only", (job: Shown) => job.readingCurrent && job.flags.includes("commission_only")],
    ] as const) {
      await save({ avoid: [chip] });
      const after = await feed();
      const before = near.filter(has).length;
      const left = after.filter(has);
      const gone = near.filter((job) => !after.some((other) => other.id === job.id));
      if (before === 0) {
        console.log(`note ${chip}: no job in this feed is ${chip} (nothing to remove); checked on the gate below`);
      } else {
        check(`avoid ${chip}: the feed had ${before} and has none`, left.length === 0, left.map((job) => job.title).join("; "));
        check(`avoid ${chip}: only ${chip} jobs left the feed`, gone.every(has), gone.filter((job) => !has(job)).map((job) => job.title).join("; "));
      }
    }
    // Commission-only: no tech job in the open pool carries the flag (19 Nov), so the gate is checked on a real flagged
    // job read as a tech family, as the feed applies it.
    const flagged = await db.job.findFirst({ where: { readingCurrent: true, flags: { has: "commission_only" } }, select: { source: true, title: true, track: true, kind: true, flags: true, readingCurrent: true } });
    if (flagged) {
      const asTech = { ...flagged, roleFamily: "data_science" };
      const verdict = jobGate(asTech, { tracks: null, avoid: ["commission_only"] }, { field: false });
      check("avoid commission_only: the gate removes a commission-only job", !verdict.pass && verdict.rule === "avoid_commission_only");
      check("avoid commission_only: kept without the chip", jobGate(asTech, { tracks: null, avoid: [] }, { field: false }).pass);
    }

    // Persisted, and only known values.
    await save({ showNearby: true, avoid: ["contract", "gig", "intern", 7] });
    const profile = await db.profile.findUnique({ where: { userId: user.id }, select: { showNearby: true, avoid: true } });
    check("settings persist on the profile", profile?.showNearby === true && profile.avoid.join() === "contract,intern", JSON.stringify(profile));
    await save({ showNearby: "yes" });
    const kept = await db.profile.findUnique({ where: { userId: user.id }, select: { showNearby: true } });
    check("a non-boolean showNearby is ignored", kept?.showNearby === true);

    const answersAfter = await db.answer.count({ where: { userId: user.id } });
    check("no Answer row written by the saves", answersAfter === answersBefore, `${answersBefore} before, ${answersAfter} after`);
  } finally {
    await db.session.deleteMany({ where: { sessionToken } }).catch(() => undefined);
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS feed prefs" : `FAIL feed prefs (${failed})`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.log("FAIL feed prefs");
  process.exitCode = 1;
});
