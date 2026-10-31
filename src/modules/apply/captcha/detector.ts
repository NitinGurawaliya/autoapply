import type { Page } from "playwright";
import type { CaptchaInspection } from "./types";

export async function inspectKekaCaptcha(
  page: Page
): Promise<CaptchaInspection> {
  const image = page.locator("#imgCaptcha");
  const input = page.locator("#captcha");
  const refresh = page.locator("#retryCaptcha");

  const required = (await image.count()) > 0;

  if (!required) {
    return {
      required: false,
      type: "none",
      imageVisible: false,
      inputVisible: false,
      refreshAvailable: false,
      invalidMessageVisible: false,
      emptyMessageVisible: false,
    };
  }

  return {
    required: true,
    type: "image-text",
    imageVisible: await image.isVisible(),
    inputVisible: await input.isVisible(),
    refreshAvailable: await refresh.isVisible(),
    invalidMessageVisible:
      await page.locator("#invalidCaptcha").isVisible(),
    emptyMessageVisible:
      await page.locator("#noCaptcha").isVisible(),
  };
}