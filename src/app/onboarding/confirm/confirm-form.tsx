"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
  answers: Answer[];
};

function text(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function ConfirmForm({ initial }: { initial: ConfirmValues }) {
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function setField(key: keyof ConfirmValues, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setStatus("idle");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
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
    setStatus(profileRes.ok && answersRes.ok ? "saved" : "error");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Full name" value={values.fullName} onChange={(value) => setField("fullName", value)} />
      <Field label="Email" value={values.email} onChange={(value) => setField("email", value)} />
      <Field label="Phone" value={values.phone} onChange={(value) => setField("phone", value)} />
      <Field label="City" value={values.city} onChange={(value) => setField("city", value)} />
      <Field label="Country" value={values.country} onChange={(value) => setField("country", value)} />
      <Field label="LinkedIn" value={values.linkedin} onChange={(value) => setField("linkedin", value)} />
      <Field label="GitHub" value={values.github} onChange={(value) => setField("github", value)} />
      <Field label="Portfolio" value={values.portfolio} onChange={(value) => setField("portfolio", value)} />
      <Field label="Years" value={values.yearsExperience} onChange={(value) => setField("yearsExperience", value)} />
      <Field label="Current title" value={values.currentTitle} onChange={(value) => setField("currentTitle", value)} />
      <Field label="Current company" value={values.currentCompany} onChange={(value) => setField("currentCompany", value)} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="skills">Skills</Label>
        <Textarea id="skills" value={values.skills} onChange={(event) => setField("skills", event.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Experience</p>
        {values.experience.length === 0 ? (
          <p className="text-sm text-muted-foreground">No experience extracted.</p>
        ) : (
          values.experience.map((item, index) => (
            <p key={`${item.company}-${index}`} className="text-sm">
              {item.title} — {item.company}
            </p>
          ))
        )}
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Answers</p>
        {values.answers.map((row, index) => (
          <div key={row.key} className="flex flex-col gap-2">
            <Label htmlFor={`answer-${row.key}`}>{row.question}</Label>
            <Input
              id={`answer-${row.key}`}
              value={row.answer}
              onChange={(event) => {
                const answer = event.target.value;
                setValues((current) => ({
                  ...current,
                  answers: current.answers.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, answer } : item,
                  ),
                }));
                setStatus("idle");
              }}
            />
          </div>
        ))}
      </div>
      {status === "error" ? (
        <p className="rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
          Could not save. Try again.
        </p>
      ) : null}
      {status === "saved" ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
      <Button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} required={label === "Full name" || label === "Email"} />
    </div>
  );
}
