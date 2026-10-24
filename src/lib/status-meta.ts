// One place for what every application status means on screen. The wording is the agent's voice (24 Oct, owner): the
// user sees their agent at work, never the pipeline behind it.
// Headlines and next steps for anything not sent stay in lib/explain.ts; the step story in lib/steps.ts.

export type StatusGroup = "needs" | "progress" | "sent" | "failed";

export type StatusMeta = {
  /** Short words for this status (pills, the detail header). */
  label: string;
  group: StatusGroup;
  /** Stage on the four-part progress (0 waiting, 1 reading, 2 filling, 3 sent); null when it does not apply. */
  stage: number | null;
  /** True while the agent is working on it, so the UI animates and keeps polling. */
  live: boolean;
};

const META: Record<string, StatusMeta> = {
  queued: { label: "Up next", group: "progress", stage: 0, live: true },
  inspecting: { label: "Reading the form", group: "progress", stage: 1, live: true },
  filling: { label: "Writing your answers", group: "progress", stage: 2, live: true },
  needs_input: { label: "Needs you", group: "needs", stage: null, live: false },
  // Submit may have gone out unconfirmed: the user checks their email and says which (apply/outcome.ts).
  pending_verification: { label: "Check your email", group: "needs", stage: null, live: false },
  submitted: { label: "Sent", group: "sent", stage: 3, live: false },
  failed: { label: "Didn't go through", group: "failed", stage: null, live: false },
  blocked: { label: "Didn't go through", group: "failed", stage: null, live: false },
  cancelled: { label: "Didn't go through", group: "failed", stage: null, live: false },
};

export function statusMeta(status: string): StatusMeta {
  return META[status] ?? { label: status, group: "failed", stage: null, live: false };
}

/** What the agent is doing at each stage, on the after-swipe toast, in-progress rows and the live card. */
export const STAGES = ["Getting ready to apply", "Reading the application form", "Writing your answers", "Sent"] as const;

/** Filter chips on the applications list, in the design's order. */
export const GROUP_TABS: Array<{ id: "all" | StatusGroup; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs", label: "Needs you" },
  { id: "progress", label: "In progress" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Didn't go through" },
];

/** Changes whenever an application's status or story does (a new event): the detail page re-renders only then. */
export function applicationVersion(status: string, events: number) {
  return `${status}:${events}`;
}
