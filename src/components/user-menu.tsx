"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

function initials(name: string | null, email: string) {
  const source = (name?.trim() || email).split(/[\s@._-]+/).filter(Boolean);
  return ((source[0]?.[0] ?? "?") + (source[1]?.[0] ?? "")).toUpperCase();
}

/** The sign-out form is passed in from the server layout, because a server action cannot be defined here. */
export function UserMenu({ name, email, children }: { name: string | null; email: string; children: ReactNode }) {
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

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
        className="grid size-9 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground outline-none ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initials(name, email)}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-border bg-popover p-3 shadow-pop">
          <p className="truncate text-sm font-medium">{name || "Your account"}</p>
          <p className="mb-3 truncate text-xs text-muted-foreground">{email}</p>
          {children}
        </div>
      ) : null}
    </div>
  );
}
