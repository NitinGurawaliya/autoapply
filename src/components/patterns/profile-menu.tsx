"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { userInitials } from "@/components/ui/marks";
import { NotificationsToggle } from "@/components/notifications";
import { ThemeToggle } from "@/components/theme-toggle";
import { useShell } from "@/components/patterns/shell-context";

// The design's round initials button ("Your profile and sign out"). The pages that are not tabs live here.
const LINKS = [
  { href: "/answers", label: "Saved answers" },
  { href: "/gaps", label: "Fill your gaps" },
  { href: "/governance", label: "Governance" },
  { href: "/account", label: "Account and data" },
];

export function ProfileMenu({ align = "left" }: { align?: "left" | "right" }) {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!shell) return null;
  return (
    <div ref={root} className="relative flex-none">
      <IconButton
        variant="subtle"
        aria-label="Your profile and sign out"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {userInitials(shell.name, shell.email)}
      </IconButton>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-[52px] z-50 box-border flex w-[280px] flex-col gap-1 rounded-panel border-2 border-edge bg-surface p-2 shadow-hard",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          <div className="flex flex-col gap-0.5 px-2 pt-1.5 pb-2.5">
            <span className="truncate text-[15px] font-semibold">{shell.name || "Your account"}</span>
            <span className="truncate text-[13px] text-muted-foreground">{shell.email}</span>
          </div>
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center justify-between rounded-tile px-2 text-[15px] font-semibold text-foreground no-underline outline-none hover:bg-subtle focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {link.label}
              <Icon name="chevronRight" size={18} className="text-muted-foreground" />
            </Link>
          ))}
          <NotificationsToggle />
          <ThemeToggle />
          <div className="mt-1 border-t border-line px-2 pt-2.5 pb-1">{shell.signOut}</div>
        </div>
      ) : null}
    </div>
  );
}
