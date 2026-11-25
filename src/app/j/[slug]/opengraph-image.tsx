import { ImageResponse } from "next/og";
import { initialsOf } from "@/components/ui/marks";
import { boardLabel } from "@/lib/board-label";
import { experienceChip, whereLabel } from "@/lib/job-facts";
import { jobIdFromSlug } from "@/lib/job-slug";
import { CARD, cardFonts, cardLogo } from "@/lib/share-card";
import { shareLinksEnabled } from "@/lib/share-gate";
import { publicJob } from "@/modules/jobs";
import { formatSalary } from "@/modules/jobs/salary";

// The preview LinkedIn and X show for a share link (Phase U3, design/share.html 13–14): 1200 × 630, always light.
export const alt = "A job on SwipeApply";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Chip({ children }: { children: string }) {
  return <div style={{ display: "flex", fontSize: 32, padding: "10px 20px", borderRadius: 12, background: CARD.chip, color: CARD.text }}>{children}</div>;
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const id = shareLinksEnabled() ? jobIdFromSlug((await params).slug) : null;
  const job = id ? await publicJob(id) : null;
  const [fonts, logo] = await Promise.all([cardFonts(), cardLogo(job?.company.logoUrl ?? null)]);

  if (!job) {
    return new ImageResponse(
      (
        <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: CARD.background, color: CARD.text, fontSize: 64, fontWeight: 600, fontFamily: "Schibsted Grotesk" }}>
          SwipeApply
        </div>
      ),
      { ...size, fonts },
    );
  }

  const board = boardLabel(job.source);
  const closed = Boolean(job.closedAt);
  const salary = formatSalary({ min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency, period: job.salaryPeriod });
  const where = whereLabel(job);
  const chips = [where.length > 34 ? `${where.slice(0, 33).trimEnd()}…` : where, experienceChip({ requiredYears: job.experienceMin, seniority: job.seniority, yourYears: null }).label, ...(salary && !closed ? [salary] : [])];

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "64px 72px", background: CARD.background, color: CARD.text, fontFamily: "Schibsted Grotesk" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", width: 112, height: 112, borderRadius: 24, alignItems: "center", justifyContent: "center", overflow: "hidden", background: logo ? CARD.white : CARD.tile, color: CARD.tileText, fontSize: 44, fontWeight: 600 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- ImageResponse draws plain img elements
              <img src={logo} width={96} height={96} style={{ objectFit: "contain" }} alt="" />
            ) : (
              initialsOf(job.company.name)
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 600, maxWidth: 880 }}>{job.company.name.length > 36 ? `${job.company.name.slice(0, 35).trimEnd()}…` : job.company.name}</div>
            <div style={{ display: "flex", fontSize: 32, color: CARD.muted }}>{board ? `via ${board}` : "On the company's site"}</div>
          </div>
        </div>

        <div style={{ display: "block", marginTop: 36, fontSize: 80, lineHeight: 1.1, fontWeight: 600, letterSpacing: -2.4, lineClamp: 2, overflow: "hidden" }}>{job.title}</div>

        <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
          {chips.map((chip) => (
            <Chip key={chip}>{chip}</Chip>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: "auto", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 36, fontWeight: 600 }}>
            <div style={{ display: "flex", position: "relative", width: 56, height: 56 }}>
              <div style={{ position: "absolute", top: 4, left: 0, width: 36, height: 48, borderRadius: 12, border: `2px solid ${CARD.line}`, background: CARD.white }} />
              <div style={{ position: "absolute", top: 4, left: 20, width: 36, height: 48, borderRadius: 12, background: CARD.primary }} />
            </div>
            swipeapply
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              fontWeight: 600,
              padding: "18px 32px",
              borderRadius: 20,
              background: closed ? "transparent" : CARD.primary,
              color: closed ? CARD.muted : CARD.onPrimary,
              border: closed ? `2px solid ${CARD.line}` : "none",
            }}
          >
            {closed ? "Closed · see similar jobs" : "Apply in one tap"}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
