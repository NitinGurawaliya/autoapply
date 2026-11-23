// Phase U, U4: a Workday dry run on a real posting, in the stealthy Chrome, for one user. It signs in or creates the
// employer account (the real account step), reads and fills every page, and STOPS AT REVIEW: Submit is never pressed.
// Prints each page's fields, values and sources; nothing is written to an application. Needs ACCOUNTS_KEY in .env.
//   npx tsx scripts/workday-dry-run.ts --email <the user's email> --url <a Workday posting url>
import { db } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { openBrowser } from "../src/modules/apply/browser";
import { workdayAdapter } from "../src/modules/apply/adapters/workday";
import { resolveForm } from "../src/modules/apply/resolveForm";
import { AccountError, AccountVerificationError, type FormField } from "../src/modules/apply/adapter";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const email = arg("--email");
  const url = arg("--url");
  if (!email || !url || !workdayAdapter.matches(url)) throw new Error("usage: --email <email> --url <workday posting url>");
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error("no such user");
  const [profile, answers, job] = await Promise.all([
    db.profile.findUnique({ where: { userId: user.id } }),
    db.answer.findMany({ where: { userId: user.id } }),
    db.job.findFirst({ where: { applyUrl: url }, include: { company: { select: { name: true } } } }),
  ]);
  if (!profile) throw new Error("no profile");
  const company = job?.company.name ?? new URL(url).hostname.split(".")[0];
  const jobInfo = { company, title: job?.title ?? "", location: job?.location ?? "", country: job?.country ?? "IN", description: job?.description ?? "" };
  const formUrl = workdayAdapter.formUrl!({ applyUrl: url, externalId: "", companySlug: "" });
  console.log(`dry run: ${formUrl}`);
  const session = await openBrowser(formUrl, user.id, { window: true });
  const cleanups: Array<() => Promise<void>> = [];
  try {
    await workdayAdapter.prepare!(session.page, {
      userId: user.id,
      email: user.email,
      company,
      requestCode: async (prompt) => {
        console.log(`CODE ASKED: ${prompt} (the dry run does not answer codes)`);
        return null;
      },
      announceHandoff: async (message) => console.log(`HANDOFF: ${message}`),
      log: async (type, message) => console.log(`event ${type}: ${message}`),
    });
    let fields: FormField[] | null = await workdayAdapter.inspect(session.page);
    for (let page = 1; fields && page <= 10; page += 1) {
      console.log(`\n== page ${page}: ${fields.length} fields`);
      const { resolved } = await resolveForm({ userId: user.id, source: "workday", fields, profile, answers, job: jobInfo, draftEssays: true });
      for (const value of resolved.values) console.log(`  ${value.label.slice(0, 60)} = ${value.type === "file" ? "(file)" : value.value.slice(0, 60)} [${value.source}]`);
      for (const question of resolved.pending) console.log(`  PENDING: ${question.label.slice(0, 80)}`);
      if (resolved.pending.length > 0) {
        console.log("stopping: questions the user must answer");
        break;
      }
      const file = resolved.values.find((value) => value.type === "file");
      const resume = file && profile.resumeKey ? await storage.get(profile.resumeKey) : null;
      if (file && resume) cleanups.push(await workdayAdapter.uploadFile!(session.page, file, resume.bytes));
      await workdayAdapter.fill(session.page, resolved.values);
      fields = await workdayAdapter.nextStep!(session.page);
    }
    console.log(`\nREVIEW reached: ${/submit/i.test(await session.page.locator('[data-automation-id="pageFooterNextButton"]').first().innerText().catch(() => ""))}. Submit NOT pressed.`);
  } catch (error) {
    if (error instanceof AccountVerificationError) console.log(`VERIFY: ${error.message}`);
    else if (error instanceof AccountError) console.log(`ACCOUNT: ${error.message}`);
    else console.log(`STOPPED: ${error instanceof Error ? error.message : error}`);
  } finally {
    for (const cleanup of cleanups) await cleanup();
    if (!process.argv.includes("--keep-open")) await session.close();
    await db.$disconnect();
  }
}
main();
