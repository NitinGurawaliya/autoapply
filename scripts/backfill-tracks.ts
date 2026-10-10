// T81: function, track and seniority for every stored job (functions.ts classifyTitle), and suggested tracks for
// every profile that has none (tracksFromProfile). Re-run after a rule change: jobs are always re-classified,
// profiles only when empty unless --profiles is passed. npx tsx scripts/backfill-tracks.ts [--profiles]
import { db } from "../src/lib/db";
import { classifyTitle, tracksFromProfile } from "../src/modules/jobs/functions";

async function main() {
  const jobs = await db.job.findMany({ select: { id: true, title: true } });
  const groups = new Map<string, string[]>();
  for (const job of jobs) {
    const kind = classifyTitle(job.title);
    const key = JSON.stringify([kind.function, kind.track, kind.seniority]);
    groups.set(key, [...(groups.get(key) ?? []), job.id]);
  }
  for (const [key, ids] of groups) {
    const [fn, track, seniority] = JSON.parse(key) as [string, string | null, string | null];
    for (let i = 0; i < ids.length; i += 1000) await db.job.updateMany({ where: { id: { in: ids.slice(i, i + 1000) } }, data: { function: fn, track, seniority } });
  }
  const counts = await db.job.groupBy({ by: ["track"], where: { closedAt: null, eligibility: { in: ["india", "remote_india"] } }, _count: true });
  console.log(`jobs classified: ${jobs.length}; open India-eligible by track: ${JSON.stringify(Object.fromEntries(counts.map((c) => [c.track ?? "non_tech", c._count])))}`);

  const all = process.argv.includes("--profiles");
  const profiles = await db.profile.findMany({ select: { id: true, currentTitle: true, skills: true, experience: true, tracks: true } });
  let updated = 0;
  for (const profile of profiles) {
    if (!all && profile.tracks.length > 0) continue;
    const skills = Array.isArray(profile.skills) ? (profile.skills as unknown[]).filter((s): s is string => typeof s === "string") : [];
    const experienceTitles = Array.isArray(profile.experience) ? (profile.experience as Array<{ title?: unknown }>).map((r) => (typeof r?.title === "string" ? r.title : "")).filter(Boolean) : [];
    const tracks = tracksFromProfile({ currentTitle: profile.currentTitle, experienceTitles, skills });
    await db.profile.update({ where: { id: profile.id }, data: { tracks } });
    updated += 1;
    console.log(`profile ${profile.id.slice(-6)}: ${profile.currentTitle ?? "-"} → ${tracks.join(", ")}`);
  }
  console.log(`profiles given tracks: ${updated}`);
}
main().finally(() => db.$disconnect());
