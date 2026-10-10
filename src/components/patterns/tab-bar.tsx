"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Icon } from "@/components/ui/icons";
import { useApplicationsSummary } from "@/components/applications-summary";

// The design's two tabs. Applications carries a lime count of applications waiting for the user,
// from the shell's shared poller.
const TABS = [
  { href: "/feed", label: "Discover", icon: "card" as const },
  { href: "/applications", label: "Applications", icon: "list" as const },
];

export function TabBar({ placement = "fixed" }: { placement?: "fixed" | "static" }) {
  const pathname = usePathname();
  const { waiting } = useApplicationsSummary();
  const count = waiting?.length ?? 0;

  return (
    <nav
      aria-label="Main"
      className={cn(
        placement === "fixed" && "fixed inset-x-0 bottom-0 z-40",
        "mx-auto box-border grid w-full max-w-[480px] grid-cols-2 border-t border-line bg-surface pt-1.5 pb-[max(24px,env(safe-area-inset-bottom))]",
      )}
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const badge = tab.href === "/applications" && count > 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-[52px] flex-col items-center justify-center gap-[3px] text-xs no-underline",
              active ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
            )}
          >
            <span className="relative flex">
              <Icon name={tab.icon} size={24} />
              {badge ? (
                <span
                  data-pending-badge=""
                  className="absolute -top-[5px] -right-[11px] box-border flex h-5 min-w-5 items-center justify-center rounded-full border-[1.5px] border-primary-edge bg-primary px-[5px] text-[11px] font-bold text-ink"
                >
                  {count}
                </span>
              ) : null}
            </span>
            {tab.label}
            {badge ? <span className="sr-only">, {count} need you</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
