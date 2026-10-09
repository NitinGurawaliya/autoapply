import { Layers } from "lucide-react";

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-card">
        <Layers className="size-4" aria-hidden />
      </span>
      <span className="text-base font-semibold tracking-tight">SwipeApply</span>
    </span>
  );
}
