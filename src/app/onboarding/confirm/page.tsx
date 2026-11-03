import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAll } from "@/modules/answers";
import { CITIZENSHIP_KEY, RELOCATE_ABROAD_KEY } from "@/modules/apply/abroad";
import { SPONSORSHIP_ABROAD_KEY } from "@/modules/apply/sponsorship";
import { ACKNOWLEDGEMENT_KEY } from "@/modules/apply/acknowledgement";
import { TRACK_LABELS, TRACKS, tracksOf } from "@/modules/jobs";
import { profileSchema } from "@/modules/profile";
import { redirect } from "next/navigation";
import { Screen } from "@/components/patterns/layout";
import { ConfirmForm } from "./confirm-form";

/** What the questions step (onboarding/questions) saves. */
const ONBOARDING_KEYS = ["current_ctc", "expected_ctc", "notice_period", "employment_type", "preferred_location", CITIZENSHIP_KEY, RELOCATE_ABROAD_KEY, SPONSORSHIP_ABROAD_KEY, ACKNOWLEDGEMENT_KEY];

export default async function ConfirmPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const row = await db.profile.findUnique({ where: { userId: user.id } });
  if (!row) redirect("/onboarding/resume");

  const parsed = profileSchema.parse({
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    city: row.city,
    country: row.country,
    linkedin: row.linkedin,
    github: row.github,
    portfolio: row.portfolio,
    yearsExperience: row.yearsExperience,
    currentTitle: row.currentTitle,
    currentCompany: row.currentCompany,
    skills: row.skills,
    experience: row.experience,
    education: row.education,
  });
  // Saved answers are not on this page (2 Nov, owner: a replaced resume showed hundreds of them, and saving them all back
  // failed past 60). Someone who already answered the onboarding questions goes straight to the feed.
  const answered = new Set((await getAll(user.id)).filter((answer) => answer.answer.trim()).map((answer) => answer.key));
  const next = ONBOARDING_KEYS.every((key) => answered.has(key)) ? "/feed" : "/onboarding/questions";

  return (
    <Screen>
      <ConfirmForm
        next={next}
        trackOptions={TRACKS.map((id) => ({ id, label: TRACK_LABELS[id] }))}
        initial={{
          fullName: parsed.fullName,
          email: parsed.email,
          phone: parsed.phone ?? "",
          city: parsed.city ?? "",
          country: parsed.country ?? "",
          linkedin: parsed.linkedin ?? "",
          github: parsed.github ?? "",
          portfolio: parsed.portfolio ?? "",
          yearsExperience: parsed.yearsExperience == null ? "" : String(parsed.yearsExperience),
          currentTitle: parsed.currentTitle ?? "",
          currentCompany: parsed.currentCompany ?? "",
          skills: parsed.skills.join(", "),
          experience: parsed.experience,
          education: parsed.education,
          tracks: tracksOf(row),
        }}
      />
    </Screen>
  );
}
