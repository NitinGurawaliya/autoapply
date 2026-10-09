"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useApplicationsSummary } from "@/components/applications-summary";

const OPT_IN = "swipeapply:notify";
const SEEN = "swipeapply:notified";

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * Tells the user when an application is waiting for them: the tab title always shows the count, and, once the user
 * turns the bell on and the browser allows it, a notification names the company. One per prompt, remembered across
 * reloads, so polling never repeats it. Reads the shell's shared poller (applications-summary.tsx).
 */
export function NeedsInputNotifier() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [enabled, setEnabled] = useState(false);
  const router = useRouter();
  const routerRef = useRef(router);
  const baseTitle = useRef<string | null>(null);
  const enabledRef = useRef(false);

  useEffect(() => {
    // Reading browser-only state after mount; the first render must match the server's.
    /* eslint-disable react-hooks/set-state-in-effect */
    setPermission("Notification" in window ? Notification.permission : "unsupported");
    const on = localStorage.getItem(OPT_IN) === "1";
    setEnabled(on);
    /* eslint-enable react-hooks/set-state-in-effect */
    enabledRef.current = on;
  }, []);

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
      const note = new Notification(text.title, { body: text.body, tag: key });
      note.onclick = () => {
        window.focus();
        routerRef.current.push(`/applications/${row.id}`);
        note.close();
      };
    }
    localStorage.setItem(SEEN, JSON.stringify(seen.slice(-200)));
  }, [waiting]);

  async function toggle() {
    if (!("Notification" in window)) return;
    if (enabled) {
      localStorage.setItem(OPT_IN, "0");
      setEnabled(false);
      return;
    }
    const result = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      localStorage.setItem(OPT_IN, "1");
      setEnabled(true);
    }
  }

  if (permission === "unsupported") return null;
  const blocked = permission === "denied";
  const label = blocked
    ? "Notifications are blocked in your browser settings"
    : enabled
      ? "Notifications on. Click to turn off"
      : "Turn on notifications for applications that need you";
  const Icon = blocked ? BellOff : enabled ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={blocked}
      aria-label={label}
      aria-pressed={enabled}
      title={label}
      className={
        enabled
          ? "grid size-9 place-items-center rounded-full bg-accent text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "grid size-9 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      }
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}
