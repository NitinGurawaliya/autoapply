// Ad hoc (21 Nov): npx tsx scripts/_zoho-captcha-probe.ts [--limit 4] [--stealthy] [--read --out <dir>]
// Opens a few open Zoho Recruit jobs, clicks "I'm interested" and dumps the CAPTCHA row's markup: the image's src
// shape, the refresh control and the input. Read-only: nothing is filled, uploaded or submitted.
import { chromium, type Page } from "playwright";
import { db } from "../src/lib/db";
import { openStealthyBrowser } from "../src/modules/apply/real-browser";
import { readCaptcha } from "../src/modules/apply/captcha/ai";
import { captureZohoCaptcha, refreshZohoCaptcha } from "../src/modules/apply/captcha/detector";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const CAPTCHA_INPUT = 'input[placeholder="Type below image text"]';
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

async function probe(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const decline = page.getByText("Decline non-essential", { exact: true }).first();
  if (await decline.isVisible().catch(() => false)) await decline.click({ timeout: 3000 }).catch(() => undefined);
  if ((await page.locator('[class*="crc-rec-form_"]').count()) === 0) {
    const btn = page.getByText("I'm interested").first();
    await btn.waitFor({ timeout: 30000 });
    await btn.click();
    await page.locator('[class*="crc-rec-form_"]').first().waitFor({ timeout: 30000 });
  }
  await page.waitForTimeout(1500);
  const input = page.locator(CAPTCHA_INPUT).first();
  if ((await input.count()) === 0) return "no captcha input";
  await input.evaluate((el) => el.setAttribute("data-probe", "1"));
  if (process.argv.includes("--read")) {
    // The image as the solver captures it, read by the model, saved for a look by eye. Nothing is typed.
    const lines: string[] = [];
    // The first image, then one refresh: the refresh path is exercised too.
    for (let round = 0; round < 2; round += 1) {
      if (round > 0) lines.push(`refresh changed the image: ${await refreshZohoCaptcha(page)}`);
      const png = await captureZohoCaptcha(page);
      if (!png) {
        lines.push("capture: null (unloaded or blank)");
        continue;
      }
      const out = join(arg("--out") ?? ".", `zoho-captcha-${new URL(url).hostname.split(".")[0]}-${round}.png`);
      await writeFile(out, png);
      const t0 = Date.now();
      lines.push(`read=${JSON.stringify(await readCaptcha(png))} in ${Date.now() - t0} ms, ${png.length} bytes, saved ${out}`);
    }
    return lines.join("\n");
  }
  return page.evaluate(PROBE_JS);
}

const PROBE_JS = `(() => {
  const el = document.querySelector('[data-probe="1"]');
  const short = function (s) { return (s || "").slice(0, 160); };
  let holder = el;
  for (let i = 0; i < 6 && holder && !holder.querySelector("img, canvas, svg"); i += 1) holder = holder.parentElement;
  const img = holder ? holder.querySelector("img") : null;
  const html = (holder ? holder.outerHTML : "").replace(/src="data:[^"]*"/g, 'src="data:..."').replace(/\s+/g, " ");
  const clickables = Array.from(holder ? holder.querySelectorAll("a, button, [onclick], [class*=refresh i], [class*=reload i], lyte-button, [class*=icon i]") : []).map(function (n) { return n.tagName.toLowerCase() + ' class="' + short(n.getAttribute("class")) + '" id="' + n.id + '" title="' + short(n.getAttribute("title")) + '" text="' + short(n.innerText) + '"'; });
  return JSON.stringify({
    inputName: el.getAttribute("name"), inputId: el.id, inputClass: el.className,
    img: img ? { id: img.id, cls: img.className, src: short(img.getAttribute("src")).slice(0, 90), w: img.naturalWidth, h: img.naturalHeight, complete: img.complete } : null,
    clickables: clickables, holderTag: holder && holder.tagName, holderClass: holder && holder.className, html: html.slice(0, 3000)
  }, null, 1);
})()`;

async function main() {
  const limit = Number(arg("--limit")) || 4;
  const jobs = await db.job.findMany({ where: { source: "zohorecruit", closedAt: null }, orderBy: { postedAt: "desc" }, distinct: ["companyId"], take: limit * 3, select: { applyUrl: true } });
  const urls = [...new Set(jobs.map((j) => j.applyUrl))].slice(0, limit);
  console.log(`probing ${urls.length} jobs`);
  const stealthy = process.argv.includes("--stealthy") ? await openStealthyBrowser(urls[0], "probe") : null;
  const browser = stealthy ? null : await chromium.launch({ headless: !process.argv.includes("--headed") });
  try {
    for (const url of urls) {
      const page = stealthy ? stealthy.page : await (await browser!.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
      console.log(`\n=== ${url}`);
      try { console.log(await probe(page, url)); } catch (e) { console.log("ERR", e instanceof Error ? e.message.split("\n")[0] : e); }
      if (!stealthy) await page.context().close();
    }
  } finally {
    await browser?.close();
    await stealthy?.close();
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
