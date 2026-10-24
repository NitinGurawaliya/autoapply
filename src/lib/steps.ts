export type EventLite = { type: string; message: string; rule?: string | null };

export type StepState = "done" | "current" | "stopped" | "todo";
export type Step = { key: string; label: string; state: StepState; note?: string };

const RUNNING = ["queued", "inspecting", "filling", "needs_input"];
const STOPPED = ["failed", "blocked", "cancelled"];

/** How many answers came from where, for the "Wrote your answers" step (the page counts the filled fields). */
export type AnswerCounts = { yours: number; drafted: number };

/**
 * The story of one application as the agent's own steps, worked out from its audit events and its status (24 Oct, owner:
 * what the agent did, never the pipeline behind it: no rule checks, counts of resolved keys or raw page text).
 */
export function buildSteps(events: EventLite[], status: string, answers?: AnswerCounts): Step[] {
  const has = (type: string, test?: (e: EventLite) => boolean) => events.some((e) => e.type === type && (!test || test(e)));
  const submitted = status === "submitted";

  // Held back before the form was opened (a rule): one step, and nothing after it.
  if (has("block")) return [{ key: "held", label: "Held back before applying", state: "stopped" }];

  // A wait for questions comes before filling; a wait for a security code has its own step after it.
  const asked = has("ask_user", (e) => !/security code/i.test(e.message) && !/press Submit/i.test(e.message));
  const codeStep = events.some((e) => /security code/i.test(e.message));
  const questions = Number(events.find((e) => e.type === "inspect")?.message.match(/Found (\d+) fields?/)?.[1]);
  const answerNote = answers && answers.yours + answers.drafted > 0
    ? [answers.yours > 0 ? `${answers.yours} from your resume and you` : null, answers.drafted > 0 ? `${answers.drafted} written by your agent` : null].filter(Boolean).join(" · ")
    : undefined;

  const steps: Array<{ key: string; label: string; done: boolean; note?: string }> = [
    { key: "read", label: "Read the application form", done: has("inspect") || submitted, note: questions > 0 ? `${questions} ${questions === 1 ? "question" : "questions"}` : undefined },
    { key: "prepared", label: "Wrote your answers", done: has("resolve") || submitted, note: answerNote },
  ];
  if (asked) {
    // Questions asked before the form was opened come before "read"; asked mid-form, after "wrote".
    const firstAsk = events.findIndex((e) => e.type === "ask_user" && !/security code/i.test(e.message));
    const firstRead = events.findIndex((e) => e.type === "inspect");
    const wait = { key: "asked", label: "Waited for your answer", done: status !== "needs_input" && (has("fill") || has("inspect") || submitted || STOPPED.includes(status) || status === "filling") };
    if (firstRead < 0 || firstAsk < firstRead) steps.splice(0, 0, wait);
    else steps.push(wait);
  }
  steps.push({ key: "filled", label: "Filled in the form", done: has("fill") || submitted });
  if (codeStep) {
    const entered = has("resolve", (e) => /security code received/i.test(e.message)) || submitted;
    steps.push({ key: "code", label: entered ? "Entered your security code" : "Waited for your security code", done: entered });
  }
  steps.push({ key: "submitted", label: "Submitted", done: submitted, note: submitted && has("submit") ? "The job board confirmed it" : undefined });

  let reachedFirstOpen = false;
  return steps.map((step) => {
    if (step.done) return { key: step.key, label: step.label, state: "done" as const, note: step.note };
    if (reachedFirstOpen) return { key: step.key, label: step.label, state: "todo" as const };
    reachedFirstOpen = true;
    const state: StepState = RUNNING.includes(status) ? "current" : STOPPED.includes(status) ? "stopped" : "todo";
    return { key: step.key, label: step.label, state };
  });
}
