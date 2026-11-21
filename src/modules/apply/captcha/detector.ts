import type { Page } from "playwright";
import type { CaptchaInspection } from "./types";

const NONE = { required: false, type: "none", imageVisible: false, inputVisible: false, refreshAvailable: false, invalidMessageVisible: false, emptyMessageVisible: false } as const;

export async function inspectKekaCaptcha(
  page: Page
): Promise<CaptchaInspection> {
  const image = page.locator("#imgCaptcha");
  const input = page.locator("#captcha");
  const refresh = page.locator("#retryCaptcha");

  const required = (await image.count()) > 0;

  if (!required) return { board: "keka", ...NONE };

  return {
    board: "keka",
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

/**
 * Zoho Recruit's CAPTCHA row (read on four live portals, 21 Nov, all alike): `div.crc-captcha` holding the box
 * (`input[placeholder="Type below image text"]`, maxlength 10), the image (`.crc-captcha-container img[alt=CAPTCHA]`,
 * 200x70, served by `/recruit/GenerateCAPTCHA?currenttime=..&cipher=..`) and a refresh button ("Load new CAPTCHA").
 * Zoho shows no CAPTCHA message of its own on the form: a wrong one is said in its answer to the POST.
 */
export const ZOHO_CAPTCHA = {
  input: 'input[placeholder="Type below image text"]',
  image: '.crc-captcha img[alt="CAPTCHA"], .crc-captcha-container img',
  refresh: '.crc-captcha button[aria-label="Load new CAPTCHA"], .crc-captcha-container button',
} as const;

export async function inspectZohoCaptcha(page: Page): Promise<CaptchaInspection> {
  const input = page.locator(ZOHO_CAPTCHA.input).first();
  if ((await input.count()) === 0) return { board: "zohorecruit", ...NONE };
  const visible = (selector: string) => page.locator(selector).first().isVisible().catch(() => false);
  return {
    board: "zohorecruit",
    required: true,
    type: "image-text",
    imageVisible: await visible(ZOHO_CAPTCHA.image),
    inputVisible: await input.isVisible().catch(() => false),
    refreshAvailable: await visible(ZOHO_CAPTCHA.refresh),
    invalidMessageVisible: false,
    emptyMessageVisible: false,
  };
}

/** How much larger than its natural size the CAPTCHA is drawn for the model (200x70 → 600x210; 21 Nov, small reads missed). */
const CAPTURE_SCALE = 3;

/**
 * Zoho's CAPTCHA image as a PNG for the model, or null when it has not loaded or is blank (the caller loads a new one).
 * Drawn from the loaded image at natural size times CAPTURE_SCALE on white (same origin, so the canvas is readable);
 * an element screenshot if the canvas cannot be read. The image is never fetched again: each fetch is a new CAPTCHA.
 */
export async function captureZohoCaptcha(page: Page): Promise<Buffer | null> {
  const image = page.locator(ZOHO_CAPTCHA.image).first();
  if (!(await image.isVisible().catch(() => false))) {
    await image.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  }
  const drawn = await image
    .evaluate(
      async (node, scale) => {
        const img = node as HTMLImageElement;
        if (!img.complete) await Promise.race([new Promise((done) => img.addEventListener("load", done, { once: true })), new Promise((done) => setTimeout(done, 10000))]);
        if (!img.complete || img.naturalWidth === 0) return { state: "unloaded" };
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth * scale;
        canvas.height = img.naturalHeight * scale;
        const g = canvas.getContext("2d");
        if (!g) return { state: "nocanvas" };
        g.fillStyle = "#fff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.imageSmoothingQuality = "high";
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          const pixels = g.getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] < 600) ink += 1;
          if (ink < (canvas.width * canvas.height) / 200) return { state: "blank" };
          return { state: "ok", data: canvas.toDataURL("image/png") };
        } catch {
          return { state: "nocanvas" };
        }
      },
      CAPTURE_SCALE,
    )
    .catch(() => ({ state: "unloaded" }) as { state: string; data?: string });
  if (drawn.state === "ok" && drawn.data) return Buffer.from(drawn.data.split(",")[1] ?? "", "base64");
  if (drawn.state === "nocanvas") return image.screenshot({ type: "png", timeout: 10000 }).catch(() => null);
  return null;
}

/** A new CAPTCHA image: Zoho's refresh button, then the new image's load. False when nothing changed. */
export async function refreshZohoCaptcha(page: Page): Promise<boolean> {
  const image = page.locator(ZOHO_CAPTCHA.image).first();
  const before = await image.getAttribute("src").catch(() => null);
  const refresh = page.locator(ZOHO_CAPTCHA.refresh).first();
  if (!(await refresh.isVisible().catch(() => false))) return false;
  await refresh.click({ timeout: 5000 }).catch(() => refresh.evaluate((node) => (node as HTMLElement).click()).catch(() => undefined));
  const changed = await page
    .waitForFunction(
      ([selector, old]) => {
        const img = document.querySelector(selector) as HTMLImageElement | null;
        return Boolean(img && img.getAttribute("src") !== old && img.complete && img.naturalWidth > 0);
      },
      [ZOHO_CAPTCHA.image, before] as const,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  await page.locator(ZOHO_CAPTCHA.input).first().fill("").catch(() => undefined);
  return changed;
}
