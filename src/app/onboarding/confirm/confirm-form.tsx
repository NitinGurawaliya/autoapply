"use client";

import { forgetVisitedPages } from "@/lib/forget-pages";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chip, SkillTag } from "@/components/ui/chip";
import { FieldError, FieldLabel, InputBox, TextAreaBox } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { Row, SectionCard } from "@/components/patterns/content";
import { PageIntro, ScreenBody, StepHeader, StickyFooter } from "@/components/patterns/layout";

type Experience = { title: string; company: string; start: string | null; end: string | null; summary: string | null };
type Education = { school: string; degree: string | null; year: string | null };
type Answer = { key: string; question: string; answer: string; source: string };

export type ConfirmValues = {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  yearsExperience: string;
  currentTitle: string;
  currentCompany: string;
  skills: string;
  experience: Experience[];
  education: Education[];
  /** Tech tracks suggested from the resume (modules/jobs/functions.ts), confirmed here. */
  tracks: string[];
  answers: Answer[];
};

type TextKey = "fullName" | "email" | "phone" | "city" | "country" | "linkedin" | "github" | "portfolio" | "yearsExperience" | "currentTitle" | "currentCompany";

const SECTIONS: Array<{ title: string; fields: Array<{ key: TextKey; label: string; inputMode?: "numeric" | "decimal" | "email" | "url" }> }> = [
  {
    title: "Basics",
    fields: [
      { key: "fullName", label: "Full name" },
      { key: "email", label: "Email", inputMode: "email" },
      { key: "phone", label: "Phone", inputMode: "numeric" },
      { key: "city", label: "City" },
      { key: "country", label: "Country" },
    ],
  },
  {
    title: "Work",
    fields: [
      { key: "currentTitle", label: "Current title" },
      { key: "currentCompany", label: "Current company" },
      { key: "yearsExperience", label: "Years of experience", inputMode: "decimal" },
    ],
  },
  {
    title: "Links",
    fields: [
      { key: "linkedin", label: "LinkedIn", inputMode: "url" },
      { key: "github", label: "GitHub", inputMode: "url" },
      { key: "portfolio", label: "Portfolio", inputMode: "url" },
    ],
  },
];

function text(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slug(label: string) {
  return label.toLowerCase().replace(/\s+/g, "-");
}

/** A row that shows its value and turns into an input when its pencil is tapped. */
function EditableRow({
  label,
  value,
  editing,
  onEdit,
  onDone,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (value: string) => void;
  inputMode?: "numeric" | "decimal" | "email" | "url";
}) {
  if (editing) {
    return (
      <div className="flex flex-col gap-2 border-t border-line py-3">
        <FieldLabel tone="small" htmlFor={slug(label)}>
          {label}
        </FieldLabel>
        <div className="flex items-center gap-2">
          <InputBox
            id={slug(label)}
            tone="soft"
            autoFocus
            inputMode={inputMode}
            value={value}
            boxClassName="flex-1"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onDone();
              }
            }}
          />
          <Button variant="underline" size="text" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <Row
      label={label}
      value={value || <span className="font-normal text-muted-foreground">Not on your resume</span>}
      action={
        <IconButton aria-label={`Edit ${label.toLowerCase()}`} className="text-muted-foreground" onClick={onEdit}>
          <Icon name="edit" size={18} />
        </IconButton>
      }
    />
  );
}

