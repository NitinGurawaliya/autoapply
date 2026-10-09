/** Company initials on a soft brand tile. Decorative: the company name is always written next to it. */
export function CompanyAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const letters = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const box = size === "sm" ? "size-10 rounded-lg text-xs" : "size-12 rounded-xl text-sm";
  return (
    <span className={`grid shrink-0 place-items-center bg-accent font-semibold text-accent-foreground ${box}`} aria-hidden>
      {letters || "?"}
    </span>
  );
}
