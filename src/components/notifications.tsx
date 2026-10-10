"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useApplicationsSummary } from "@/components/applications-summary";
import { Icon } from "@/components/ui/icons";
import { cn } from "cn";

const OPT_IN = "swipeapply:notify";
const SEEN = "swipeapply:notified";

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[];
  } catch {
    return [];
  }
}

// Opt-in and permission, shared by the always-mounted notifier and the toggle in the profile menu.
type State = { permission: NotificationPermission | "unsupported"; enabled: boolean };
const SERVER_STATE: State = { permission: "default", enabled: false };
let state: State | null = null;
const listeners = new Set<() => void>();

function current(): State {
  if (state === null) {
    state = {
      permission: "Notification" in window ? Notification.permission : "unsupported",
      enabled: localStorage.getItem(OPT_IN) === "1",
    };
  }
  return state;
}
function update(next: Partial<State>) {
  state = { ...current(), ...next };
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function useNotificationState() {
  return useSyncExternalStore(subscribe, current, () => SERVER_STATE);
}

// Browser push (lib/push.ts, public/sw.js): reaches the user with the app closed, for new matching jobs and for
// applications waiting on them. Where the browser has no push, the in-page notifications below still work.
function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

/** Registers the service worker, subscribes this browser and saves the subscription for the user. Fails quietly. */
async function startPush() {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const { publicKey } = (await (await fetch("/api/push", { cache: "no-store" })).json()) as { publicKey: string | null };
    if (!publicKey) return;
    const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
  } catch {
    // No push in this browser (or the user blocked it): the in-page notifications still work.
  }
}

async function stopPush() {
  if (!pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
    await subscription.unsubscribe();
  } catch {
    // Nothing to undo.
  }
}

/**
 * Tells the user when an application is waiting for them (and keeps browser push on for new matching jobs): the tab title always shows the count, and, once the user
 * turns notifications on and the browser allows it, a notification names the company. One per prompt, remembered
 * across reloads, so polling never repeats it. Reads the shell's shared poller (applications-summary.tsx).
 * Mounted once by the signed-in layout; renders nothing (the switch lives in the profile menu).
 */
export function NeedsInputNotifier() {
  const { enabled } = useNotificationState();
  const router = useRouter();
  const routerRef = useRef(router);
  const baseTitle = useRef<string | null>(null);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
    routerRef.current = router;
  }, [enabled, router]);

  const { waiting } = useApplicationsSummary();

  function setBadge(count: number) {
    if (baseTitle.current === null) baseTitle.current = document.title.replace(/^\(\d+\)\s*/, "");
    const base = baseTitle.current ?? "SwipeApply";
    document.title = count > 0 ? `(${count}) ${base}` : base;
  }

  useEffect(() => () => setBadge(0), []);

  // Keeps this browser's push subscription saved while notifications are on (also for users who turned them on
  // before push existed).
  useEffect(() => {
    if (enabled && "Notification" in window && Notification.permission === "granted") void startPush();
  }, [enabled]);

  useEffect(() => {
    if (!waiting) return;
    setBadge(waiting.length);
    if (!enabledRef.current || !("Notification" in window) || Notification.permission !== "granted") return;
    const seen = readSeen();
    for (const row of waiting) {
      const key = `${row.id}:${row.promptId ?? row.waitingFor}`;
      if (seen.includes(key)) continue;
      seen.push(key);
      const text =
        row.waitingFor === "code"
          ? { title: `${row.company}: enter the security code`, body: `${row.title}. Greenhouse emailed you a code to finish this application.` }
          : { title: `${row.company} needs an answer`, body: `${row.title}. Your application is paused until you answer.` };
      // The same tag as the push for this application (lib/notify.ts), so the browser shows one, not two.
      const note = new Notification(text.title, { body: text.body, tag: `app-${row.id}` });
      note.onclick = () => {
        window.focus();
        routerRef.current.push(`/applications/${row.id}`);
        note.close();
      };
    }
    localStorage.setItem(SEEN, JSON.stringify(seen.slice(-200)));
  }, [waiting]);

  return null;
}

/** The notifications switch, a row in the profile menu. Hidden where the browser has no notifications. */
export function NotificationsToggle() {
  const { permission, enabled } = useNotificationState();

  async function toggle() {
    if (!("Notification" in window)) return;
    if (enabled) {
      localStorage.setItem(OPT_IN, "0");
      update({ enabled: false });
      void stopPush();
      return;
    }
    const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    update({ permission: result });
    if (result === "granted") {
      localStorage.setItem(OPT_IN, "1");
      update({ enabled: true });
      void startPush();
    }
  }

  if (permission === "unsupported") return null;
  const blocked = permission === "denied";
  const label = blocked
    ? "Notifications are blocked in your browser settings"
    : enabled
      ? "Notifications on. Click to turn off"
      : "Turn on notifications for new matching jobs and applications that need you";

  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      disabled={blocked}
      onClick={() => void toggle()}
      className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-tile px-2 text-left text-[15px] font-semibold outline-none hover:bg-subtle focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Icon name="bell" size={20} />
      <span className="flex flex-1 flex-col gap-0.5">
        <span>Notifications</span>
        <span className="text-[13px] font-normal text-muted-foreground">{blocked ? "Blocked in your browser settings" : "New jobs for you, and applications that need you"}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "box-border flex h-[26px] w-[44px] flex-none items-center rounded-full border-2 px-0.5 transition-colors",
          enabled ? "justify-end border-primary-edge bg-primary" : "justify-start border-input bg-surface",
        )}
      >
        <span className={cn("block size-[18px] rounded-full", enabled ? "bg-ink" : "bg-line-strong")} />
      </span>
    </button>
  );
}
