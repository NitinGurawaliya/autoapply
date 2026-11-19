// Phase P, P5: the candidate brief (modules/profile/brief.ts). Pure part: no contact data reaches the brief (a title
// that is an email or a phone is dropped; skills are vocabulary terms only); fitHash changes with FIT_VERSION and with
// the JSON, never with learned lines; a brief read back from jsonb serialises to the same JSON. DB part, on a throwaway
// test user: a build and a rebuild leave Profile.updatedAt unchanged; a rebuild with nothing changed writes nothing;
// learned lines survive rebuilds and never move fitHash; a changed profile moves it. With a base URL, GET /api/brief on
// the dev server returns the brief. The user is deleted at the end.
// npx tsx scripts/brief-test.ts [baseUrl]
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { deleteAccount } from "../src/modules/account";
import { TECH_VOCAB } from "../src/modules/jobs";
import { briefJson, briefOf, buildBrief, currentBrief, FIT_VERSION, fitHashOf } from "../src/modules/profile";
import { briefSchema } from "../src/modules/profile/brief";

const BASE = process.argv[2];
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// Invented contact details, planted everywhere a careless brief could pick them up.
const NAME = "Tara Quill";
const EMAIL = "tara.quill.brieftest@example.com";
const PHONE = "+91 98765 43210";
const LINKS = ["https://linkedin.com/in/taraquill-brieftest", "https://github.com/taraquill-brieftest"];
const RESUME = [NAME, EMAIL, PHONE, ...LINKS, "Backend engineer, 4 years. Built services in Go and PostgreSQL on AWS with Kafka and Docker."].join("\n");
const CONTACT = [NAME, "Tara", "Quill", EMAIL, "example.com", "98765", "43210", "linkedin", "github.com", "taraquill"];
const VOCAB = new Set(TECH_VOCAB.map((term) => term.name));

const base = {
  tracks: ["backend"],
  showNearby: false,
  yearsExperience: 4,
  currentTitle: "Backend Engineer",
  skills: ["Go", "PostgreSQL", "Kubernetes", EMAIL, PHONE, LINKS[0]],
  experience: [{ title: "Backend Engineer", company: "Acme", summary: `Reach me at ${EMAIL}` }],
  resumeText: RESUME,
};

function noContact(json: string) {
  const lower = json.toLowerCase();
  return CONTACT.filter((needle) => lower.includes(needle.toLowerCase()));
}

async function pure() {
  const brief = briefOf(base);
  const json = briefJson(brief);
  check("brief has the six parts", JSON.stringify(Object.keys(JSON.parse(json))) === JSON.stringify(["tracks", "nearby", "years", "title", "skills", "roles"]), json);
  // P6 option A: the roles the profile lists, what they did, never contact data or the company.
  const planted = briefOf({ ...base, fullName: NAME, experience: [{ title: "Backend Engineer", company: "Acme Secret Co", summary: `${NAME} built Go services; call ${PHONE} or mail ${EMAIL}, see ${LINKS[1]}` }] } as typeof base);
  check("roles say what they did", planted.roles.length === 1 && planted.roles[0].title === "Backend Engineer" && planted.roles[0].did.includes("built Go services"), JSON.stringify(planted.roles));
  check("no contact data, name or company in the roles", noContact(JSON.stringify(planted.roles)).length === 0 && !JSON.stringify(planted.roles).includes("Acme"), JSON.stringify(planted.roles));
  check("fitHash changes with the roles", fitHashOf(briefOf({ ...base, experience: [{ title: "Backend Engineer", summary: "Built Rust services" }] })) !== fitHashOf(brief));
  check("no contact data in the brief", noContact(json).length === 0, noContact(json).join(", "));
  check("skills are vocabulary terms only", brief.skills.every((skill) => VOCAB.has(skill)), brief.skills.join(", "));
  check("a link in the resume is not read as a skill", !brief.skills.includes("GitHub"), brief.skills.join(", "));
  check("the user's listed skills come first", brief.skills.slice(0, 3).join(",") === "Go,PostgreSQL,Kubernetes", brief.skills.join(", "));
  for (const title of [`Engineer ${EMAIL}`, `Call ${PHONE}`, "linkedin.com/in/someone", "www.example.org"]) {
    check(`a contact-like title is dropped: "${title.slice(0, 24)}"`, briefOf({ ...base, currentTitle: title }).title === null);
  }
  const dotted = briefOf({ ...base, skills: ["ASP.NET", "Node.js"], resumeText: "Built APIs in ASP.NET and Node.js." }).skills;
  check("dotted skill names are not taken for links", ["ASP.NET", "Node.js"].every((skill) => VOCAB.has(skill) ? dotted.includes(skill) : true), dotted.join(", "));
  check("an ordinary title stays", briefOf({ ...base, currentTitle: "  Senior   Backend Engineer " }).title === "Senior Backend Engineer");

  const hash = fitHashOf(brief);
  check("fitHash is stable", hash === fitHashOf(briefOf(base)) && /^[0-9a-f]{32}$/.test(hash));
  check("fitHash changes with FIT_VERSION", fitHashOf(brief, `${FIT_VERSION}-next`) !== hash);
  check("fitHash changes with the skills", fitHashOf(briefOf({ ...base, skills: ["Go", "Rust"] })) !== hash);
  check("fitHash changes with nearby", fitHashOf(briefOf({ ...base, showNearby: true })) !== hash);
  check("fitHash changes with the years", fitHashOf(briefOf({ ...base, yearsExperience: 5 })) !== hash);
  check("fitHash changes with the tracks", fitHashOf(briefOf({ ...base, tracks: ["backend", "devops"] })) !== hash);
  // Contact fields are not inputs at all: changing them leaves the hash alone.
  check("fitHash ignores contact-only changes", fitHashOf(briefOf({ ...base, resumeText: RESUME.replace(EMAIL, "other@example.com") })) === hash);
  // jsonb reorders keys: the JSON must not depend on the order an object was built in.
  const shuffled = { roles: brief.roles.map((role) => ({ did: role.did, title: role.title })), skills: brief.skills, title: brief.title, years: brief.years, nearby: brief.nearby, tracks: brief.tracks };
  check("briefJson is independent of key order", briefJson(shuffled) === json);
}

