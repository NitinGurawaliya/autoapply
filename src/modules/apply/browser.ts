import { chromium, type BrowserContext, type Page } from "playwright";

export type OpenBrowser = {
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

export async function openBrowser(url: string): Promise<OpenBrowser> {
  const headed = process.env.DEMO_HEADED === "1";

  const context = await chromium.launchPersistentContext(
    "./.greenhouse-profile",
    {
      headless: !headed,
      viewport: { width: 1280, height: 800 },
    }
  );

  const page = await context.newPage();

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  return {
    context,
    page,
    close: async () => {
      await context.close();
    },
  };
}