/** Step 2 of onboarding (design/onboarding.html "Here's what we found"). Saves with the same two calls as before. */
export function ConfirmForm({ initial, trackOptions }: { initial: ConfirmValues; trackOptions: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "missing">("idle");
  // The phone card shows when the resume had no number, and stays while it is being typed.
  const [askPhone] = useState(!initial.phone.trim());

  function setField(key: keyof ConfirmValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus("idle");
  }

  async function save() {
    if (!values.fullName.trim() || !values.email.trim()) {
      setStatus("missing");
      return;
    }
    setStatus("saving");
    const profile = {
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      phone: text(values.phone),
      city: text(values.city),
      country: text(values.country),
      linkedin: text(values.linkedin),
      github: text(values.github),
      portfolio: text(values.portfolio),
      yearsExperience: text(values.yearsExperience),
      currentTitle: text(values.currentTitle),
      currentCompany: text(values.currentCompany),
      skills: values.skills.split(",").map((item) => item.trim()).filter(Boolean),
      experience: values.experience,
      education: values.education,
      tracks: values.tracks,
    };
    const answers = values.answers.map((row) => ({
      key: row.key,
      question: row.question,
      answer: row.answer,
      source: "user" as const,
    }));
    const [profileRes, answersRes] = await Promise.all([
      fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      }),
      fetch("/api/answers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      }),
    ]);
    if (!profileRes.ok || !answersRes.ok) {
      setStatus("error");
      return;
    }
    await forgetVisitedPages();
    router.push("/onboarding/questions");
  }

  const skills = values.skills.split(",").map((item) => item.trim()).filter(Boolean);
  const years = Number(values.yearsExperience);

  return (
    <>
      <StepHeader step={2} backHref="/onboarding/resume" />
      <ScreenBody className="gap-4 overflow-y-auto pb-5">
        <PageIntro title="Here's what we found" sub="Tap anything to fix it. We only ever use what's on this page." />

        {askPhone ? (
          <div className="box-border flex flex-col gap-3 rounded-panel border-2 border-dashed border-edge bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <Icon name="info" size={20} className="flex-none" />
              <span className="text-[15px] font-semibold">We couldn&apos;t find your phone number</span>
            </div>
            <FieldLabel tone="small" htmlFor="phone-missing">
              Phone
            </FieldLabel>
            <InputBox
              id="phone-missing"
              tone="soft"
              boxClassName="-mt-1.5"
              inputMode="numeric"
              placeholder="10-digit mobile"
              prefix="+91"
              value={values.phone}
              onChange={(event) => setField("phone", event.target.value)}
            />
          </div>
        ) : null}

        {SECTIONS.map((section) => (
          <SectionCard
            key={section.title}
            title={section.title}
            action={
              section.title === "Basics" ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Icon name="file" size={14} />
                  From your resume
                </span>
              ) : undefined
            }
          >
            {section.fields
              .filter((field) => !(askPhone && field.key === "phone"))
              .map((field) => (
                <EditableRow
                  key={field.key}
                  label={field.label}
                  inputMode={field.inputMode}
                  value={values[field.key]}
                  editing={editing === field.key}
                  onEdit={() => setEditing(field.key)}
                  onDone={() => setEditing(null)}
                  onChange={(value) => setField(field.key, value)}
                />
              ))}
          </SectionCard>
        ))}

        <SectionCard title={`Experience${Number.isFinite(years) && values.yearsExperience ? ` · ${years} ${years === 1 ? "year" : "years"}` : ""}`}>
          {values.experience.length === 0 ? (
            <p className="m-0 border-t border-line py-4 text-sm text-muted-foreground">No experience found on your resume.</p>
          ) : (
            values.experience.map((item, index) => (
              <Row
                key={`${item.company}-${index}`}
                order="value-first"
                value={[item.title, item.company].filter(Boolean).join(" · ")}
                label={[item.start, item.end ?? (item.start ? "now" : null)].filter(Boolean).join(" to ") || "Dates not listed"}
              />
            ))
          )}
        </SectionCard>

        <SectionCard
          title={`Skills · ${skills.length}`}
          action={
            <Button variant="underline" size="text" className="text-sm" onClick={() => setEditing(editing === "skills" ? null : "skills")}>
              {editing === "skills" ? "Done" : "Edit"}
            </Button>
          }
          className="pb-4"
        >
          {editing === "skills" ? (
            <div className="flex flex-col gap-2">
              <FieldLabel tone="small" htmlFor="skills">
                Separate skills with commas
              </FieldLabel>
              <TextAreaBox id="skills" autoFocus value={values.skills} onChange={(event) => setField("skills", event.target.value)} />
            </div>
          ) : skills.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No skills found. Tap Edit to add them.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((skill) => (
                <SkillTag key={skill}>{skill}</SkillTag>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Your fields" className="pb-4">
          <p className="m-0 mb-3 text-sm text-muted-foreground">
            Read from your resume. Matching reads your whole resume; these set the field filter in your feed.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {trackOptions.map((option) => {
              const selected = values.tracks.includes(option.id);
              return (
                <Chip
                  key={option.id}
                  type="button"
                  selected={selected}
                  aria-pressed={selected}
                  onClick={() =>
                    setValues((current) => ({
                      ...current,
                      tracks: selected ? current.tracks.filter((track) => track !== option.id) : [...current.tracks, option.id],
                    }))
                  }
                >
                  {option.label}
                </Chip>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Education">
          {values.education.length === 0 ? (
            <p className="m-0 border-t border-line py-4 text-sm text-muted-foreground">No education found on your resume.</p>
          ) : (
            values.education.map((item, index) => (
              <Row
                key={`${item.school}-${index}`}
                order="value-first"
                value={item.degree ? `${item.degree}` : item.school}
                label={[item.degree ? item.school : null, item.year ? `Graduated ${item.year}` : null].filter(Boolean).join(" · ") || "Year not listed"}
              />
            ))
          )}
        </SectionCard>

        {values.answers.length > 0 ? (
          <SectionCard title="Saved answers">
            {values.answers.map((row, index) => (
              <EditableRow
                key={row.key}
                label={row.question}
                value={row.answer}
                editing={editing === `answer-${row.key}`}
                onEdit={() => setEditing(`answer-${row.key}`)}
                onDone={() => setEditing(null)}
                onChange={(answer) => {
                  setValues((current) => ({
                    ...current,
                    answers: current.answers.map((item, itemIndex) => (itemIndex === index ? { ...item, answer } : item)),
                  }));
                  setStatus("idle");
                }}
              />
            ))}
          </SectionCard>
        ) : null}

        {status === "error" ? <FieldError>Could not save. Try again.</FieldError> : null}
        {status === "missing" ? <FieldError>Add your full name and email to continue.</FieldError> : null}
      </ScreenBody>
      <StickyFooter>
        <Button variant="primary" size="xl" className="w-full" disabled={status === "saving"} onClick={() => void save()}>
          {status === "saving" ? "Saving…" : "Looks right"}
        </Button>
      </StickyFooter>
    </>
  );
}
