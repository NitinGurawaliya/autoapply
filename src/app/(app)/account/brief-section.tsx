import Link from "next/link";
import { Tag } from "@/components/ui/chip";
import { TRACK_LABELS, type Track } from "@/modules/jobs";
import type { Brief } from "@/modules/profile";

// The confirm screen's own words for the "Never show me" chips (onboarding/confirm/confirm-form.tsx).
const AVOID_LABELS: Record<string, string> = { contract: "Contract roles", intern: "Internships", commission_only: "Commission only" };

function yearsLine(years: number | null) {
  if (years == null) return "Not on your resume";
  if (years < 1) return "Under a year";
  return `${years} ${years === 1 ? "year" : "years"}`;
}

/** "What I know about you" (P5): the candidate brief jobs are matched on, read-only; changed on the confirm screen. */
export function BriefSection({ brief, avoid, failed = false }: { brief: Brief | null; avoid: string[]; failed?: boolean }) {
  return (
    <section aria-labelledby="brief-heading" className="box-border flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="brief-heading" className="m-0 type-section">
          What I know about you
        </h2>
        {brief ? (
          <Link href="/onboarding/confirm" className="type-meta font-medium text-foreground underline underline-offset-4 decoration-line-strong hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 rounded-tag">
            Change
          </Link>
        ) : null}
      </div>
      {failed ? (
        <p className="m-0 type-body text-muted-foreground">Couldn&apos;t load this right now. Refresh the page to try again.</p>
      ) : !brief ? (
        <p className="m-0 type-body text-muted-foreground">Nothing yet. Upload your resume and this fills in from it.</p>
      ) : (
        <>
          <p className="m-0 type-body text-muted-foreground">Jobs are matched on this, never on your name or contact details.</p>
          <dl className="m-0 flex flex-col">
            <Row label="Your fields">
              {brief.tracks.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {brief.tracks.map((track) => (
                    <Tag key={track}>{TRACK_LABELS[track as Track] ?? track}</Tag>
                  ))}
                </div>
              ) : (
                "None picked"
              )}
            </Row>
            <Row inline label="Nearby fields">{brief.nearby ? "Shown too" : "Not shown"}</Row>
            <Row inline label="Never show me">{avoid.length > 0 ? avoid.map((id) => AVOID_LABELS[id] ?? id).join(", ") : "Nothing hidden"}</Row>
            <Row inline label="Experience">{yearsLine(brief.years)}</Row>
            <Row inline label="Current title">
              {brief.title ? (
                <span className="block truncate" title={brief.title}>
                  {brief.title}
                </span>
              ) : (
                "Not on your resume"
              )}
            </Row>
            <Row label="Top skills" last>
              {brief.skills.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {brief.skills.map((skill) => (
                    <Tag key={skill}>{skill}</Tag>
                  ))}
                </div>
              ) : (
                "None found on your resume"
              )}
            </Row>
          </dl>
        </>
      )}
    </section>
  );
}

/** One fact: a short value sits on the label's line (`inline`), a list of tags goes under it. */
function Row({ label, inline = false, last = false, children }: { label: string; inline?: boolean; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex py-3 ${inline ? "items-baseline justify-between gap-4" : "flex-col gap-2"} ${last ? "pb-0" : "border-b border-line"}`}>
      <dt className="flex-none type-meta text-muted-foreground">{label}</dt>
      <dd className={`m-0 min-w-0 type-body text-foreground ${inline ? "text-right" : ""}`}>{children}</dd>
    </div>
  );
}
