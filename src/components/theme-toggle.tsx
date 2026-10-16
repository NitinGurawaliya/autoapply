"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

const CHOICES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/**
 * Appearance in the profile menu (16 Oct, owner): follow the phone, or always light, or always dark. next-themes keeps
 * the choice in this browser and applies it before paint (app/layout.tsx).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The saved choice is only known in the browser; until then nothing is shown as picked, so server and client agree.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : null;

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
      <span id="appearance-label" className="text-[15px] font-semibold">
        Appearance
      </span>
      <div role="radiogroup" aria-labelledby="appearance-label" className="grid grid-cols-3 gap-1 rounded-tile bg-subtle p-1">
        {CHOICES.map((choice) => {
          const picked = current === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={picked}
              onClick={() => setTheme(choice.value)}
              className={`min-h-9 cursor-pointer rounded-[10px] text-[13px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${picked ? "bg-surface text-foreground shadow-[0_1px_2px_var(--shadow-color)]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
