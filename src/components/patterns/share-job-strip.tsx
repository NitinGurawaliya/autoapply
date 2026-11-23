import { CompanyMark } from "@/components/ui/marks";

/**
 * The job someone is applying to from a share link, kept in view above both onboarding steps (Phase U4,
 * design/share.html 7–8): the company tile, the role, the company and a quiet "Applying" tag.
 */
export function ShareJobStrip({ company, logoUrl, title }: { company: string; logoUrl: string | null; title: string }) {
  return (
    <div className="mx-5 mb-2 flex items-center gap-3 rounded-card bg-surface px-3 py-2.5 shadow-lift" role="note" aria-label={`Applying to ${title} at ${company}`}>
      <CompanyMark name={company} logoUrl={logoUrl} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate type-body font-semibold" title={title}>
          {title}
        </span>
        <span className="truncate type-meta text-muted-foreground">{company}</span>
      </div>
      <span className="flex-none rounded-tag bg-sunk px-2 py-0.5 type-meta text-muted-foreground">Applying</span>
    </div>
  );
}
