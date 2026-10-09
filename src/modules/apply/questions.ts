import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { FormField } from "./adapter";

/**
 * A job's application questions read WITHOUT a browser (T56), so the agent can ask what it is missing before it opens
 * the form, and the feed can be pre-scanned for gaps. Greenhouse publishes them on its public board API
 * (`…/jobs/{id}?questions=true`); the labels match the hosted form, which matters because saved answers are keyed by
 * wording. Our mock form has a fixed list. Other boards return null (their forms are only read in the browser).
 * Cached on the Job row for a day.
 */

const apiSchema = z.object({
  questions: z
    .array(
      z.object({
        label: z.string(),
        required: z.boolean().nullable().optional(),
        fields: z.array(z.object({ name: z.string(), type: z.string(), values: z.array(z.object({ label: z.string() })).nullable().optional() })),
      }),
    )
    .default([]),
  location_questions: z.array(z.object({ label: z.string(), required: z.boolean().nullable().optional(), fields: z.array(z.object({ name: z.string(), type: z.string() })) })).nullable().optional(),
});

const TYPES: Record<string, string> = {
  input_text: "text",
  textarea: "textarea",
  input_file: "file",
  multi_value_single_select: "select",
  multi_value_multi_select: "checkbox-group",
};

/** Greenhouse API questions → the FormField shape the adapters produce (selector "#<field name>"). */
export function fromGreenhouse(body: unknown): FormField[] {
  const parsed = apiSchema.parse(body);
  const fields: FormField[] = [];
  for (const question of parsed.questions) {
    const first = question.fields.find((field) => TYPES[field.type]);
    if (!first) continue;
    const label = question.label.replace(/\s+/g, " ").trim();
    const options = first.values?.map((value) => value.label.replace(/\s+/g, " ").trim()).filter(Boolean);
    fields.push({
      selector: `#${first.name}`,
      label,
      type: TYPES[first.type],
      required: question.required === true,
      options: options && options.length > 0 ? options : undefined,
    });
  }
  // The visible location box (the hidden latitude/longitude are filled by the form itself).
  for (const question of parsed.location_questions ?? []) {
    if (question.fields.some((field) => field.type === "input_text")) fields.push({ selector: "#candidate-location", label: question.label, type: "combobox", required: question.required === true });
  }
  return fields;
}

/** The mock form's questions (src/app/mock/greenhouse/page.tsx), so the ask-before-the-run path can be tested end to end. */
export const MOCK_QUESTIONS: FormField[] = [
  { selector: "#first_name", label: "First name", type: "text", required: true },
  { selector: "#last_name", label: "Last name", type: "text", required: true },
  { selector: "#email", label: "Email", type: "text", required: true },
  { selector: "#phone", label: "Phone", type: "text", required: true },
  { selector: "#resume", label: "Resume", type: "file", required: true },
  { selector: "#how_heard", label: "How did you hear about us?", type: "combobox", required: true },
  { selector: "#notice_period", label: "Notice period", type: "text", required: true },
  { selector: "#work_authorization", label: "Work authorization", type: "select", required: true, options: ["Authorized", "Need sponsorship"] },
  { selector: "#free_text", label: "Why this role?", type: "textarea", required: true },
  ...[
    ["gender", "Gender"],
    ["race", "Race"],
    ["veteran_status", "Veteran status"],
    ["disability", "Disability"],
  ].map(([id, label]): FormField => ({ selector: `#${id}`, label, type: "select", required: true, options: ["Decline to answer", "Yes", "No"] })),
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The job's questions (cached on the row for a day), or null when they cannot be read without a browser. */
export async function jobQuestions(job: { id: string; source: string; externalId: string; questions: unknown; questionsFetchedAt: Date | null; company: { slug: string } }): Promise<FormField[] | null> {
  if (job.source === "mock") return MOCK_QUESTIONS;
  if (job.source !== "greenhouse") return null;
  if (job.questions && job.questionsFetchedAt && Date.now() - job.questionsFetchedAt.getTime() < DAY_MS) return job.questions as FormField[];
  try {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(job.company.slug)}/jobs/${encodeURIComponent(job.externalId)}?questions=true`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const fields = fromGreenhouse(await response.json());
    await db.job.update({ where: { id: job.id }, data: { questions: fields as unknown as Prisma.InputJsonValue, questionsFetchedAt: new Date() } });
    return fields;
  } catch {
    return null;
  }
}