async function withDb() {
  const stamp = randomBytes(4).toString("hex");
  const user = await db.user.create({ data: { email: `brief-${stamp}@swipeapply.local`, name: "Brief Test" } });
  let sessionToken = "";
  try {
    await db.profile.create({
      data: {
        userId: user.id,
        isTest: true,
        resumeKey: "",
        resumeText: RESUME,
        fullName: NAME,
        email: EMAIL,
        phone: PHONE,
        linkedin: LINKS[0],
        github: LINKS[1],
        yearsExperience: base.yearsExperience,
        currentTitle: base.currentTitle,
        tracks: base.tracks,
        skills: base.skills,
        experience: base.experience,
        education: [],
        rawJson: {},
      },
    });
    const updatedAt = async () => (await db.profile.findUniqueOrThrow({ where: { userId: user.id }, select: { updatedAt: true } })).updatedAt.toISOString();

    const before = await updatedAt();
    const first = await buildBrief(user.id);
    const afterFirst = await updatedAt();
    console.log(`     Profile.updatedAt before ${before}, after a build ${afterFirst}`);
    check("a build leaves Profile.updatedAt unchanged", before === afterFirst);
    check("the first build writes", first?.changed === true);
    const row = await db.candidateBrief.findUniqueOrThrow({ where: { userId: user.id } });
    const stored = briefSchema.parse(row.brief);
    check("the stored brief reads back to the same JSON", briefJson(stored) === briefJson(first!.brief));
    check("the stored fitHash matches the stored brief", fitHashOf(stored) === row.fitHash && row.fitHash === first!.fitHash);
    check("no contact data in the stored row", noContact(JSON.stringify(row.brief)).length === 0);
    check("learned starts empty", Array.isArray(row.learned) && row.learned.length === 0);

    const again = await buildBrief(user.id);
    const afterSecond = await updatedAt();
    const row2 = await db.candidateBrief.findUniqueOrThrow({ where: { userId: user.id } });
    console.log(`     Profile.updatedAt after a rebuild ${afterSecond}`);
    check("a rebuild leaves Profile.updatedAt unchanged", afterSecond === before);
    check("a rebuild with nothing changed writes nothing", again?.changed === false && row2.updatedAt.getTime() === row.updatedAt.getTime());

    const line = { id: "l1", family: "qa", note: "You skip most QA / Test roles", at: new Date().toISOString(), dismissedAt: null };
    await db.candidateBrief.update({ where: { userId: user.id }, data: { learned: [line] } });
    await buildBrief(user.id);
    const row3 = await db.candidateBrief.findUniqueOrThrow({ where: { userId: user.id } });
    check("a learned line does not move fitHash", row3.fitHash === row.fitHash);
    const shown = await currentBrief(user.id);
    check("the learned line is shown with the brief", shown?.learned.length === 1 && shown.learned[0].id === "l1");

    await db.profile.update({ where: { userId: user.id }, data: { skills: ["Go", "Rust"] } });
    const changed = await buildBrief(user.id);
    const row4 = await db.candidateBrief.findUniqueOrThrow({ where: { userId: user.id } });
    check("a changed profile moves fitHash", changed?.changed === true && row4.fitHash !== row.fitHash);
    const kept = Array.isArray(row4.learned) ? (row4.learned as Array<{ id?: string; note?: string }>) : [];
    check("a rebuild keeps the learned lines", kept.length === 1 && kept[0].id === line.id && kept[0].note === line.note);

    const racing = await Promise.allSettled([buildBrief(user.id), buildBrief(user.id), buildBrief(user.id)]);
    check("parallel builds never fail", racing.every((result) => result.status === "fulfilled"));

    if (BASE) {
      sessionToken = randomBytes(24).toString("hex");
      await db.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 3600_000) } });
      const response = await fetch(`${BASE}/api/brief`, { headers: { cookie: `authjs.session-token=${sessionToken}` } });
      const body = (await response.json().catch(() => null)) as { brief?: unknown; learned?: unknown[] } | null;
      const parsed = briefSchema.safeParse(body?.brief);
      check("GET /api/brief returns the brief", response.status === 200 && parsed.success && parsed.data.skills.join(",") === changed!.brief.skills.join(","), `status ${response.status}`);
      check("GET /api/brief carries no contact data", noContact(JSON.stringify(body)).length === 0);
      const anonymous = await fetch(`${BASE}/api/brief`, { redirect: "manual" });
      check("GET /api/brief needs a session", anonymous.status === 401 || (anonymous.status >= 300 && anonymous.status < 400), `status ${anonymous.status}`);
    }
  } finally {
    if (sessionToken) await db.session.deleteMany({ where: { sessionToken } }).catch(() => undefined);
    await deleteAccount(user.id).catch(() => undefined);
    const left = await db.candidateBrief.count({ where: { userId: user.id } });
    check("the test user and its brief are gone", left === 0 && (await db.user.count({ where: { id: user.id } })) === 0);
  }
}

pure()
  .then(withDb)
  .then(() => {
    console.log(failed === 0 ? "PASS brief" : `FAIL brief (${failed})`);
    process.exitCode = failed === 0 ? 0 : 1;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message.slice(0, 200) : error);
    console.log("FAIL brief");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
