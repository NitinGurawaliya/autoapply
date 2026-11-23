import { appUrl, sendPush } from "@/lib/push";
import { enqueueSourceIngest } from "@/lib/queue";
import { sealKeyReady } from "@/lib/sealed";
import { failConnect, finishConnect, getConnection, setStreamUrl, SITE_INFO, siteStateKey, type Site } from "@/modules/sources";
import { storage } from "@/lib/storage";
import { openBrowser } from "../browser";
import { waitForSignIn } from "./naukri";
import { openStream, relayReady, type StreamOutcome } from "./relay";
import { ScreenStream } from "./screen-stream";

/** How long the sign-in window waits for the person (docs/naukri/TDD.md 4.5). */
export const SIGN_IN_WAIT_MS = 10 * 60 * 1000;

/** For checks only: a local page instead of the site's login, and that page's own sign-in test. */
export type ConnectOptions = { loginUrl?: string; waitForSignIn?: typeof waitForSignIn };

/**
 * Connect a user's own account on a job site (worker, screen only): the login page in a fresh visible window, the person
 * signs in, the site's cookies are saved encrypted, the window closes. The agent types nothing and reads no form.
 *
 * Streamed (K8, docs/naukri/TDD.md 13.12): on a worker running the relay, the window is sized to a phone and streamed to
 * the user's own phone (relay.ts); their taps and keys come back as input. Nothing of the login pages is stored, logged
 * or screenshotted. Without the relay, K1's window on this worker's own screen.
 */
export async function runConnect(userId: string, site: Site, options: ConnectOptions = {}) {
  const connection = await getConnection(userId, site);
  // Withdrawn (Disconnect) or already settled before this job ran: nothing to open.
  if (connection?.status !== "connecting") return "skipped" as const;
  if (!sealKeyReady()) {
    console.error("source-connect: BROWSER_STATE_KEY is not set on this worker; a sign-in cannot be saved");
    await failConnect(userId, site, "The worker on your computer is not set up to keep sign-ins yet. Try again once it is.");
    return "failed" as const;
  }
  const info = SITE_INFO[site];
  const loginUrl = options.loginUrl ?? info.loginUrl;
  const streamed = relayReady();
  // A window that does not finish signing in must never replace a saved sign-in: persist only on success.
  // Streamed, it opens blank, so the page is laid out for the phone from its first frame.
  const session = await openBrowser(streamed ? "about:blank" : loginUrl, userId, { site, fresh: true, persist: false });
  let screen: ScreenStream | null = null;
  let relay: ReturnType<typeof openStream> | null = null;
  let outcome: StreamOutcome = "failed";
  try {
    if (streamed) {
      screen = new ScreenStream(session.context);
      await screen.start(session.page);
      relay = openStream(userId, site, screen, Date.now() + SIGN_IN_WAIT_MS);
      if (!(await setStreamUrl(userId, site, relay.url))) {
        outcome = "cancelled";
        return "cancelled" as const;
      }
      await session.page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    }
    await sendPush(userId, {
      title: `Sign in to ${info.label}`,
      body: streamed
        ? `${info.label}'s sign-in is ready in SwipeApply. You type your password and OTP yourself; your agent never types or keeps them.`
        : `A Chrome window opened on your computer. Sign in to ${info.label} there; your agent never sees your password.`,
      url: appUrl("/account"),
      tag: `connect-${site}`,
    }).catch(() => 0);
    const wait = options.waitForSignIn ?? waitForSignIn;
    const result = await wait(session.page, SIGN_IN_WAIT_MS, async () => (await getConnection(userId, site))?.status !== "connecting");
    if (result.status === "cancelled") {
      outcome = "cancelled";
      return "cancelled" as const;
    }
    if (result.status === "closed") {
      await failConnect(userId, site, "The sign-in window closed before you were signed in.");
      return "failed" as const;
    }
    if (result.status === "timeout") {
      outcome = "expired";
      await failConnect(userId, site, "Signing in took longer than 10 minutes. Connect again when you are ready.");
      return "failed" as const;
    }
    // Signed in: the phone stops seeing the window before anything else happens in it.
    if (relay) relay.end("connected");
    if (!(await session.saveState())) {
      await failConnect(userId, site, `Your ${info.label} sign-in could not be saved. Connect again.`);
      return "failed" as const;
    }
    if (!(await finishConnect(userId, site, result.accountLabel))) {
      // Disconnected while the person was signing in: the saved sign-in goes too.
      outcome = "cancelled";
      await storage.delete(siteStateKey(userId, site));
      return "cancelled" as const;
    }
    outcome = "connected";
    console.log(`source-connect: ${site} connected for …${userId.slice(-6)}`);
    // The first look for jobs right away, so the feed fills without another press (the run's own budget and checks apply).
    await enqueueSourceIngest(userId, site).catch((error) => console.error(`source-connect: first ${site} run not queued: ${error instanceof Error ? error.message : error}`));
    return "connected" as const;
  } finally {
    relay?.end(outcome);
    await screen?.stop();
    if (relay) await setStreamUrl(userId, site, null).catch(() => undefined);
    await session.close();
  }
}
