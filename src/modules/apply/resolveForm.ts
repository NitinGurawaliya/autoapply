import { upsert } from "@/modules/answers";
import { loadRules } from "@/modules/governance";
import type { FormField } from "./adapter";
import { deriveAnswers, type ProfileForDerive } from "./derive";
import { BEST_PROJECT_KEY, draftEssays, essayKind, ESSAY_PERMISSION_KEY, type EssayKind, type EssayProfile } from "./essay";
import { mapFields } from "./fieldMapper";
import { mapToOptions } from "./optionMap";
import { answerFromMemory, type MemoryAnswer } from "./recall";
import { resolveValues } from "./valueResolver";

/**
 * Everything the agent can answer for a form, in order (ARCHITECTURE 6.19): exact / canonical answers, then memory
 * (retrieve, then verify), then what the profile and resume prove, then essay drafts (with permission), then answers
 * re-worded onto the form's options. Shared by the live run (fields read in the browser), the check before the run and
 * the feed pre-scan (fields read from the board's API, T56). Every model step fails safe: on error it is skipped and
 * the question stays pending.
 */

type AnswerRow = { key: string; answer: string; source: string; updatedAt: Date; context?: unknown };
export type FormProfile = ProfileForDerive & EssayProfile & {
  email: string;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  portfolio: string | null;
  resumeKey: string;
  resumeText: string;
};
export type FormJob = { company: string; title: string; location: string; country: string; description: string };
type Log = (message: string, data?: Record<string, unknown>) => Promise<void>;

const why = (error: unknown) => (error instanceof Error ? error.message.slice(0, 80) : "error");

export async function resolveForm(input: {
  userId: string;
  source: string;
  fields: FormField[];
  profile: FormProfile;
  answers: AnswerRow[];
  job: FormJob;
  /** The live run drafts essays; the check before the run and the pre-scan only report which ones it will draft. */
  draftEssays: boolean;
  log?: Log;
}) {
  const { profile, answers, job } = input;
  const log: Log = input.log ?? (async () => undefined);
  const rules = loadRules();
  const mapped = await mapFields(input.source, input.fields);
  const jobRef = { company: job.company, country: job.country };
  let resolved = resolveValues(mapped, profile, answers, undefined, undefined, jobRef);
  let memoryAnswers: Map<string, MemoryAnswer> | undefined;
  const pendingFields = () => {
    const labels = new Set(resolved.pending.map((question) => question.label));
    return mapped.filter((item) => labels.has(item.field.label)).map((item) => item.field);
  };

  // Retrieve, then verify (recall.ts).
  if (resolved.pending.length > 0) {
    try {
      const memory = await answerFromMemory({ userId: input.userId, job: { company: job.company, title: job.title, location: job.location, country: job.country }, fields: pendingFields() });
      if (memory.answers.size > 0) {
        memoryAnswers = memory.answers;
        resolved = resolveValues(mapped, profile, answers, memoryAnswers, undefined, jobRef);
        await log(`Answered ${memory.answers.size} from your saved answers to other questions`, { matched: [...memory.answers.keys()].map((label) => label.slice(0, 120)) });
      }
      if (memory.rejected.length > 0) await log(`Did not reuse ${memory.rejected.length} similar answers`, { rejected: memory.rejected.slice(0, 10) });
    } catch (error) {
      await log(`Could not check saved answers (${why(error)}); asking instead`);
    }
  }

  // What the profile and resume prove (derive.ts).
  if (resolved.pending.length > 0) {
    try {
      const derived = await deriveAnswers({ profile, fields: pendingFields() });
      if (derived.size > 0) {
        memoryAnswers = new Map([...(memoryAnswers ?? []), ...derived]);
        resolved = resolveValues(mapped, profile, answers, memoryAnswers, undefined, jobRef);
        await log(`Worked out ${derived.size} answers from your profile and resume`, { derived: [...derived.entries()].map(([label, found]) => `${label.slice(0, 80)}: ${found.basis.slice(0, 120)}`) });
      }
    } catch (error) {
      await log(`Could not work out answers from your resume (${why(error)}); asking instead`);
    }
  }

  // Essays with the user's permission (essay.ts), at most max_ai_drafts_per_application per application.
  const permission = answers.find((row) => row.key === ESSAY_PERMISSION_KEY);
  const essaysAllowed = !!permission && /^yes$/i.test(permission.answer.trim());
  let willDraft: string[] = [];
  if (resolved.pending.length > 0 && essaysAllowed) {
    const pendingLabels = new Set(resolved.pending.map((question) => question.label));
    const essays = mapped
      .map((item) => ({ label: item.field.label, kind: essayKind(item.field.label, item.field.type) }))
      .filter((item): item is { label: string; kind: EssayKind } => item.kind !== null && pendingLabels.has(item.label));
    const room = Math.max(0, rules.max_ai_drafts_per_application - resolved.values.filter((value) => value.source === "ai_draft").length);
    const take = essays.slice(0, room);
    willDraft = take.map((item) => item.label);
    if (take.length > 0 && input.draftEssays) {
      try {
        const drafts = await draftEssays({ profile, resumeText: profile.resumeText, job: { company: job.company, title: job.title, description: job.description }, items: take });
        const drafted = new Map<string, MemoryAnswer>();
        for (const [index, text] of drafts) {
          const item = take[index];
          drafted.set(item.label, { key: item.kind === "best_project" ? BEST_PROJECT_KEY : "", answer: text, basis: "AI draft from your resume and the job", score: 1, source: "ai_draft" });
          // The best-project story is saved once (editable on the Answers page) and reused on every form.
          if (item.kind === "best_project") await upsert(input.userId, { key: BEST_PROJECT_KEY, question: item.label, answer: text, source: "ai_draft" });
        }
        if (drafted.size > 0) {
          memoryAnswers = new Map([...(memoryAnswers ?? []), ...drafted]);
          resolved = resolveValues(mapped, profile, answers, memoryAnswers, undefined, jobRef);
          await log(`Drafted ${drafted.size} essay answers (AI draft)`, { drafted: [...drafted.keys()].map((label) => label.slice(0, 120)) });
        }
        if (drafts.size < take.length) await log(`Asked ${take.length - drafts.size} essay questions instead: the draft was missing or named something not in your resume`);
      } catch (error) {
        await log(`Could not draft essay answers (${why(error)}); asking instead`);
      }
      willDraft = [];
    }
    if (essays.length > take.length) await log(`Asked ${essays.length - take.length} essay questions: the limit is ${rules.max_ai_drafts_per_application} AI drafts per application`);
  }

  // Answers we have but worded differently from the form's options (optionMap.ts).
  const pendingNow = new Set(resolved.pending.map((question) => question.label));
  const unfit = resolved.unfit.filter((item) => pendingNow.has(item.label));
  if (unfit.length > 0) {
    try {
      const matches = await mapToOptions(unfit);
      if (matches.size > 0) {
        resolved = resolveValues(mapped, profile, answers, memoryAnswers, matches, jobRef);
        await log(`Matched ${matches.size} saved answers to this form's options`);
      }
    } catch (error) {
      await log(`Could not match answers to the form's options (${why(error)}); asking instead`);
    }
  }

  // What genuinely needs the user: pending questions, minus essays the live run will draft.
  const draftLater = new Set(willDraft);
  const missing = resolved.pending.filter((question) => !draftLater.has(question.label));
  return { mapped, resolved, missing };
}
