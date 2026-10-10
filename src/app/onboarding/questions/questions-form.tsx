"use client";

import { forgetVisitedPages } from "@/lib/forget-pages";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel, InputBox } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { ChipGroup } from "@/components/patterns/chip-group";
import { Callout } from "@/components/patterns/content";
import { PageIntro, ScreenBody, StepHeader, StickyFooter } from "@/components/patterns/layout";

const LOCATIONS = ["India", "US", "Other"] as const;
const EMPLOYMENT = ["Full-time", "Part-time", "Contract", "Internship"] as const;
// Notice period is saved in days, as before; "Immediate" is 0.
const NOTICE = [
  { label: "Immediate", value: "0" },
  { label: "15 days", value: "15" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
];

export type QuestionValues = {
  current_ctc: string;
  expected_ctc: string;
  notice_period: string;
  employment_type: string;
  preferred_location: string[];
  citizenship: string;
  relocate_outside_home: string;
  sponsorship_outside_home: string;
};

export type StandingQuestions = {
  home: string;
  citizenship: string;
  relocate: { question: string; options: string[] };
  sponsorship: { question: string; options: string[] };
};

/**
 * Step 3 of onboarding (design/onboarding.html): pay and notice, then what and where. The same answers as before,
 * saved together at the end with one PUT /api/answers.
 */
export function QuestionsForm({ initial, standing }: { initial: QuestionValues; standing: StandingQuestions }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [screen, setScreen] = useState<"money" | "where">("money");
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "failed">("idle");
  // Citizenship: the home country in one tap, or any other typed in.
  const homeCitizen = values.citizenship.trim().toLowerCase() === standing.home.toLowerCase();
  const [otherCitizenship, setOtherCitizenship] = useState(!!initial.citizenship.trim() && !homeCitizen);

  function set<K extends keyof QuestionValues>(key: K, value: QuestionValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus("idle");
  }

  function toggleLocation(location: string) {
    set(
      "preferred_location",
      values.preferred_location.includes(location) ? values.preferred_location.filter((item) => item !== location) : [...values.preferred_location, location],
    );
  }

  function next() {
    if (!values.current_ctc.trim() || !values.expected_ctc.trim() || !values.notice_period.trim()) {
      setStatus("error");
      return;
    }
    setStatus("idle");
    setScreen("where");
  }

  async function save() {
    const preferred = LOCATIONS.filter((location) => values.preferred_location.includes(location));
    if (
      !values.current_ctc.trim() ||
      !values.expected_ctc.trim() ||
      !values.notice_period.trim() ||
      !values.employment_type ||
      preferred.length === 0 ||
      !values.citizenship.trim() ||
      !values.relocate_outside_home ||
      !values.sponsorship_outside_home
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
      { key: "citizenship", question: standing.citizenship, answer: values.citizenship.trim().slice(0, 200) },
      { key: "relocate_outside_home", question: standing.relocate.question, answer: values.relocate_outside_home },
      { key: "sponsorship_outside_home", question: standing.sponsorship.question, answer: values.sponsorship_outside_home },
    ];

    setStatus("saving");
    const response = await fetch("/api/answers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: answers.map((row) => ({ ...row, source: "user" })) }),
    });
    if (!response.ok) {
      setStatus("failed");
      return;
    }
    await forgetVisitedPages();
    router.push("/feed");
  }

  // A saved notice period that is not one of the chips still shows, selected.
  const notice = NOTICE.some((option) => option.value === values.notice_period.trim()) || !values.notice_period.trim()
    ? NOTICE
    : [...NOTICE, { label: `${values.notice_period.trim()} days`, value: values.notice_period.trim() }];

  if (screen === "money") {
    return (
      <>
        <StepHeader step={3} backHref="/onboarding/confirm" />
        <ScreenBody className="gap-5 overflow-y-auto pb-5">
          <PageIntro eyebrow="Questions 1 of 2" title="A few answers every form asks" />
          <Callout>We never guess these. They only go to jobs you swipe right on, and if a form asks something new, we&apos;ll pause and ask you.</Callout>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="current_ctc">Current CTC</FieldLabel>
            <InputBox id="current_ctc" inputMode="decimal" prefix="₹" suffix="lakh a year" value={values.current_ctc} onChange={(event) => set("current_ctc", event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="expected_ctc">Expected CTC</FieldLabel>
            <InputBox id="expected_ctc" inputMode="decimal" prefix="₹" suffix="lakh a year" value={values.expected_ctc} onChange={(event) => set("expected_ctc", event.target.value)} />
          </div>
          <ChipGroup
            legend="Notice period"
            options={notice.map((option) => ({ label: option.label, selected: values.notice_period.trim() === option.value, onSelect: () => set("notice_period", option.value) }))}
          />
          {status === "error" ? <FieldError>Answer every question before moving on.</FieldError> : null}
        </ScreenBody>
        <StickyFooter>
          <Button variant="primary" size="xl" className="w-full" onClick={next}>
            Next
          </Button>
        </StickyFooter>
      </>
    );
  }

  return (
    <>
      <StepHeader step={3} onBack={() => setScreen("money")} />
      <ScreenBody className="gap-[22px] overflow-y-auto pb-5">
        <PageIntro eyebrow="Questions 2 of 2" title="What are you looking for?" />
        <ChipGroup
          legend="Kind of job"
          options={EMPLOYMENT.map((kind) => ({ label: kind, selected: values.employment_type === kind, onSelect: () => set("employment_type", kind) }))}
        />
        <ChipGroup
          legend="Where · pick any"
          options={LOCATIONS.map((location) => ({ label: location, selected: values.preferred_location.includes(location), onSelect: () => toggleLocation(location) }))}
        />
        <div className="box-border flex flex-col gap-3.5 rounded-panel border-2 border-edge bg-surface p-4 shadow-hard">
          <span className="text-base font-semibold">Country questions</span>
          <ChipGroup
            shape="block"
            legend="Which country are you a citizen of?"
            legendClassName="mb-2 font-normal text-muted-foreground"
            options={[
              { label: standing.home, selected: !otherCitizenship && homeCitizen, onSelect: () => { setOtherCitizenship(false); set("citizenship", standing.home); } },
              { label: "Another country", selected: otherCitizenship, onSelect: () => { setOtherCitizenship(true); if (homeCitizen) set("citizenship", ""); } },
            ]}
          />
          {otherCitizenship ? (
            <div className="flex flex-col gap-2">
              <FieldLabel tone="small" htmlFor="citizenship">Country (several: separate with commas)</FieldLabel>
              <InputBox id="citizenship" value={values.citizenship} onChange={(event) => set("citizenship", event.target.value)} />
            </div>
          ) : null}
          <ChipGroup
            shape="block"
            legend={`Are you open to moving out of ${standing.home} for a job?`}
            legendClassName="mb-2 font-normal text-muted-foreground"
            options={standing.relocate.options.map((option) => ({ label: option, selected: values.relocate_outside_home === option, onSelect: () => set("relocate_outside_home", option) }))}
          />
          <ChipGroup
            shape="block"
            legend={`Do you need visa sponsorship to work outside ${standing.home}?`}
            legendClassName="mb-2 font-normal text-muted-foreground"
            options={standing.sponsorship.options.map((option) => ({ label: option, selected: values.sponsorship_outside_home === option, onSelect: () => set("sponsorship_outside_home", option) }))}
          />
          <p className="m-0 text-[13px] leading-[1.45] text-muted-foreground">
            Forms ask these in many wordings (based in the US? authorized to work in Canada? citizen of one of these countries?). We answer each from these, and never guess.
          </p>
        </div>
        {status === "error" ? <FieldError>Answer every question before saving.</FieldError> : null}
        {status === "failed" ? <FieldError>Could not save your answers. Try again.</FieldError> : null}
      </ScreenBody>
      <StickyFooter>
        <Button variant="primary" size="xl" className="w-full" disabled={status === "saving"} onClick={() => void save()}>
          {status === "saving" ? "Saving…" : "Start swiping"}
          {status === "saving" ? null : <Icon name="arrowRight" size={20} strokeWidth={2.5} />}
        </Button>
      </StickyFooter>
    </>
  );
}
