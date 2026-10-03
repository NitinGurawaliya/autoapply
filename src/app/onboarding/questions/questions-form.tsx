"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LOCATIONS = ["India", "US", "Other"] as const;
const EMPLOYMENT = ["Full-time", "Part-time", "Contract", "Internship"] as const;

export type QuestionValues = {
  current_ctc: string;
  expected_ctc: string;
  notice_period: string;
  employment_type: string;
  preferred_location: string[];
  work_authorization: string;
  needs_sponsorship: string;
};

function needsCountryQuestions(locations: string[]) {
  return locations.includes("US") || locations.includes("Other");
}

export function QuestionsForm({ initial }: { initial: QuestionValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const extra = needsCountryQuestions(values.preferred_location);

  function toggleLocation(location: string) {
    setValues((current) => {
      const selected = current.preferred_location.includes(location)
        ? current.preferred_location.filter((item) => item !== location)
        : [...current.preferred_location, location];
      return { ...current, preferred_location: selected };
    });
    setStatus("idle");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const preferred = LOCATIONS.filter((location) => values.preferred_location.includes(location));
    const askCountry = needsCountryQuestions(preferred);
    if (
      !values.current_ctc.trim() ||
      !values.expected_ctc.trim() ||
      !values.notice_period.trim() ||
      !values.employment_type ||
      preferred.length === 0 ||
      (askCountry && (!values.work_authorization || !values.needs_sponsorship))
    ) {
      setStatus("error");
      return;
    }

    const answers = [
      { key: "current_ctc", question: "Current CTC", answer: values.current_ctc.trim() },
      { key: "expected_ctc", question: "Expected CTC", answer: values.expected_ctc.trim() },
      { key: "notice_period", question: "Notice period", answer: values.notice_period.trim() },
      { key: "employment_type", question: "Employment type", answer: values.employment_type },
      { key: "preferred_location", question: "Preferred location", answer: preferred.join(",") },
    ];
    if (askCountry) {
      answers.push(
        {
          key: "work_authorization",
          question: "Work authorization",
          answer: values.work_authorization,
        },
        {
          key: "needs_sponsorship",
          question: "Needs sponsorship",
          answer: values.needs_sponsorship,
        },
      );
    }

    setStatus("saving");
    const response = await fetch("/api/answers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: answers.map((row) => ({ ...row, source: "user" })),
      }),
    });
    if (!response.ok) {
      setStatus("error");
      return;
    }
    router.push("/feed");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="current_ctc">Current CTC</Label>
        <Input
          id="current_ctc"
          value={values.current_ctc}
          onChange={(event) => {
            setValues((current) => ({ ...current, current_ctc: event.target.value }));
            setStatus("idle");
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="expected_ctc">Expected CTC</Label>
        <Input
          id="expected_ctc"
          value={values.expected_ctc}
          onChange={(event) => {
            setValues((current) => ({ ...current, expected_ctc: event.target.value }));
            setStatus("idle");
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="notice_period">Notice period (days)</Label>
        <Input
          id="notice_period"
          inputMode="numeric"
          value={values.notice_period}
          onChange={(event) => {
            setValues((current) => ({ ...current, notice_period: event.target.value }));
            setStatus("idle");
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="employment_type">Employment type</Label>
        <select
          id="employment_type"
          value={values.employment_type}
          onChange={(event) => {
            setValues((current) => ({ ...current, employment_type: event.target.value }));
            setStatus("idle");
          }}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Select</option>
          {EMPLOYMENT.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Preferred location</legend>
        {LOCATIONS.map((location) => (
          <label key={location} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="preferred_location"
              value={location}
              checked={values.preferred_location.includes(location)}
              onChange={() => toggleLocation(location)}
            />
            {location}
          </label>
        ))}
      </fieldset>
      {extra ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="work_authorization">Work authorization</Label>
            <select
              id="work_authorization"
              value={values.work_authorization}
              onChange={(event) => {
                setValues((current) => ({ ...current, work_authorization: event.target.value }));
                setStatus("idle");
              }}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Select</option>
              <option value="Authorized">Authorized</option>
              <option value="Not authorized">Not authorized</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="needs_sponsorship">Needs sponsorship</Label>
            <select
              id="needs_sponsorship"
              value={values.needs_sponsorship}
              onChange={(event) => {
                setValues((current) => ({ ...current, needs_sponsorship: event.target.value }));
                setStatus("idle");
              }}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">Select</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>
        </>
      ) : null}
      {status === "error" ? (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          Answer every question before saving.
        </p>
      ) : null}
      <Button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
