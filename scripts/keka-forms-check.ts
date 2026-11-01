// Offline check of Keka forms for one person: each form's own description (public JSON) → the adapter's fields
// (fieldsFromSchema) → the same answer chain a real run uses (resolveForm; essays not drafted). No browser, nothing
// filled, nothing saved. Prints each form as GO (would go through without asking), ASK (the questions it would ask)
// or STOP (the adapter refuses it), then the totals.
//   npx tsx scripts/keka-forms-check.ts --user <end of the user id> [--limit 40] [--applied]
// --applied: the Keka jobs this person already applied to; otherwise the newest open job of each Keka company.
import { db } from "../src/lib/db";
import { fieldsFromSchema, type SchemaField } from "../src/modules/apply/adapters/keka";
import { resolveForm } from "../src/modules/apply/resolveForm";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

async function schemaOf(slug: string, id: string): Promise<SchemaField[] | null> {
  const body = await fetch(`https://${slug}.keka.com/careers/${id}/2/applicationform`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (!Array.isArray(body)) return null;
  return (body as Array<Record<string, unknown>>).map((field) => ({
    identifier: String(field.identifier ?? ""),
    fieldName: String(field.fieldName ?? field.identifier ?? ""),
    fieldType: Number(field.fieldType ?? 1),
    required: field.required === true || field.requirementType === 1,
    fieldOptions: Array.isArray(field.fieldOptions) ? (field.fieldOptions as Array<{ value?: unknown }>).map((option) => ({ value: String(option.value ?? "") })).filter((option) => option.value) : [],
  }));
}

async function main() {
  const suffix = arg("--user");
  if (!suffix) throw new Error("pass --user <end of the user id>");
  const limit = Number(arg("--limit")) || 40;
  const profiles = await db.profile.findMany({ where: { isTest: false, userId: { endsWith: suffix } } });
  if (profiles.length !== 1) throw new Error(`--user ${suffix} matched ${profiles.length} profiles`);
  const profile = profiles[0];
  const answers = await db.answer.findMany({ where: { userId: profile.userId } });

  const jobs = process.argv.includes("--applied")
    ? await db.job.findMany({ where: { source: "keka", id: { in: (await db.application.findMany({ where: { userId: profile.userId }, select: { jobId: true } })).map((a) => a.jobId) } }, include: { company: { select: { name: true } } }, take: limit })
    : await db.job.findMany({ where: { source: "keka", closedAt: null }, distinct: ["companyId"], orderBy: { postedAt: "desc" }, include: { company: { select: { name: true } } }, take: limit });

  const totals = { go: 0, ask: 0, stop: 0, gone: 0 };
  const asked: Record<string, number> = {};
  for (const job of jobs) {
    const [slug, id] = job.externalId.split(":");
    const schema = await schemaOf(slug, id);
    const name = `${job.company.name.slice(0, 22)} | ${job.title.slice(0, 34)}`;
    if (!schema) {
      totals.gone += 1;
      console.log(`GONE  ${name}`);
      continue;
    }
    try {
      const fields = fieldsFromSchema(schema, null, slug);
      const { missing } = await resolveForm({
        userId: profile.userId,
        source: "keka",
        fields,
        profile,
        answers,
        job: { company: job.company.name, title: job.title, location: job.location, country: job.country, description: job.description },
        draftEssays: false,
      });
      if (missing.length === 0) {
        totals.go += 1;
        console.log(`GO    ${name}`);
      } else {
        totals.ask += 1;
        for (const q of missing) asked[q.label.replace(/\s+/g, " ").slice(0, 70)] = (asked[q.label.replace(/\s+/g, " ").slice(0, 70)] ?? 0) + 1;
        console.log(`ASK   ${name} | ${missing.map((q) => q.label.replace(/\s+/g, " ").slice(0, 50)).join(" ; ")}`);
      }
    } catch (error) {
      totals.stop += 1;
      console.log(`STOP  ${name} | ${error instanceof Error ? error.message.slice(0, 110) : "error"}`);
    }
  }
  console.log(`TOTAL ${JSON.stringify(totals)} of ${jobs.length}`);
  for (const [label, count] of Object.entries(asked).sort((a, b) => b[1] - a[1])) console.log(`ASKED ${String(count).padStart(3)} ${label}`);
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "check failed");
  await db.$disconnect();
  process.exit(1);
});
