// Ad hoc (17 Nov): npx tsx scripts/_stealthy-smoke.ts [url]
// Opens the url in the SeleniumBase Chrome, reads the title, navigator.webdriver and a bot-check page through
// Playwright, exercises the launcher's PING, and closes it. Prints PASS or FAIL.
import { openStealthyBrowser } from "../src/modules/apply/real-browser";

async function main() {
  const url = process.argv[2] ?? "https://apply.workable.com/j/C4CECEEBEE/apply";
  const started = Date.now();
  const session = await openStealthyBrowser(url, "smoke");
  if (!session) {
    console.log("FAIL: openStealthyBrowser returned null");
    process.exitCode = 1;
    return;
  }
  let ok = true;
  try {
    const title = await session.page.title();
    const webdriver = await session.page.evaluate(() => (navigator as unknown as { webdriver: unknown }).webdriver);
    const ua = await session.page.evaluate(() => navigator.userAgent);
    const ping = await session.command("PING", 10_000);
    console.log(`title: ${title}`);
    console.log(`navigator.webdriver: ${String(webdriver)}`);
    console.log(`userAgent: ${ua}`);
    console.log(`launcher PING: ${ping}`);
    ok = Boolean(title) && webdriver !== true && ping.startsWith("OK");
    // A second navigation through the launcher, the way browser.ts opens every form.
    const reply = await session.command("GOTO https://www.browserscan.net/bot-detection", 60_000);
    await session.page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await session.page.waitForTimeout(4000);
    const verdict = await session.page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 600));
    console.log(`GOTO reply: ${reply}`);
    console.log(`browserscan: ${verdict}`);
    ok = ok && reply.startsWith("OK");
    console.log(`${ok ? "PASS" : "FAIL"}: stealthy browser attached in ${Date.now() - started} ms`);
    if (!ok) process.exitCode = 1;
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error("FAIL", error);
  process.exitCode = 1;
});
