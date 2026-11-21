// Ad hoc (21 Nov, M13b): the CAPTCHA step on many live Zoho Recruit forms, in the stealthy Chrome, NEVER submitted.
// One open job per portal: the form read (inspect), every non-file field filled with obvious test values, then the
// adapter's own CAPTCHA step (typeZohoCaptcha: capture, read, refresh, type) and the box read back. No file is uploaded
// (an upload reaches the company's server) and Submit is never pressed. Each image is saved with what was read, for a
// check by eye. A form that stops at inspect (assessment, required table) still has its CAPTCHA step run.
//   npx tsx scripts/_zoho-captcha-dryrun.ts [--limit 18] [--out <dir>] [--skip host,host] [--hosts host,host]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../src/lib/db";
import type { FormField, ResolvedValue } from "../src/modules/apply/adapter";
import { typeZohoCaptcha, zohoAdapter } from "../src/modules/apply/adapters/zohorecruit";
import { captureZohoCaptcha, inspectZohoCaptcha, ZOHO_CAPTCHA } from "../src/modules/apply/captcha/detector";
import { openStealthyBrowser } from "../src/modules/apply/real-browser";

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

function testValue(field: FormField): string | null {
  const options = field.options ?? [];
  switch (field.type) {
    case "file":
      return null;
    case "number":
      return "2";
    case "textarea":
      return /skill/i.test(field.label) ? "Python, SQL" : "Dry run: this text is a test value and is never submitted.";
    case "select":
      return options[Math.min(1, options.length - 1)] ?? null;
    case "checkbox":
      return "Yes";
    default:
      if (field.hintKey === "email") return "dry.run@example.com";
      if (field.hintKey === "phone") return "9876543210";
      if (field.hintKey === "first_name") return "Dry";
      if (field.hintKey === "last_name") return "Run";
      return /website|linkedin|url|link/i.test(field.label) ? "https://example.com/dry-run" : "Dry run";
  }
}

type Row = { host: string; form: string; fill: string; captcha: string; read: string; images: number; ms: number; note: string };

async function main() {
  const limit = Number(arg("--limit")) || 18;
  const out = arg("--out") ?? ".";
  await mkdir(out, { recursive: true });
  const skip = new Set((arg("--skip") ?? "").split(",").filter(Boolean));
  const only = new Set((arg("--hosts") ?? "").split(",").filter(Boolean));
  const jobs = await db.job.findMany({ where: { source: "zohorecruit", closedAt: null }, orderBy: { postedAt: "desc" }, select: { applyUrl: true } });
  const byHost = new Map<string, string>();
  for (const { applyUrl } of jobs) {
    const host = new URL(applyUrl).host;
    const name = host.split(".")[0];
    if (!byHost.has(host) && !skip.has(name) && (only.size === 0 || only.has(name))) byHost.set(host, applyUrl);
  }
  const urls = [...byHost.values()].slice(0, limit);
  console.log(`dry run on ${urls.length} portals (of ${byHost.size} with an open job); nothing is submitted or uploaded`);
  const rows: Row[] = [];

  for (const url of urls) {
    const host = new URL(url).host.split(".")[0];
    const row: Row = { host, form: "", fill: "", captcha: "", read: "", images: 0, ms: 0, note: "" };
    rows.push(row);
    console.log(`\n== ${url}`);
    const session = await openStealthyBrowser(url, "zohodryrun");
    if (!session) {
      row.form = "no browser";
      continue;
    }
    const page = session.page;
    try {
      let fields: FormField[] = [];
      try {
        fields = await zohoAdapter.inspect(page);
        row.form = `${fields.length} fields`;
      } catch (error) {
        row.form = `stop: ${(error instanceof Error ? error.message : String(error)).split("\n")[0].replace(/This Zoho Recruit (form|job) /, "").slice(0, 70)}`;
      }
      let ok = 0;
      const failed: string[] = [];
      for (const field of fields) {
        const value = testValue(field);
        if (value === null) continue;
        const resolved: ResolvedValue = { key: field.hintKey ?? "custom", label: field.label, value, source: "default", selector: field.selector, type: field.type, required: field.required };
        try {
          await zohoAdapter.fill(page, [resolved]);
          ok += 1;
        } catch (error) {
          failed.push(`${field.type} "${field.label.slice(0, 30)}": ${(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 90)}`);
        }
      }
      row.fill = fields.length ? `${ok} ok, ${failed.length} failed` : "-";
      for (const line of failed) console.log(`  FILL FAIL ${line}`);

      const inspection = await inspectZohoCaptcha(page);
      if (!inspection.required) {
        // The form JSON may still say CAPTCHA while the page draws it another way: look for any image that looks like one.
        const other = await page.locator('img[src*="CAPTCHA" i], img[alt*="captcha" i], iframe[src*="captcha" i], iframe[src*="recaptcha" i]').count();
        row.captcha = other > 0 ? `OTHER CAPTCHA markup (${other})` : "none";
        continue;
      }
      row.captcha = `image ${inspection.imageVisible ? "shown" : "HIDDEN"}, box ${inspection.inputVisible ? "shown" : "HIDDEN"}, refresh ${inspection.refreshAvailable ? "yes" : "NO"}`;
      const src = async () => (await page.locator(ZOHO_CAPTCHA.image).first().getAttribute("src").catch(() => null)) ?? "";
      const firstSrc = await src();
      if (!/\/recruit\/GenerateCAPTCHA\?/.test(firstSrc)) row.note = `image src: ${firstSrc.slice(0, 50)}`;
      const started = Date.now();
      const result = await typeZohoCaptcha(page);
      row.ms = Date.now() - started;
      const lastSrc = await src();
      row.images = firstSrc === lastSrc ? 1 : 2; // 2 = at least one refresh
      if ("typed" in result) {
        const typed = (await page.locator(ZOHO_CAPTCHA.input).first().inputValue().catch(() => "")) ?? "";
        row.read = typed;
        const image = await captureZohoCaptcha(page);
        if (image) await writeFile(join(out, `dryrun-${host}.png`), image);
      } else {
        row.read = `PERSON: ${result.person}`;
      }
      // The Submit button is there and was not pressed.
      const submit = await page.locator("form button[type=submit], button[type=submit]").first().isVisible().catch(() => false);
      if (!submit) row.note = `${row.note} no Submit button seen`.trim();
      console.log(`  ${row.form} | fill ${row.fill} | ${row.captcha} | read ${JSON.stringify(row.read)} in ${row.ms} ms${row.images > 1 ? " after a refresh" : ""}${row.note ? ` | ${row.note}` : ""}`);
    } catch (error) {
      row.note = `ERROR ${(error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 120)}`;
      console.log(`  ${row.note}`);
    } finally {
      await session.close(); // never Submit
    }
  }

  console.log("\n== summary (host | form | fill | captcha | read | images | ms | note)");
  for (const r of rows) console.log(`${r.host} | ${r.form} | ${r.fill} | ${r.captcha} | ${r.read} | ${r.images} | ${r.ms} | ${r.note}`);
  const withCaptcha = rows.filter((r) => r.captcha.startsWith("image"));
  const typed = withCaptcha.filter((r) => r.read && !r.read.startsWith("PERSON"));
  console.log(`\nportals ${rows.length}; with the CAPTCHA row ${withCaptcha.length}; typed by the agent ${typed.length}; handed to a person ${withCaptcha.length - typed.length}; other CAPTCHA markup ${rows.filter((r) => r.captcha.startsWith("OTHER")).length}; errors ${rows.filter((r) => r.note.startsWith("ERROR")).length}`);
  await db.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("FAIL", error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
