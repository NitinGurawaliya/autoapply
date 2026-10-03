// Dry run of the Greenhouse adapter on a live form: inspect → map → resolve → fill. Never clicks submit.
// npx tsx scripts/greenhouse-smoke.ts <jobId> [--fill-pending] [--screenshot <path>]
// --fill-pending puts placeholder answers into pending questions in the page only (nothing is saved or sent),
// so every field type gets exercised.
import { writeFile } from "node:fs/promises";
import { db } from "../src/lib/db";
import { storage } from "../src/lib/storage";
import { mapFields, openBrowser, pickAdapter, resolveValues } from "../src/modules/apply";
import type { ResolvedValue } from "../src/modules/apply";
import { uploadResume } from "../src/modules/apply/adapters/mock";

const IDENTITY = new Set(["first_name", "last_name", "full_name", "email", "phone", "linkedin", "github", "portfolio"]);

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const jobId = process.argv[2];
  const fillPending = process.argv.includes("--fill-pending");
  const shot = arg("--screenshot");
  const job = await db.job.findUnique({ where: { id: jobId }, include: { company: { select: { slug: true, name: true } } } });
  if (!job) throw new Error("job not found");
  const profile = await db.profile.findFirst({ where: { isTest: false }, orderBy: { updatedAt: "desc" } });
  if (!profile) throw new Error("no real profile");
  const answers = await db.answer.findMany({ where: { userId: profile.userId } });

  const adapter = pickAdapter(job.applyUrl, job.source);
  const url = adapter.formUrl?.({ applyUrl: job.applyUrl, externalId: job.externalId, companySlug: job.company.slug }) ?? job.applyUrl;
  console.log(`job: ${job.title} @ ${job.company.name}\nadapter: ${adapter.source}\nform: ${url}`);

  const session = await openBrowser(url);
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const fields = await adapter.inspect(session.page);
    const mapped = await mapFields(adapter.source, fields);
    const { values, pending } = resolveValues(mapped, profile, answers);
    console.log(`inspect: ${fields.length} fields (${fields.filter((f) => f.required).length} required)`);
    console.log(`resolve: ${values.length} values, ${pending.length} pending`);
    for (const value of values) {
      const shown = IDENTITY.has(value.key) ? "<hidden>" : value.value.slice(0, 40);
      console.log(`  fill  ${value.source.padEnd(8)} ${value.key.padEnd(18)} ${value.type.padEnd(9)} ${value.label.slice(0, 55)} = ${shown}`);
    }
    for (const question of pending) {
      console.log(`  ASK   ${question.key.padEnd(18)} ${question.type.padEnd(9)} ${question.label.slice(0, 70)}${question.options ? ` [${question.options.slice(0, 4).join(" / ")}${question.options.length > 4 ? " …" : ""}]` : ""}`);
    }

    const toFill: ResolvedValue[] = values.filter((value) => value.type !== "file");
    if (fillPending) {
      for (const question of pending) {
        const field = fields.find((f) => f.label === question.label)!;
        const placeholder = question.options?.[0] ?? (field.type === "combobox" ? "a" : "dry run");
        toFill.push({ key: question.key, label: question.label, value: placeholder, source: "user", selector: field.selector, type: field.type });
      }
    }
    const filled = await adapter.fill(session.page, toFill);
    const resume = values.find((value) => value.type === "file" && value.key === "resume");
    if (resume) {
      const stored = await storage.get(profile.resumeKey);
      if (!stored) throw new Error("resume missing from storage");
      cleanup = adapter.uploadFile
        ? await adapter.uploadFile(session.page, resume, stored.bytes)
        : await uploadResume(session.page, resume, stored.bytes);
    }

    const empty = await session.page.evaluate((selectors) =>
      selectors.filter((selector) => {
        const el = document.querySelector(selector) as HTMLInputElement | null;
        if (!el) return true;
        if (el.getAttribute("role") === "combobox") {
          const control = el.closest('[class*="control"]') ?? el.parentElement?.parentElement;
          return !(control?.textContent ?? "").trim();
        }
        if (el.type === "checkbox") return false;
        return !el.value.trim();
      }), filled.map((field) => field.selector));
    // Greenhouse swaps the file input for a chip showing the file name once a file is attached.
    const resumeAttached = resume
      ? await session.page.locator("body").innerText().then((text) => text.includes(resume.fileName ?? "resume.pdf"))
      : false;
    if (shot) await writeFile(shot, await session.page.screenshot({ fullPage: true }));

    console.log(`filled: ${filled.length}, empty after fill: ${empty.length ? empty.join(", ") : "none"}, resume attached: ${resumeAttached}`);
    const ok = fields.length > 0 && empty.length === 0 && (!resume || resumeAttached);
    console.log(ok ? "PASS greenhouse dry run (not submitted)" : "FAIL greenhouse dry run");
  } finally {
    await cleanup?.();
    await session.close();
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.log("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
});
