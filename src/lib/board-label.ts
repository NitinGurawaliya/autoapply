// The job board a job came from, as people know it ("via Greenhouse" on the card and the application page). The ids are
// Job.source / Company.source (modules/jobs/boards.ts); this file stays free of server code so pages can use it.
const LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  zohorecruit: "Zoho Recruit",
};

/** "Greenhouse" for "greenhouse"; null for a source people would not recognise (the mock form). */
export function boardLabel(source: string | null | undefined) {
  return source ? LABELS[source] ?? null : null;
}
