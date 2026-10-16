export type EventLite = { type: string; message: string; rule?: string | null };

export type StepState = "done" | "current" | "stopped" | "todo";
export type Step = { key: string; label: string; state: StepState; note?: string };

const RUNNING = ["queued", "inspecting", "filling", "needs_input"];
const STOPPED = ["failed", "blocked", "cancelled"];

/** The story of one application as a few steps, worked out from its audit events and its status. */
export function buildSteps(events: EventLite[], status: string): Step[] {
  const has = (type: string, test?: (e: EventLite) => boolean) => events.some((e) => e.type === type && (!test || test(e)));
  const submitted = status === "submitted";
  // A wait for questions comes before filling; a wait for a security code has its own step after it.
  const asked = has("ask_user", (e) => !/security code/i.test(e.message));
  const codeStep = events.some((e) => /security code/i.test(e.message));
  const evidence = events.find((e) => e.type === "submit")?.message.match(/Confirmation:\s*(.*)$/)?.[1]?.trim();

  // A rule that stopped the run stops the story at the rules, not at "form read" (16 Oct QA: a blocked application
  // said "Application form read · stopped here" although the form was never opened).
  const blockedByRule = has("block");
  const steps: Array<{ key: string; label: string; done: boolean; note?: string }> = [
    { key: "checks", label: blockedByRule ? "Stopped by a rule" : "Rules checked", done: !blockedByRule && (has("rule_check") || submitted) },
    { key: "read", label: "Application form read", done: has("inspect") || submitted },
    { key: "prepared", label: "Answers prepared", done: has("resolve") || submitted },
  ];
  if (asked) {
    // Questions asked before the form was opened (T56) come before "form read"; asked mid-form, after "prepared".
    const firstAsk = events.findIndex((e) => e.type === "ask_user" && !/security code/i.test(e.message));
    const firstRead = events.findIndex((e) => e.type === "inspect");
    const wait = { key: "asked", label: "Waited for you", done: status !== "needs_input" && (has("fill") || has("inspect") || submitted || STOPPED.includes(status) || status === "filling") };
    if (firstRead < 0 || firstAsk < firstRead) steps.splice(1, 0, wait);
    else steps.push(wait);
  }
  steps.push({ key: "filled", label: "Form filled in", done: has("fill") || submitted });
  if (codeStep) {
    steps.push({ key: "code", label: "Security code entered", done: has("resolve", (e) => /security code received/i.test(e.message)) || submitted });
  }
  steps.push({ key: "submitted", label: "Submitted", done: submitted, note: submitted && evidence ? `Confirmation: ${evidence}` : undefined });

  let reachedFirstOpen = false;
  return steps.map((step) => {
    if (step.done) return { key: step.key, label: step.label, state: "done" as const, note: step.note };
    if (reachedFirstOpen) return { key: step.key, label: step.label, state: "todo" as const };
    reachedFirstOpen = true;
    const state: StepState = RUNNING.includes(status) ? "current" : STOPPED.includes(status) ? "stopped" : "todo";
    return { key: step.key, label: step.label, state };
  });
}
