import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAll } from "@/modules/answers";
import { CITIZENSHIP_KEY, CITIZENSHIP_QUESTION } from "@/modules/apply/abroad";
import { ACKNOWLEDGEMENT_KEY, ACKNOWLEDGEMENT_QUESTION } from "@/modules/apply/acknowledgement";
import { ADJACENT_TRACKS, feedTracks, TRACK_LABELS, TRACKS, tracksOf } from "@/modules/jobs";
import { profileSchema } from "@/modules/profile";
import { redirect } from "next/navigation";
import { Screen } from "@/components/patterns/layout";
import { ShareJobStrip } from "@/components/patterns/share-job-strip";
import { intentJob } from "@/modules/share";
import { ConfirmForm, type ApplyAnswers } from "./confirm-form";

/**
 * What onboarding saves with the profile (Phase S, docs/onboarding/TDD.md 3). Moving abroad and sponsorship are no longer
 * asked up front: the agent asks them on the form of a job abroad that needs them (modules/apply/abroad.ts).
 */
const ONBOARDING_KEYS = ["current_ctc", "expected_ctc", "notice_period", "employment_type", "preferred_location", CITIZENSHIP_KEY, ACKNOWLEDGEMENT_KEY];

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
  const saved = new Map((await getAll(user.id)).filter((answer) => answer.answer.trim()).map((answer) => [answer.key, answer.answer.trim()]));
  // The few answers every form needs, on this screen when any is missing (a new user); pre-filled where the resume or a
  // default settles them, shown so the user confirms them. Under a year of experience: no current pay, free to join now.
  const fresher = (row.yearsExperience ?? 0) < 1;
  const country = row.country?.trim() || "India";
  const answers: ApplyAnswers = {
    show: !ONBOARDING_KEYS.every((key) => saved.has(key)),
    current_ctc: saved.get("current_ctc") ?? (fresher ? "0" : ""),
    expected_ctc: saved.get("expected_ctc") ?? "",
    notice_period: saved.get("notice_period") ?? (fresher ? "0" : ""),
    employment_type: saved.get("employment_type") ?? "Full-time",
    preferred_location: saved.get("preferred_location") ?? (/^india$/i.test(country) ? "India" : "Other"),
    citizenship: saved.get(CITIZENSHIP_KEY) ?? country,
    accept_acknowledgements: saved.get(ACKNOWLEDGEMENT_KEY) ?? "Yes",
    citizenshipQuestion: CITIZENSHIP_QUESTION,
    acknowledgementKey: ACKNOWLEDGEMENT_KEY,
    acknowledgementQuestion: ACKNOWLEDGEMENT_QUESTION,
  };

  // Arrived from a share link's Apply (Phase U4): the job stays in view, and Save goes back to it instead of the feed.
  const job = await intentJob();

  return (
    <Screen>
      {job ? <ShareJobStrip company={job.company} logoUrl={job.logoUrl} title={job.title} /> : null}
      <ConfirmForm
        next={job ? { href: job.path } : undefined}
        answers={answers}
        trackOptions={TRACKS.map((id) => ({ id, label: TRACK_LABELS[id] }))}
        // What the resume suggests today, offered when it differs from the saved fields (Phase N1).
        suggestedTracks={tracksOf({ ...row, tracks: [] })}
        // What "Also show nearby fields" adds to each field: its adjacent tracks the feed does not already show.
        nearbyTracks={Object.fromEntries(TRACKS.map((id) => [id, ADJACENT_TRACKS[id].filter((track) => !feedTracks([id])?.includes(track))]))}
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
          showNearby: row.showNearby,
          avoid: row.avoid,
        }}
      />
    </Screen>
  );
}
