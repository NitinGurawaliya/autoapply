"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Layers, MessageSquareText, ShieldCheck } from "lucide-react";
import { useApplicationsSummary } from "@/components/applications-summary";

// Add a tab here when its page exists.
const TABS = [
  { href: "/feed", label: "Feed", icon: Layers },
  { href: "/applications", label: "Applications", icon: ClipboardList },
  { href: "/answers", label: "Answers", icon: MessageSquareText },
  { href: "/governance", label: "Governance", icon: ShieldCheck },
] as const;

function usePendingCount(initial: number) {
  const { waiting } = useApplicationsSummary();
  return waiting ? waiting.length : initial;
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-grid min-w-5 place-items-center rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold leading-5 text-warning"
      aria-label={`${count} waiting for you`}
    >
      {count}
    </span>
  );
}

export function NavTabs({ variant, initialPending }: { variant: "top" | "bottom"; initialPending: number }) {
  const pathname = usePathname();
  const pending = usePendingCount(initialPending);

  if (variant === "top") {
    return (
      <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground"
                  : "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              }
            >
              {tab.label}
              {tab.href === "/applications" ? <Badge count={pending} /> : null}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-pop backdrop-blur md:hidden"
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-[480px]">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium text-primary"
                  : "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs text-muted-foreground"
              }
            >
              <span className="relative">
                <Icon className="size-5" aria-hidden />
                {tab.href === "/applications" && pending > 0 ? (
                  <span className="absolute -right-2.5 -top-2 grid min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-semibold leading-4 text-warning-soft">
                    {pending}
                  </span>
                ) : null}
              </span>
              {tab.label}
              {tab.href === "/applications" && pending > 0 ? <span className="sr-only">{pending} waiting for you</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
