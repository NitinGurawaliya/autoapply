// K18: Hirist's login form, read signed out and never typed into (docs/hirist/TDD.md 4.3). Run in the screen image through
// the reader's own proxy address:  node --import tsx scripts/hirist-login-probe.ts
// Prints the controls the sign-in steps will use: tag, type, placeholder, name, id, class names, whether visible or
// disabled, and the words on buttons. No value is typed or read, nothing is submitted, no code is requested.
import { openBrowser } from "../src/modules/apply/browser";
import { readerOwner } from "../src/modules/sources";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function controls(page: import("playwright").Page, label: string) {
  const rows = await page
    .locator("input, button, [role=button], a[href*='login' i], [class*='login' i]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const element = node as HTMLElement;
          const box = element.getBoundingClientRect();
          const input = element as HTMLInputElement;
          return {
            tag: element.tagName.toLowerCase(),
            type: input.type || null,
            placeholder: input.placeholder || null,
            name: input.name || null,
            id: element.id || null,
            maxlength: input.maxLength > 0 ? input.maxLength : null,
            inputmode: element.getAttribute("inputmode"),
            autocomplete: element.getAttribute("autocomplete"),
            classes: String(element.className || "").slice(0, 80),
            text: (element.innerText || "").trim().slice(0, 40),
            visible: box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden",
            disabled: (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true" || /disabled/i.test(String(element.className)),
          };
        })
        .filter((row) => row.visible),
    );
  console.log(`\n== ${label}: ${rows.length} visible controls`);
  for (const row of rows.slice(0, 40)) console.log(JSON.stringify(row));
}

async function main() {
  const session = await openBrowser("https://www.hirist.tech/", readerOwner(1, 0), { site: "hirist", fresh: true, persist: false });
  const page = session.page;
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
    await sleep(4000);
    await controls(page, "front page");
    // The cookie banner's "Got it" first, as a person would, then the header's Login button: the form is a modal.
    const gotIt = page.locator("button:visible").filter({ hasText: /^Got it$/ }).first();
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click().catch(() => undefined);
    await sleep(1000);
    const login = page.locator("button:visible").filter({ hasText: /^Login$/ }).first();
    console.log(`header Login button visible: ${await login.isVisible().catch(() => false)}`);
    await login.click({ timeout: 8000 }).catch((error) => console.log(`click failed: ${String(error).slice(0, 120)}`));
    await sleep(3500);
    console.log(`after click: ${new URL(page.url()).pathname}`);
    await controls(page, "login modal");
    console.log(`captcha frames: ${await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').count().catch(() => 0)}`);
    // The words on the page around the form, to find the error and hint text classes (no input is touched).
    const hints = await page.locator("p, span, div").evaluateAll((nodes) => nodes.map((node) => (node.children.length === 0 ? (node as HTMLElement).innerText?.trim() ?? "" : "")).filter((text) => text.length > 6 && text.length < 80 && /otp|password|mobile|email|account|register|continue/i.test(text)).slice(0, 14));
    console.log("page words:", JSON.stringify([...new Set(hints)]));
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
