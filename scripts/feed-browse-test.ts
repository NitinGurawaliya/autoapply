// All jobs (Phase X, X3, docs/feed/TDD.md 4.3): the filters round-trip through the address, and browseJobs on a real
// profile lists past today's 5-card floor, widens when asked with every job outside the profile labelled and its reason
// given, finds typed roles, and brings skipped jobs back. Reads jobs and the person's swipes; writes only the model's
// cached verdicts, as the feed does. Prints counts, never the person's data.
// npx tsx scripts/feed-browse-test.ts --email <email of a user with a profile>
import { db } from "../src/lib/db";
import { browseHref, DEFAULT_BROWSE, parseBrowseFilters, type BrowseFilters } from "../src/lib/browse-url";
import { BROWSE_PAGE, browseJobs, TRACKS, tracksOf } from "../src/modules/jobs";
import { feedTracks } from "../src/modules/jobs";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

const queryOf = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);

async function main() {
  // 1. The address: defaults stay out of it, and every filter comes back as it went in.
  ok("the default All jobs address is just the mode", browseHref(DEFAULT_BROWSE) === "/feed?mode=all", browseHref(DEFAULT_BROWSE));
  const wide: BrowseFilters = { q: "react native", exp: 5, field: "data_science", countries: ["IN", "US"], stages: ["startup"], days: 7, pay: true, skipped: true, sort: "new" };
  const back = parseBrowseFilters(queryOf(browseHref(wide, 3)), TRACKS);
  ok("every filter round-trips through the address", JSON.stringify(back) === JSON.stringify(wide), browseHref(wide, 3));
  const junk = parseBrowseFilters({ exp: "7", field: "astrology", place: "MARS", days: "9", sort: "x" }, TRACKS);
  ok("unknown values fall back to the defaults", JSON.stringify(junk) === JSON.stringify(DEFAULT_BROWSE));

  const email = arg("--email");
  if (!email) throw new Error("usage: --email <email of a user with a profile>");
  const user = await db.user.findUnique({ where: { email }, select: { id: true, profile: true } });
  if (!user?.profile) throw new Error("no such user, or no profile");
  const userId = user.id;
  const own = feedTracks(tracksOf(user.profile), user.profile.showNearby === true) ?? [];

  // 2. Inside the profile: more than today's 5, a page at a time.
  const inside = await browseJobs(userId, DEFAULT_BROWSE, 1);
  ok("inside the profile it lists past today's 5-card floor", inside.total > 5, `${inside.total} jobs, ${inside.jobs.filter((job) => job.fit.matches).length} of the first ${inside.jobs.length} match`);
  ok("a page holds at most 25 and the pages add up", inside.jobs.length <= BROWSE_PAGE && inside.pages === Math.max(1, Math.ceil(inside.total / BROWSE_PAGE)));
  ok("best match puts the matching jobs first on the page", inside.jobs.findIndex((job) => !job.fit.matches) === -1 || inside.jobs.slice(inside.jobs.findIndex((job) => !job.fit.matches)).every((job) => !job.fit.matches));
  ok("every job that doesn't match says why", inside.jobs.every((job) => job.fit.matches || job.fit.reasons.length > 0));
  if (inside.pages > 1) {
    const second = await browseJobs(userId, DEFAULT_BROWSE, 2);
    const firstIds = new Set(inside.jobs.map((job) => job.id));
    ok("page 2 holds other jobs", second.jobs.length > 0 && second.jobs.every((job) => !firstIds.has(job.id)));
  }

  // 3. Widened: more jobs, and the ones outside the profile are labelled, with the reason, so they get no Apply.
  const every = await browseJobs(userId, { ...DEFAULT_BROWSE, field: "all", exp: "any" }, 1);
  ok("every field and any years brings more jobs in", every.total > inside.total, `${inside.total} → ${every.total}`);
  ok("widened, every job that doesn't match says why", every.jobs.every((job) => job.fit.matches || job.fit.reasons.length > 0));
  const other = TRACKS.find((track) => !own.includes(track) && track !== "software");
  if (other) {
    const field = await browseJobs(userId, { ...DEFAULT_BROWSE, field: other, exp: "any" }, 1);
    ok(
      `a field outside the profile (${other}): none match, each says the field`,
      field.jobs.every((job) => !job.fit.matches && job.fit.hard && job.fit.reasons.some((reason) => reason.endsWith("not one of your fields"))),
      `${field.total} jobs`,
    );
  }
  const years = await browseJobs(userId, { ...DEFAULT_BROWSE, exp: 10, sort: "new" }, 1);
  const tooSenior = years.jobs.filter((job) => job.fit.reasons.some((reason) => /^Asks \d+\+ years|role: you have/.test(reason)));
  ok("up to 10 years: the jobs above their years are labelled with the years or level", tooSenior.every((job) => !job.fit.matches), `${tooSenior.length} of ${years.jobs.length} above their years`);

  // 4. A typed role: every job has it in the title or among its words.
  const typed = await browseJobs(userId, { ...DEFAULT_BROWSE, q: "react", field: "all", exp: "any" }, 1);
  const ids = typed.jobs.map((job) => job.id);
  const hits = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Job" WHERE id = ANY(${ids}::text[]) AND (lower(title) LIKE '%react%' OR terms @> ARRAY['react']::text[])`;
  ok("a typed role finds only jobs that name it", typed.total > 0 && hits.length === ids.length, `${typed.total} jobs`);

  // 5. Newest first, and skipped jobs back on request.
  ok("newest first is in posted order", years.jobs.every((job, index) => index === 0 || job.daysAgo >= years.jobs[index - 1].daysAgo));
  const left = await db.swipe.count({ where: { userId, direction: "left" } });
  const skipped = await browseJobs(userId, { ...DEFAULT_BROWSE, skipped: true }, 1);
  ok("include skipped never lists fewer jobs", skipped.total >= inside.total, `${inside.total} → ${skipped.total} (${left} skipped overall)`);

  console.log(failed === 0 ? "PASS feed-browse-test" : `FAIL feed-browse-test (${failed})`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    failed += 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failed === 0 ? 0 : 1);
  });
