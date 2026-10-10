// Screenshots for the design check (docs/DESIGN.md). Needs `npm run dev` for app pages.
//   npx tsx scripts/design-shots.ts boards <design bundle .html> [outDir]   every board of the owner's design file
//   npx tsx scripts/design-shots.ts app <path> [path...]                   app pages at 390x844, light and dark
//   SHOT_STEPS=1 takes 390x844 slices down each page instead of one full-page image.
// App pages are opened as the test account (t12-check@swipeapply.local) with a short-lived session.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { db } from "../src/lib/db";

const OUT = process.env.SHOTS_DIR ?? `${process.env.TEMP ?? "."}/swipeapply-design`;

async function boards(file: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(pathToFileURL(file).href);
    await page.waitForSelector("iframe", { timeout: 60000 });
    await page.waitForTimeout(6000);
    const frames = page.locator("section iframe");
    const count = await frames.count();
    for (let index = 0; index < count; index += 1) {
      const frame = frames.nth(index);
      const title = ((await frame.getAttribute("title")) ?? `board-${index}`).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      await frame.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await frame.screenshot({ path: `${OUT}/board-${title}.png` });
      console.log(`board ${title}`);
    }
  } finally {
    await browser.close();
  }
}

async function app(paths: string[]) {
  const user = await db.user.findUnique({ where: { email: "t12-check@swipeapply.local" } });
  if (!user) throw new Error("test user missing");
  const token = randomBytes(16).toString("hex");
  const session = await db.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 900_000) } });
  const browser = await chromium.launch();
  try {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
      await context.addCookies([{ name: "authjs.session-token", value: token, url: "http://localhost:3000", httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      for (const path of paths) {
        await page.goto(`http://localhost:3000${path}`, { timeout: 90000 });
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await page.waitForTimeout(800);
        const name = `app${path.replace(/[^a-z0-9]+/gi, "-")}-${scheme}`.replace(/-+/g, "-");
        if (process.env.SHOT_STEPS) {
          // Viewport-sized slices down the page, for reading details at full size.
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let top = 0, part = 1; top < height; top += 844, part += 1) {
            await page.evaluate((y) => window.scrollTo(0, y), top);
            await page.waitForTimeout(150);
            await page.screenshot({ path: `${OUT}/${name}-${part}.png` });
          }
        } else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
        console.log(`app ${name}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "boards") await boards(rest[0]);
  else if (mode === "app") await app(rest);
  else throw new Error("usage: design-shots.ts boards <file> | app <path...>");
  console.log(`screenshots in ${OUT}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
