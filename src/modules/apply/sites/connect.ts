import { appUrl, sendPush } from "@/lib/push";
import { sealKeyReady } from "@/lib/sealed";
import { failConnect, finishConnect, getConnection, SITE_INFO, siteStateKey, type Site } from "@/modules/sources";
import { storage } from "@/lib/storage";
import { openBrowser } from "../browser";
import { waitForSignIn } from "./naukri";

/** How long the sign-in window waits for the person (docs/naukri/TDD.md 4.5). */
export const SIGN_IN_WAIT_MS = 10 * 60 * 1000;

/**
 * Connect a user's own account on a job site (worker, screen only): the login page in a fresh visible window, the person
 * signs in, the site's cookies are saved encrypted, the window closes. The agent types nothing and reads no form.
 */
export async function runConnect(userId: string, site: Site) {
  const connection = await getConnection(userId, site);
  // Withdrawn (Disconnect) or already settled before this job ran: nothing to open.
  if (connection?.status !== "connecting") return "skipped" as const;
  if (!sealKeyReady()) {
    console.error("source-connect: BROWSER_STATE_KEY is not set on this worker; a sign-in cannot be saved");
    await failConnect(userId, site, "The worker on your computer is not set up to keep sign-ins yet. Try again once it is.");
    return "failed" as const;
  }
  const info = SITE_INFO[site];
  // A window that does not finish signing in must never replace a saved sign-in: persist only on success.
  const session = await openBrowser(info.loginUrl, userId, { site, fresh: true, persist: false });
  try {
    await sendPush(userId, {
      title: `Sign in to ${info.label}`,
      body: `A Chrome window opened on your computer. Sign in to ${info.label} there; your agent never sees your password.`,
      url: appUrl("/account"),
      tag: `connect-${site}`,
    }).catch(() => 0);
    const result = await waitForSignIn(session.page, SIGN_IN_WAIT_MS, async () => (await getConnection(userId, site))?.status !== "connecting");
    if (result.status === "cancelled") return "cancelled" as const;
    if (result.status === "closed") {
      await failConnect(userId, site, "The sign-in window closed before you were signed in.");
      return "failed" as const;
    }
    if (result.status === "timeout") {
      await failConnect(userId, site, "Signing in took longer than 10 minutes. Connect again when you are ready.");
      return "failed" as const;
    }
    if (!(await session.saveState())) {
      await failConnect(userId, site, `Your ${info.label} sign-in could not be saved. Connect again.`);
      return "failed" as const;
    }
    if (!(await finishConnect(userId, site, result.accountLabel))) {
      // Disconnected while the person was signing in: the saved sign-in goes too.
      await storage.delete(siteStateKey(userId, site));
      return "cancelled" as const;
    }
    console.log(`source-connect: ${site} connected for …${userId.slice(-6)}`);
    return "connected" as const;
  } finally {
    await session.close();
  }
}
