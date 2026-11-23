import type { BrowserContext, CDPSession, Page } from "playwright";
import { z } from "zod";

/**
 * The sign-in window as the phone sees it (K8, docs/naukri/TDD.md 13.12 "Connect on a phone"): the page's own pixels
 * from Chrome's screencast (`Page.startScreencast`), and the person's taps and keys put back as input events.
 *
 * What it never does: read the page (no DOM, no form, no OTP box), type anything of its own, store or log a frame or an
 * input, or take a screenshot. A frame lives in memory only until the next one replaces it; input is dispatched and
 * forgotten. It follows the window: a popup (Sign in with Google) is streamed while it is open, then the page under it.
 */

export type StreamFrame = {
  /** JPEG, base64: Chrome's own encoding, passed on untouched. */
  data: string;
  /** The page's size in CSS pixels, so a tap on the picture maps back onto the page. */
  width: number;
  height: number;
};

/** The phone's screen in CSS pixels, clamped to a phone's. */
export const viewportSchema = z.object({
  width: z.coerce.number().int().min(280).max(600),
  height: z.coerce.number().int().min(400).max(1100),
});
export type PhoneViewport = z.infer<typeof viewportSchema>;

export const DEFAULT_VIEWPORT: PhoneViewport = { width: 390, height: 760 };

const KEYS = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Backspace: { code: "Backspace", vk: 8 },
  Tab: { code: "Tab", vk: 9 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
} as const;

/** One input from the phone. Coordinates in the page's CSS pixels. Text is bounded; nothing here is ever logged. */
export const inputEventSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("tap"), x: z.number().min(0).max(4000), y: z.number().min(0).max(4000) }),
  z.object({ t: z.literal("scroll"), x: z.number().min(0).max(4000), y: z.number().min(0).max(4000), dy: z.number().min(-4000).max(4000) }),
  z.object({ t: z.literal("text"), s: z.string().min(1).max(256) }),
  z.object({ t: z.literal("key"), k: z.enum(Object.keys(KEYS) as [keyof typeof KEYS, ...(keyof typeof KEYS)[]]) }),
]);
export type InputEvent = z.infer<typeof inputEventSchema>;
export const inputBatchSchema = z.object({ events: z.array(inputEventSchema).min(1).max(64) });

const DEVICE_SCALE = 2;
const JPEG_QUALITY = 60;

export class ScreenStream {
  private page: Page | null = null;
  private session: CDPSession | null = null;
  private viewport: PhoneViewport = DEFAULT_VIEWPORT;
  private latest: StreamFrame | null = null;
  private listener: ((frame: StreamFrame) => void) | null = null;
  private stopped = false;
  private switching: Promise<void> = Promise.resolve();
  private readonly onPage = (page: Page) => this.follow(page);

  constructor(private readonly context: BrowserContext) {}

  /** Starts streaming the window's page, at the phone's size. */
  async start(page: Page, viewport: PhoneViewport = DEFAULT_VIEWPORT) {
    this.viewport = viewport;
    this.context.on("page", this.onPage);
    await this.attach(page);
  }

  /** The newest frame (for a viewer that just connected), then every new one. One viewer at a time. */
  watch(listener: (frame: StreamFrame) => void) {
    this.listener = listener;
    if (this.latest) listener(this.latest);
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  /** The phone's screen changed size (rotation, keyboard): the page is laid out again for it. */
  async resize(viewport: PhoneViewport) {
    if (viewport.width === this.viewport.width && viewport.height === this.viewport.height) return;
    this.viewport = viewport;
    if (this.session) await this.screencast(this.session).catch(() => undefined);
  }

  /** The person's taps and keys, in order. Never logged, never kept. */
  async input(events: InputEvent[]) {
    const session = this.session;
    if (!session || this.stopped) return false;
    for (const event of events) {
      if (event.t === "tap") {
        const at = { x: event.x, y: event.y };
        await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
        await session.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...at });
        await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...at });
      } else if (event.t === "scroll") {
        await session.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: event.x, y: event.y, deltaX: 0, deltaY: event.dy });
      } else if (event.t === "text") {
        await session.send("Input.insertText", { text: event.s });
      } else {
        const key = KEYS[event.k];
        const text = "text" in key ? key.text : undefined;
        const common = { key: event.k, code: key.code, windowsVirtualKeyCode: key.vk, nativeVirtualKeyCode: key.vk };
        await session.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...common, ...(text ? { text, unmodifiedText: text } : {}) });
        await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
      }
    }
    return true;
  }

  /** Stops the screencast and forgets the last frame. */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.context.off("page", this.onPage);
    this.listener = null;
    this.latest = null;
    const session = this.session;
    this.session = null;
    if (session) {
      await session.send("Page.stopScreencast").catch(() => undefined);
      await session.detach().catch(() => undefined);
    }
  }

  private follow(page: Page) {
    if (this.stopped) return;
    this.switching = this.switching.then(() => this.attach(page)).catch(() => undefined);
  }

  private async attach(page: Page) {
    if (this.stopped || page.isClosed()) return;
    const previous = this.session;
    this.session = null;
    if (previous) {
      await previous.send("Page.stopScreencast").catch(() => undefined);
      await previous.detach().catch(() => undefined);
    }
    this.page = page;
    const session = await this.context.newCDPSession(page);
    session.on("Page.screencastFrame", (event) => {
      // Acknowledged at once, so Chrome keeps sending; the frame goes to the viewer and replaces the last one.
      void session.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
      if (this.stopped || this.session !== session) return;
      const frame = { data: event.data, width: Math.round(event.metadata.deviceWidth), height: Math.round(event.metadata.deviceHeight) };
      this.latest = frame;
      this.listener?.(frame);
    });
    page.once("close", () => {
      if (this.page !== page || this.stopped) return;
      // A popup closed: back to the page under it.
      const under = this.context.pages().filter((open) => !open.isClosed()).at(-1);
      if (under) this.follow(under);
    });
    this.session = session;
    await this.screencast(session);
  }

  private async screencast(session: CDPSession) {
    const { width, height } = this.viewport;
    await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: DEVICE_SCALE, mobile: true });
    await session.send("Page.stopScreencast").catch(() => undefined);
    await session.send("Page.startScreencast", { format: "jpeg", quality: JPEG_QUALITY, maxWidth: width * DEVICE_SCALE, maxHeight: height * DEVICE_SCALE, everyNthFrame: 1 });
  }
}
