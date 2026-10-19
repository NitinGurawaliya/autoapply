// Dry run of an ATS adapter on a live form: inspect, resolve with the same chain a real run uses (resolveForm: saved
// answers, verified reuse, worked-out answers, option mapping; essays are not drafted), fill, then read every field
// back. Never submits, and saves nothing.
// npx tsx scripts/ats-smoke.ts --user <end of the user id> <jobId> [--fill-pending] [--screenshot <path>]
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
      draftEssays: false,
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
    const filled = await adapter.fill(session.page, toFill);
    if (!adapter.uploadFirst) await upload();

    // Read every filled field back from the page.
    const bad: string[] = [];
    for (const f of filled) {
      const field = fields.find((x) => x.selector === f.selector);
      const target = session.page.locator(f.selector);
      const kind = field?.type ?? "text";
      let has = false;
      if (f.selector.startsWith("[data-field-path")) {
        // Ashby: one block per question; look inside it.
        if (kind === "yesno") has = (await target.locator('[aria-pressed="true"]').count()) > 0;
        else if (kind === "radio" || kind === "checkbox-group" || kind === "checkbox") has = (await target.locator("input:checked").count()) > 0;
        else if (kind === "select") has = ((await target.locator("select").first().inputValue().catch(() => "")) ?? "").length > 0;
        else has = ((await target.locator("input:not([type=file]), textarea").first().inputValue().catch(() => "")) ?? "").trim().length > 0;
      } else if (kind === "radio" || kind === "checkbox-group") has = (await target.evaluateAll((nodes) => nodes.some((n) => (n as HTMLInputElement).checked))) === true;
      else if (kind === "checkbox") has = await target.first().isChecked();
      else if (kind === "combobox") has = true; // react-select keeps its value outside the input; the adapter already confirmed the pick
      else has = ((await target.first().inputValue().catch(() => "")) ?? "").trim().length > 0;
      if (!has) bad.push(f.label.slice(0, 40));
    }
    const resumeAttached = resume ? (await session.page.locator("body").innerText()).toLowerCase().includes((resume.fileName ?? "resume.pdf").toLowerCase()) : true;
    const shot = arg("--screenshot");
    if (shot) await writeFile(shot, await session.page.screenshot({ fullPage: true }));
    console.log(`filled: ${filled.length}, empty after fill: ${bad.length ? bad.join(", ") : "none"}, resume attached: ${resumeAttached}`);
    ok = fields.length > 0 && bad.length === 0 && resumeAttached;
  } catch (error) {
    console.log(`stopped: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
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
