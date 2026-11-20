"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { CheckRow } from "@/components/ui/check-row";
import { ChipGroup } from "@/components/patterns/chip-group";
import { Chip, SkillTag } from "@/components/ui/chip";
import { FieldError, FieldLabel, InputBox, TextAreaBox } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { Row, SectionCard } from "@/components/patterns/content";
import { PageIntro, ScreenBody, StepHeader, StickyFooter } from "@/components/patterns/layout";

type Experience = { title: string; company: string; start: string | null; end: string | null; summary: string | null };
type Education = { school: string; degree: string | null; year: string | null };

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
  /** "Also show nearby fields" (Profile.showNearby, P4): adjacent tracks join the feed's. */
  showNearby: boolean;
  /** "Never show me" (Profile.avoid, P4): contract, intern, commission_only. */
  avoid: string[];
};

/**
 * The few answers every application form needs, saved with the profile (Phase S, docs/onboarding/TDD.md 3). `show`: some
 * are missing (a new user). Pre-filled where the resume or a default settles them; the user sees and confirms them all.
 */
export type ApplyAnswers = {
  show: boolean;
  current_ctc: string;
  expected_ctc: string;
  notice_period: string;
  employment_type: string;
  preferred_location: string;
  citizenship: string;
  accept_acknowledgements: string;
  citizenshipQuestion: string;
  acknowledgementKey: string;
  acknowledgementQuestion: string;
};

// Notice period is saved in days; "Immediate" is 0.
const NOTICE = [
  { label: "Immediate", value: "0" },
  { label: "15 days", value: "15" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
];
const EMPLOYMENT = ["Full-time", "Part-time", "Contract", "Internship"];
const PLACES = ["India", "US", "Other"];

/** "Fresher · 2 internships", "3 years · 4 roles": the level in words. */
function levelOf(years: number | null, experience: Array<{ title: string }>) {
  const roles = experience.length;
  const interns = experience.filter((role) => /\bintern/i.test(role.title)).length;
  if (years == null || years < 1) {
    if (interns > 0) return `Fresher · ${interns} ${interns === 1 ? "internship" : "internships"}`;
    return roles > 0 ? `Fresher · ${roles} ${roles === 1 ? "role" : "roles"}` : "Fresher";
  }
  return `${years} ${years === 1 ? "year" : "years"}${roles > 0 ? ` · ${roles} ${roles === 1 ? "role" : "roles"}` : ""}`;
}

// After saving, a full load of the feed (not router.push): it shows the agent reading while the first set is built.
const FEED = "/feed";

/** "Never show me" choices (modules/jobs/gate.ts AVOIDS). */
const AVOID_OPTIONS = [
  { id: "contract", label: "Contract roles" },
  { id: "intern", label: "Internships" },
  { id: "commission_only", label: "Commission only" },
];

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

/** Step 2 of onboarding (design/onboarding.html "Here's what we found"). */
type ResumeChanges = {
  replaced: boolean;
  skillsAdded: string[];
  skillsRemoved: string[];
  rolesAdded: string[];
  rolesRemoved: string[];
  title: { from: string | null; to: string | null } | null;
  educationChanged: boolean;
  keptCore: string[];
};

const CORE_LABELS: Record<string, string> = { fullName: "name", email: "email", phone: "phone", city: "city", country: "country", linkedin: "LinkedIn", github: "GitHub", portfolio: "portfolio" };

const readChanges = () => {
  try {
    return sessionStorage.getItem("resume-changes");
  } catch {
    return null;
  }
};

/** After "Replace resume": what the new resume changed and what stayed, before anything is used (18 Oct, owner). */
function ResumeChangesPanel() {
  const raw = useSyncExternalStore(() => () => undefined, readChanges, () => null);
  let changes: ResumeChanges | null = null;
  try {
    changes = raw ? (JSON.parse(raw) as ResumeChanges) : null;
  } catch {
    changes = null;
  }
  if (!changes?.replaced) return null;
  const kept = changes.keptCore.map((field) => CORE_LABELS[field] ?? field);
  const nothing = !changes.skillsAdded.length && !changes.skillsRemoved.length && !changes.rolesAdded.length && !changes.rolesRemoved.length && !changes.title && !changes.educationChanged;
  return (
    <SectionCard title="What changed with your new resume">
      <div className="flex flex-col gap-2.5 pb-2 text-sm leading-normal">
        <p className="m-0 text-muted-foreground">
          Your details stay as they were{kept.length ? `: your resume shows a different ${kept.join(", ")}, and we kept yours` : ""}. Your saved answers stay as they are.
        </p>
        {nothing ? <p className="m-0">The skills, roles and education read the same as before.</p> : null}
        {changes.title ? (
          <p className="m-0">
            Current title: {changes.title.from ?? "none"} → <span className="font-semibold">{changes.title.to ?? "none"}</span>
          </p>
        ) : null}
        {changes.rolesAdded.length ? <p className="m-0">New roles: <span className="font-semibold">{changes.rolesAdded.join("; ")}</span></p> : null}
        {changes.rolesRemoved.length ? <p className="m-0 text-muted-foreground">No longer listed: {changes.rolesRemoved.join("; ")}</p> : null}
        {changes.skillsAdded.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span>New skills:</span>
            {changes.skillsAdded.slice(0, 12).map((skill) => (
              <SkillTag key={`add-${skill}`}>{skill}</SkillTag>
            ))}
          </div>
        ) : null}
        {changes.skillsRemoved.length ? <p className="m-0 text-muted-foreground">Skills no longer listed: {changes.skillsRemoved.slice(0, 12).join(", ")}</p> : null}
        {changes.educationChanged ? <p className="m-0">Education updated from the new resume.</p> : null}
      </div>
    </SectionCard>
  );
}

