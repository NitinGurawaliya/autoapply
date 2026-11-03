// Guess and send (4 Nov, owner): a brand-new user's first 20 jobs should go out without stopping to ask. A throwaway
// user gets a generic software-engineer resume (read by the real resume reader) and the answers onboarding asks; then
// each of the first 20 jobs of their feed, every board included, has its live form read and resolved with the chain a
// real run uses. Nothing is filled or submitted. Prints what would have been asked before guessing, what is guessed
// (with why) and what is still asked. The user is deleted at the end.
// npx tsx scripts/fresh-user-smoke.ts [--jobs 20] [--per-board 5] (--per-board: that many recent software jobs in India from
// each board, Greenhouse, Ashby, Lever and Keka, instead of the feed, so every board's forms are checked; --only <words>:
// just the jobs of a company whose name has these words; GUESS_DEBUG=1 prints guesses that did not fit)
process.env.ENABLE_KEKA ??= "1";
process.env.ENABLE_LEVER ??= "1";

const STANDING = /^(accept_acknowledgements|citizenship|relocate_outside_home|sponsorship_outside_home)$/;

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

// A generic SDE resume: an invented person (no real data), two years at two companies, a B.Tech, common skills.
const RESUME = [
  "Arjun Verma",
  "Software Engineer | Bengaluru, Karnataka, India | arjun.verma.sde@example.test | +91 90000 12345",
  "linkedin.com/in/arjun-verma-sde | github.com/arjunverma-sde",
  "SUMMARY",
  "Backend-leaning software engineer with 2 years building APIs and data pipelines in Python, Java and Go.",
  "EXPERIENCE",
  "Software Engineer, Finlytics Technologies, Bengaluru - July 2024 to Present",
  "Built REST and gRPC services in Go and Python (FastAPI) serving 2M requests a day on AWS (EKS, RDS, S3, Lambda).",
  "Designed Kafka event pipelines and PostgreSQL schemas; added Redis caching that cut p95 latency by 40 percent.",
  "Set up CI/CD with GitHub Actions, Docker and Terraform; on-call for production incidents.",
  "Software Engineer Intern, CloudNest Labs, Pune - January 2024 to June 2024",
  "Wrote Java Spring Boot microservices and React dashboards; unit and integration tests with JUnit and Jest.",
  "EDUCATION",
  "B.Tech in Computer Science and Engineering, Vellore Institute of Technology, 2020 to 2024, CGPA 8.4",
  "SKILLS",
  "Python, Java, Go, JavaScript, TypeScript, SQL, FastAPI, Spring Boot, Node.js, React, PostgreSQL, MySQL, MongoDB, Redis,",
  "Kafka, Docker, Kubernetes, AWS, GCP, Terraform, Git, Linux, REST, gRPC, Microservices, Data Structures, System Design",
  "PROJECTS",
  "Distributed URL shortener in Go with consistent hashing; LLM-based support chatbot with LangChain and OpenAI.",
];

