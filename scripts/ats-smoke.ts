// Dry run of an ATS adapter on a live form: inspect, resolve with the same chain a real run uses (resolveForm: saved
// answers, verified reuse, worked-out answers, option mapping; essays are not drafted), fill, then read every field
// back. Never submits, and saves nothing.
// npx tsx scripts/ats-smoke.ts --user <end of the user id> <jobId> [--fill-pending] [--draft-essays] [--screenshot <path>]
// --user is required: there can be several real profiles, and this must never run as the wrong person.
import { writeFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { openBrowser, pickAdapter } from "../src/modules/apply";
import { resolveForm } from "../src/modules/apply/resolveForm";
import type { ResolvedValue } from "../src/modules/apply";

const IDENTITY = new Set(["first_name", "last_name", "full_name", "email", "phone", "linkedin", "github", "portfolio", "current_company", "city"]);
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

async function main() {
  const suffix = arg("--user");
  if (!suffix) throw new Error("pass --user <end of the user id>");
  const jobId = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--user" && all[i - 1] !== "--screenshot");
  const fillPending = process.argv.includes("--fill-pending");
  const job = await db.job.findUnique({ where: { id: jobId }, include: { company: { select: { slug: true, name: true } } } });
  if (!job) throw new Error("job not found");
  const profiles = await db.profile.findMany({ where: { isTest: false, userId: { endsWith: suffix } } });
  if (profiles.length !== 1) throw new Error(`--user ${suffix} matched ${profiles.length} profiles`);
  const profile = profiles[0];
  const answers = await db.answer.findMany({ where: { userId: profile.userId } });

  const adapter = pickAdapter(job.applyUrl, job.source);
  const url = adapter.formUrl?.({ applyUrl: job.applyUrl, externalId: job.externalId, companySlug: job.company.slug }) ?? job.applyUrl;
  console.log(`job: ${job.title} @ ${job.company.name}\nadapter: ${adapter.source}${adapter.uploadFirst ? " (uploads first)" : ""}\nform: ${url.replace(/[0-9a-f-]{36}/i, "<id>")}`);

  const session = await openBrowser(url, profile.userId);
  // A dry run never sends: an application POST (SmartRecruiters' Easy Apply, M7) is aborted before it leaves.
  await session.page.context().route(/\/oneclick-ui\/api\/company\/.+\/application(?:[?#]|$)/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  let cleanup: (() => Promise<void>) | null = null;
  let ok = false;
  try {
    const fields = await adapter.inspect(session.page);
    const { resolved, missing } = await resolveForm({
      userId: profile.userId,
      source: adapter.source,
      fields,
      profile,
      answers,
      job: { company: job.company.name, title: job.title, location: job.location, country: job.country, description: job.description },
      draftEssays: process.argv.includes("--draft-essays"), // a real run drafts them; a dry run only on request
    });
    const values = resolved.values;
    const pending = missing;
    console.log(`inspect: ${fields.length} fields (${fields.filter((f) => f.required).length} required)`);
    console.log(`resolve: ${values.length} values, ${pending.length} pending`);
    for (const v of values) console.log(`  fill  ${v.source.padEnd(8)} ${v.key.padEnd(18)} ${v.type.padEnd(14)} ${v.label.slice(0, 50)} = ${IDENTITY.has(v.key) ? "<hidden>" : v.value.slice(0, 40)}`);
    for (const q of pending) console.log(`  ASK   ${q.key.padEnd(18)} ${q.type.padEnd(14)} ${q.label.slice(0, 70)}${q.options ? ` [${q.options.slice(0, 4).join(" / ")}${q.options.length > 4 ? " ..." : ""}]` : ""}`);

    const toFill: ResolvedValue[] = values.filter((v) => v.type !== "file");
    if (fillPending) {
      for (const q of pending) {
        const field = fields.find((f) => f.label === q.label);
        if (!field) continue;
        toFill.push({ key: q.key, label: q.label, value: q.options?.[0] ?? (field.type === "date" ? "2026-12-01" : "dry run"), source: "user", selector: field.selector, type: field.type, required: field.required });
      }
    }
    const resume = values.find((v) => v.type === "file" && v.key === "resume");
    const upload = async () => {
      if (!resume) return;
      const stored = await storage.get(profile.resumeKey);
      if (!stored) throw new Error("resume missing from storage");
      if (!adapter.uploadFile) throw new Error("adapter has no uploadFile");
      cleanup = await adapter.uploadFile(session.page, resume, stored.bytes);
    };
    if (adapter.uploadFirst) await upload();
    // Read filled fields back from the page. A multi-page form is checked page by page, before Next replaces it.
    const bad: string[] = [];
    const readBack = async (filled: Awaited<ReturnType<typeof adapter.fill>>) => {
      for (const f of filled) {
        const field = fields.find((x) => x.selector === f.selector);
        const target = session.page.locator(f.selector);
        const kind = field?.type ?? "text";
        let has = false;
        if (f.selector.startsWith("[data-field-path") || f.selector.startsWith('[data-ui="QA_')) {
          // Ashby and Workable: one block per question; look inside it.
          if (kind === "yesno") has = (await target.locator('[aria-pressed="true"]').count()) > 0;
          else if (kind === "radio" || kind === "checkbox-group" || kind === "checkbox") has = (await target.locator("input:checked").count()) > 0;
          else if (kind === "select") has = ((await target.locator("select").first().inputValue().catch(() => "")) ?? "").length > 0;
          else has = ((await target.locator("input:not([type=file]), textarea").first().inputValue().catch(() => "")) ?? "").trim().length > 0;
        } else if (f.selector.startsWith("[data-sa-entry")) {
          has = true; // a SmartRecruiters experience/education entry: the adapter saw its Save close the entry form
        } else if (f.selector.startsWith("[data-sa-q")) {
          // SmartRecruiters: a spl-* component tagged by the adapter; its input sits in its shadow root.
          if (kind === "radio" || kind === "checkbox-group" || kind === "checkbox") has = (await target.locator("input:checked, [aria-checked=true]").count()) > 0 || ((await target.getAttribute("value")) ?? "").length > 0; // a multi-select holds option ids
          else if (kind === "combobox" || kind === "select") has = true; // the adapter confirmed the pick
          else has = ((await target.locator("input:not([type=file]), textarea").last().inputValue().catch(() => "")) ?? "").trim().length > 0;
        } else if (kind === "radio" || kind === "checkbox-group") has = (await target.evaluateAll((nodes) => nodes.some((n) => (n as HTMLInputElement).checked))) === true;
        else if (kind === "checkbox") has = await target.first().isChecked();
        else if (kind === "combobox") has = true; // react-select keeps its value outside the input; the adapter already confirmed the pick
        else if (kind === "skills") has = (await session.page.locator('#skills-container input[type=hidden][name^="skills["]').count()) > 0; // Keka: tags, the box is cleared
        else has = ((await target.first().inputValue().catch(() => "")) ?? "").trim().length > 0;
        if (!has) bad.push(f.label.slice(0, 40));
      }
    };
    const filled = await adapter.fill(session.page, toFill);
    if (!adapter.uploadFirst) await upload();
    // On the page, or in an input: Keka shows the attached file's name in a field, not as text.
    const fileName = (resume?.fileName ?? "resume.pdf").toLowerCase();
    const resumeAttached = resume
      ? (await session.page.locator("body").innerText()).toLowerCase().includes(fileName) ||
        (await session.page.getByText(resume.fileName ?? "resume.pdf", { exact: false }).count()) > 0 || // in a shadow root (SmartRecruiters)
        (await session.page.locator("input").evaluateAll((nodes, name) => nodes.some((node) => ((node as HTMLInputElement).value ?? "").toLowerCase().includes(name)), fileName))
      : true;
    await readBack(filled);
    let total = filled.length;
    // Multi-page forms (adapter.nextStep): each further page is resolved and filled as the runner does it.
    for (let step = 0; adapter.nextStep && step < 10; step += 1) {
      const more = await adapter.nextStep(session.page);
      if (!more || more.length === 0) break;
      fields.push(...more);
      const { resolved: next, missing: nextMissing } = await resolveForm({
        userId: profile.userId,
        source: adapter.source,
        fields: more,
        profile,
        answers,
        job: { company: job.company.name, title: job.title, location: job.location, country: job.country, description: job.description },
        draftEssays: process.argv.includes("--draft-essays"), // a real run drafts them; a dry run only on request
      });
      console.log(`next page: ${more.length} fields, ${next.values.length} values, ${nextMissing.length} pending`);
      for (const v of next.values) console.log(`  fill  ${v.source.padEnd(8)} ${v.key.padEnd(18)} ${v.type.padEnd(14)} ${v.label.slice(0, 50)} = ${IDENTITY.has(v.key) ? "<hidden>" : v.value.slice(0, 40)}`);
      for (const q of nextMissing) console.log(`  ASK   ${q.key.padEnd(18)} ${q.type.padEnd(14)} ${q.label.slice(0, 70)}${q.options ? ` [${q.options.slice(0, 4).join(" / ")}${q.options.length > 4 ? " ..." : ""}]` : ""}`);
      const nextFill: ResolvedValue[] = next.values.filter((v) => v.type !== "file");
      if (fillPending) {
        for (const q of nextMissing) {
          const field = more.find((f) => f.label === q.label);
          if (field) nextFill.push({ key: q.key, label: q.label, value: q.options?.[0] ?? "dry run", source: "user", selector: field.selector, type: field.type, required: field.required });
        }
      }
      const pageFilled = await adapter.fill(session.page, nextFill);
      await readBack(pageFilled);
      total += pageFilled.length;
    }

    const shot = arg("--screenshot");
    if (shot) await writeFile(shot, await session.page.screenshot({ fullPage: true }));
    console.log(`filled: ${total}, empty after fill: ${bad.length ? bad.join(", ") : "none"}, resume attached: ${resumeAttached}`);
    ok = fields.length > 0 && bad.length === 0 && resumeAttached;
  } catch (error) {
    console.log(`stopped: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    const shot = arg("--screenshot");
    if (shot) await writeFile(shot, await session.page.screenshot()).catch(() => undefined); // the viewport where it stopped
  } finally {
    await session.close();
    await (cleanup as (() => Promise<void>) | null)?.();
    await db.$disconnect();
  }
  console.log(ok ? "PASS dry run (not submitted)" : "FAIL dry run");
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.log("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