/**
 * Only what was read from the resume, to check: saved answers are not here (the Answers page has them), and saving
 * sends the profile alone; a detail changed here updates its answer on the server (api/profile PUT).
 */
export function ConfirmForm({
  initial,
  answers: initialAnswers,
  trackOptions,
  suggestedTracks = [],
  nearbyTracks = {},
}: {
  initial: ConfirmValues;
  answers: ApplyAnswers;
  trackOptions: Array<{ id: string; label: string }>;
  suggestedTracks?: string[];
  /** Each track's adjacent tracks (modules/jobs/functions.ts ADJACENT), to name what "nearby" adds. */
  nearbyTracks?: Record<string, string[]>;
}) {
  const [values, setValues] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "missing" | "answers">("idle");
  // Link fields the server refused as not an address (e2e finding 10): named, so the user can fix them.
  const [badLinks, setBadLinks] = useState<string[]>([]);
  // The phone card shows when the resume had no number, and stays while it is being typed.
  const [askPhone] = useState(!initial.phone.trim());
  const [answers, setAnswers] = useState(initialAnswers);
  // The full details open by themselves only when something must be fixed before saving (no name or email).
  const [details, setDetails] = useState(!initial.fullName.trim() || !initial.email.trim());
  // What "Also show nearby fields" adds for the fields picked now, by name.
  const nearby = [...new Set(values.tracks.flatMap((track) => nearbyTracks[track] ?? []))].filter((track) => !values.tracks.includes(track));
  const nearbyHint =
    values.tracks.length === 0
      ? "Pick a field above first"
      : nearby.length === 0
        ? "No fields next to yours"
        : `Adds ${nearby.map((id) => trackOptions.find((option) => option.id === id)?.label ?? id).join(", ")}`;

  function setField(key: keyof ConfirmValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus("idle");
  }

  function setAnswer(key: keyof ApplyAnswers, value: string) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setStatus("idle");
  }

  // The required answers still empty, named in the error (an experienced user has three to fill, a fresher one).
  const unanswered = [
    answers.expected_ctc.trim() ? null : "expected CTC",
    answers.current_ctc.trim() ? null : "current CTC",
    answers.notice_period.trim() ? null : "notice period",
  ].filter((item): item is string => item !== null);
  const unansweredText = unanswered.length > 1 ? `${unanswered.slice(0, -1).join(", ")} and ${unanswered[unanswered.length - 1]}` : (unanswered[0] ?? "");

  async function save() {
    if (!values.fullName.trim() || !values.email.trim()) {
      setDetails(true);
      setStatus("missing");
      return;
    }
    if (answers.show && unanswered.length > 0) {
      setStatus("answers");
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
      showNearby: values.showNearby,
      avoid: values.avoid,
    };
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }).catch(() => null);
    if (!response?.ok) {
      const body = response?.status === 400 ? ((await response.json().catch(() => null)) as { error?: string; fields?: string[] } | null) : null;
      setBadLinks(body?.error === "invalid_link" ? (body.fields ?? []) : []);
      setStatus("error");
      return;
    }
    setBadLinks([]);
    // The answers every form needs, as the user confirmed them here (source "user").
    if (answers.show) {
      const rows = [
        { key: "current_ctc", question: "Current CTC", answer: answers.current_ctc.trim() },
        { key: "expected_ctc", question: "Expected CTC", answer: answers.expected_ctc.trim() },
        { key: "notice_period", question: "Notice period", answer: answers.notice_period.trim() },
        { key: "employment_type", question: "Employment type", answer: answers.employment_type },
        { key: "preferred_location", question: "Preferred location", answer: answers.preferred_location },
        { key: "citizenship", question: answers.citizenshipQuestion, answer: answers.citizenship.trim().slice(0, 200) },
        { key: answers.acknowledgementKey, question: answers.acknowledgementQuestion, answer: answers.accept_acknowledgements },
      ].filter((row) => row.answer);
      const saved = await fetch("/api/answers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: rows.map((row) => ({ ...row, source: "user" })) }),
      }).catch(() => null);
      if (!saved?.ok) {
        setStatus("error");
        return;
      }
    }
    // A full load, not router.push after forgetVisitedPages: that server action re-rendered this page, and the refresh
    // often won over the push, leaving the user here with the profile saved (e2e 18 Nov, 3 of 6 tries). A full load
    // also starts with no kept pages, which is what forgetting them was for.
    // Straight to the feed: a full load shows the agent reading while today's set is built (Phase R, R4).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load on purpose (above)
    window.location.assign(FEED);
  }

  const skills = values.skills.split(",").map((item) => item.trim()).filter(Boolean);
  const years = Number(values.yearsExperience);

  return (
    <>
      <StepHeader step={2} of={2} backHref="/onboarding/resume" />
      <ScreenBody className="gap-4 overflow-y-auto pb-5">
        <PageIntro title="Your profile" sub="Read from your resume. Change anything now or later." />
        <ResumeChangesPanel />

        {askPhone ? (
          <div className="box-border flex flex-col gap-3 rounded-panel border border-dashed border-line-strong bg-surface p-4">
            <div className="flex items-center gap-2.5">
              <Icon name="info" size={20} className="flex-none" />
              <span className="type-body font-semibold">We couldn&apos;t find your phone number</span>
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

        {/* What was read, in a few lines (Phase S): name, title and level, the fields the feed shows, the skills. */}
        <SectionCard
          title="From your resume"
          action={
            <Button variant="underline" size="text" className="text-sm" aria-expanded={details} onClick={() => setDetails(!details)}>
              {details ? "Hide details" : "Edit details"}
            </Button>
          }
          className="pb-4"
        >
          <div className="flex flex-col gap-1.5">
            <p className="m-0 type-section">{values.fullName || "Your name"}</p>
            <p className="m-0 type-body text-muted-foreground">
              {[values.currentTitle, levelOf(values.yearsExperience.trim() === "" ? null : Number(values.yearsExperience), values.experience)].filter(Boolean).join(" · ")}
            </p>
            {values.tracks.length > 0 ? (
              <p className="m-0 type-body">
                <span className="text-muted-foreground">Jobs in </span>
                {values.tracks.map((id) => trackOptions.find((option) => option.id === id)?.label ?? id).join(", ")}
              </p>
            ) : null}
            {skills.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {skills.slice(0, 8).map((skill) => (
                  <SkillTag key={skill}>{skill}</SkillTag>
                ))}
                {skills.length > 8 ? <span className="self-center type-meta text-muted-foreground">+{skills.length - 8}</span> : null}
              </div>
            ) : null}
          </div>
        </SectionCard>

        {details ? (
          <>
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
          {suggestedTracks.length > 0 &&
          (suggestedTracks.length !== values.tracks.length || suggestedTracks.some((track) => !values.tracks.includes(track))) ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-control bg-background px-3 py-2.5">
              <p className="m-0 type-meta text-muted-foreground">
                Your resume suggests{" "}
                <span className="font-semibold text-foreground">
                  {suggestedTracks.map((id) => trackOptions.find((option) => option.id === id)?.label ?? id).join(", ")}
                </span>
              </p>
              <button
                type="button"
                className="flex-none type-meta font-bold underline underline-offset-2"
                onClick={() => setValues((current) => ({ ...current, tracks: [...suggestedTracks] }))}
              >
                Use these
              </button>
            </div>
          ) : null}
          <CheckRow
            className="mt-3 border-t border-line pt-2"
            title="Also show nearby fields"
            hint={nearbyHint}
            checked={values.showNearby}
            onChange={(event) => setValues((current) => ({ ...current, showNearby: event.target.checked }))}
          />
          <div className="mt-2 border-t border-line pt-3">
            <p id="never-show" className="m-0 mb-2 type-meta font-medium">
              Never show me
            </p>
            <div role="group" aria-labelledby="never-show" className="flex flex-wrap gap-1.5">
              {AVOID_OPTIONS.map((option) => {
                const selected = values.avoid.includes(option.id);
                return (
                  <Chip
                    key={option.id}
                    type="button"
                    selected={selected}
                    aria-pressed={selected}
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        avoid: selected ? current.avoid.filter((item) => item !== option.id) : [...current.avoid, option.id],
                      }))
                    }
                  >
                    {option.label}
                  </Chip>
                );
              })}
            </div>
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

        {answers.show ? (
          <SectionCard title="What you're looking for" className="pb-4">
            <div className="flex flex-col gap-4">
              <ChipGroup
                legend="Kind of job"
                options={EMPLOYMENT.map((kind) => ({ label: kind, selected: answers.employment_type === kind, onSelect: () => setAnswer("employment_type", kind) }))}
              />
              <ChipGroup
                legend="Where"
                options={PLACES.map((place) => {
                  const picked = answers.preferred_location.split(",").map((item) => item.trim()).filter(Boolean);
                  const selected = picked.includes(place);
                  return { label: place, selected, onSelect: () => setAnswer("preferred_location", (selected ? picked.filter((item) => item !== place) : [...picked, place]).join(",")) };
                })}
              />
              <div className="flex flex-col gap-2">
                <FieldLabel tone="small" htmlFor="citizenship">
                  Citizen of
                </FieldLabel>
                <InputBox id="citizenship" tone="soft" value={answers.citizenship} onChange={(event) => setAnswer("citizenship", event.target.value)} />
              </div>
            </div>
          </SectionCard>
        ) : null}
          </>
        ) : null}

        {/* The few answers every application form asks (Phase S): most people type only their expected pay. */}
        {answers.show ? (
          <SectionCard title="For your applications" className="pb-4">
            <p className="m-0 mb-4 type-meta text-muted-foreground">Forms ask these. They go only to jobs you swipe right on.</p>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="expected_ctc">Expected CTC</FieldLabel>
                <InputBox id="expected_ctc" inputMode="decimal" prefix="₹" suffix="lakh a year" value={answers.expected_ctc} onChange={(event) => setAnswer("expected_ctc", event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="current_ctc">Current CTC</FieldLabel>
                <InputBox id="current_ctc" inputMode="decimal" prefix="₹" suffix="lakh a year" value={answers.current_ctc} onChange={(event) => setAnswer("current_ctc", event.target.value)} />
              </div>
              <ChipGroup
                legend="Notice period"
                options={NOTICE.map((option) => ({ label: option.label, selected: answers.notice_period.trim() === option.value, onSelect: () => setAnswer("notice_period", option.value) }))}
              />
              <CheckRow
                className="border-t border-line pt-2"
                title="Let my agent accept routine consents"
                hint="Privacy notices and “my answers are true” declarations. Never marketing opt-ins or statements about you."
                checked={answers.accept_acknowledgements === "Yes"}
                onChange={(event) => setAnswer("accept_acknowledgements", event.target.checked ? "Yes" : "No")}
              />
            </div>
          </SectionCard>
        ) : null}

        {status === "error" ? (
          <FieldError>
            {badLinks.length > 0
              ? `${badLinks.map((key) => ({ linkedin: "LinkedIn", github: "GitHub", portfolio: "Portfolio" })[key] ?? key).join(" and ")} ${badLinks.length === 1 ? "isn't a web address" : "aren't web addresses"}. Fix or clear ${badLinks.length === 1 ? "it" : "them"}.`
              : "Could not save. Try again."}
          </FieldError>
        ) : null}
        {status === "missing" ? <FieldError>Add your full name and email to continue.</FieldError> : null}
      </ScreenBody>
      <StickyFooter>
        {/* Next to the button, so it is seen on a phone (it used to sit below the fold). */}
        {status === "answers" && unanswered.length > 0 ? <FieldError className="mb-2.5">Add your {unansweredText} to continue.</FieldError> : null}
        <Button variant="primary" size="xl" className="w-full" disabled={status === "saving"} onClick={() => void save()}>
          {status === "saving" ? "Saving…" : answers.show ? "Start swiping" : "Looks right"}
        </Button>
      </StickyFooter>
    </>
  );
}