async function main() {
  const jobsWanted = Number(process.argv[process.argv.indexOf("--jobs") + 1]) || 20;
  const { db } = await import("../src/lib/db");
  const { deleteAccount } = await import("../src/modules/account");
  const { upsert } = await import("../src/modules/answers");
  const { openBrowser, pickAdapter } = await import("../src/modules/apply");
  const { resolveForm } = await import("../src/modules/apply/resolveForm");
  const { CITIZENSHIP_KEY, RELOCATE_ABROAD_KEY } = await import("../src/modules/apply/abroad");
  const { SPONSORSHIP_ABROAD_KEY } = await import("../src/modules/apply/sponsorship");
  const { listFeed, parseFeedFilters } = await import("../src/modules/jobs");
  const { ingestResume } = await import("../src/modules/profile");

  const stamp = Date.now();
  const user = await db.user.create({ data: { email: `fresh-${stamp}@swipeapply.local`, name: "Arjun Verma" } });
  let failed = 0;
  try {
    const read = await ingestResume(user.id, pdf(RESUME));
    if (!read.ok) throw new Error(`resume not read: ${read.failure}`);
    // Never a real run: a test profile is refused by the runner anywhere but the mock form.
    await db.profile.update({ where: { userId: user.id }, data: { isTest: true } });
    // What onboarding asks a new user (onboarding/questions).
    const onboarding: Array<[string, string, string]> = [
      ["current_ctc", "Current CTC", "8"],
      ["expected_ctc", "Expected CTC", "12"],
      ["notice_period", "Notice period", "30"],
      ["employment_type", "Employment type", "Full-time"],
      ["preferred_location", "Preferred location", "India"],
      [CITIZENSHIP_KEY, "Which country are you a citizen of?", "India"],
      [RELOCATE_ABROAD_KEY, "Are you open to moving out of India for a job?", "No, only jobs where I live"],
      [SPONSORSHIP_ABROAD_KEY, "Do you need visa sponsorship to work in any country other than India?", "Yes"],
    ];
    onboarding.push(["accept_acknowledgements", "May SwipeApply accept routine consents for you?", "Yes"]);
    for (const [key, question, answer] of onboarding) await upsert(user.id, { key, question, answer, source: "user" });
    const profile = (await db.profile.findUnique({ where: { userId: user.id } }))!;
    console.log(`fresh user: ${profile.currentTitle} at ${profile.currentCompany}, ${profile.yearsExperience} years, ${(profile.skills as unknown[]).length} skills read from the resume`);

    const perBoard = process.argv.includes("--per-board") ? Number(process.argv[process.argv.indexOf("--per-board") + 1]) || 5 : 0;
    // The first jobs of their feed, every board that applies included; or, with --per-board, recent software jobs per board.
    const feed = perBoard
      ? (
          await Promise.all(
            ["greenhouse", "ashby", "lever", "keka"].map((source) =>
              db.job.findMany({ where: { source, closedAt: null, country: "IN", title: { contains: "engineer", mode: "insensitive" } }, orderBy: { postedAt: "desc" }, distinct: ["companyId"], take: perBoard, select: { id: true, source: true } }),
            ),
          )
        ).flat()
      : await listFeed(user.id, parseFeedFilters({}));
    const boards = [...new Set(feed.map((job) => job.source))];
    let picked = perBoard ? feed : feed.slice(0, jobsWanted);
    // --only <words>: just the jobs whose company has these words (to look into one form).
    const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].toLowerCase() : null;
    if (only) {
      const named = await db.job.findMany({ where: { id: { in: picked.map((job) => job.id) } }, select: { id: true, company: { select: { name: true } } } });
      const keep = new Set(named.filter((job) => job.company.name.toLowerCase().includes(only)).map((job) => job.id));
      picked = picked.filter((job) => keep.has(job.id));
    }
    for (const board of perBoard ? [] : ["greenhouse", "ashby", "lever", "keka"]) {
      if (picked.some((job) => job.source === board)) continue;
      const first = feed.find((job) => job.source === board);
      if (first) picked = [...picked.slice(0, picked.length - 1), first];
    }
    console.log(`feed: ${feed.length} jobs on ${boards.join(", ")}; checking ${picked.length}: ${["greenhouse", "ashby", "lever", "keka"].map((b) => `${b} ${picked.filter((j) => j.source === b).length}`).join(", ")}\n`);

    const totals = { forms: 0, required: 0, before: 0, guessed: 0, after: 0, oneTime: new Set<string>(), unread: 0 };
    for (const [index, item] of picked.entries()) {
      const job = await db.job.findUnique({ where: { id: item.id }, include: { company: { select: { slug: true, name: true } } } });
      if (!job) continue;
      const head = `${String(index + 1).padStart(2)}. ${job.source.padEnd(10)} ${job.company.name.slice(0, 22).padEnd(22)} ${job.title.slice(0, 44)}`;
      const adapter = pickAdapter(job.applyUrl, job.source);
      const url = adapter.formUrl?.({ applyUrl: job.applyUrl, externalId: job.externalId, companySlug: job.company.slug }) ?? job.applyUrl;
      let session: Awaited<ReturnType<typeof openBrowser>> | null = null;
      try {
        session = await openBrowser(url, user.id);
        const fields = await adapter.inspect(session.page);
        const answers = await db.answer.findMany({ where: { userId: user.id } });
        const { resolved, missing } = await resolveForm({ userId: user.id, source: adapter.source, fields, profile, answers, job: { company: job.company.name, title: job.title, location: job.location, country: job.country, description: job.description }, draftEssays: true });
        const guessed = resolved.values.filter((value) => value.source === "guessed");
        const oneTime = missing.filter((question) => STANDING.test(question.key));
        const asked = missing.filter((question) => !STANDING.test(question.key));
        for (const question of oneTime) totals.oneTime.add(question.key);
        totals.forms += 1;
        totals.required += fields.filter((field) => field.required).length;
        totals.before += asked.length + guessed.length;
        totals.guessed += guessed.length;
        totals.after += asked.length;
        console.log(`${head}\n    ${fields.length} fields, ${fields.filter((f) => f.required).length} required | would have asked ${asked.length + guessed.length}, guessed ${guessed.length}, still asked ${asked.length}${oneTime.length ? ` (+ one-time: ${oneTime.map((q) => q.key).join(", ")})` : ""}`);
        for (const value of guessed) console.log(`      guess  ${value.label.replace(/\s+/g, " ").slice(0, 70)} = ${value.value.replace(/\s+/g, " ").slice(0, 50)}  [${(value.basis ?? "").replace(/^best guess: /, "").slice(0, 70)}]`);
        for (const question of asked) console.log(`      ASK    ${question.label.replace(/\s+/g, " ").slice(0, 90)} (${question.type}${question.options?.length ? `, ${question.options.length} options` : ""})`);
      } catch (error) {
        totals.unread += 1;
        console.log(`${head}\n    form not read: ${(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 140)}`);
      } finally {
        await session?.close().catch(() => undefined);
      }
    }
    console.log(`\n${totals.forms} forms read (${totals.unread} not read), ${totals.required} required fields`);
    console.log(`asked per application before guessing: ${totals.before} questions; guessed: ${totals.guessed}; still asked: ${totals.after}`);
    console.log(`one-time questions (asked once, then reused for every job): ${[...totals.oneTime].join(", ") || "none"}`);
    const stopped = totals.after;
    if (totals.forms < Math.min(10, picked.length) || stopped > 2) failed += 1;
    console.log(stopped > 2 ? `FAIL fresh-user (${stopped} questions still asked across ${totals.forms} forms)` : failed ? "FAIL fresh-user (too few forms read)" : `PASS fresh-user (${stopped} still asked across ${totals.forms} forms)`);
  } finally {
    await deleteAccount(user.id).catch(() => undefined);
    await db.$disconnect();
  }
  process.exit(failed ? 1 : 0);
}
main();
