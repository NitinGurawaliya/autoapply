import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAll } from "@/modules/answers";
import { CITIZENSHIP_KEY, CITIZENSHIP_QUESTION, RELOCATE_ABROAD_KEY, RELOCATE_ABROAD_OPTIONS, relocateAbroadQuestion } from "@/modules/apply/abroad";
import { SPONSORSHIP_ABROAD_KEY, SPONSORSHIP_ABROAD_OPTIONS, sponsorshipAbroadQuestion } from "@/modules/apply/sponsorship";
import { redirect } from "next/navigation";
import { Screen } from "@/components/patterns/layout";
import { QuestionsForm, type QuestionValues } from "./questions-form";

const LOCATIONS = ["India", "US", "Other"];

function valueOf(map: Map<string, string>, key: string) {
  return map.get(key) ?? "";
}

export default async function QuestionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const profile = await db.profile.findUnique({ where: { userId: user.id }, select: { id: true, country: true } });
  if (!profile) redirect("/onboarding/resume");

  const answers = await getAll(user.id);
  const map = new Map(answers.map((row) => [row.key, row.answer]));
  const preferred = valueOf(map, "preferred_location")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => LOCATIONS.includes(item));

  const initial: QuestionValues = {
    current_ctc: valueOf(map, "current_ctc"),
    expected_ctc: valueOf(map, "expected_ctc"),
    notice_period: valueOf(map, "notice_period"),
    employment_type: valueOf(map, "employment_type"),
    preferred_location: preferred,
    citizenship: valueOf(map, CITIZENSHIP_KEY),
    relocate_outside_home: valueOf(map, RELOCATE_ABROAD_KEY),
    sponsorship_outside_home: valueOf(map, SPONSORSHIP_ABROAD_KEY),
  };
  // The standing answers the agent uses on every form (modules/apply/abroad.ts, sponsorship.ts), asked here once so
  // no application stops for them; the wording is the agent's own.
  const home = profile.country?.trim() || "India";
  const standing = {
    home,
    citizenship: CITIZENSHIP_QUESTION,
    relocate: { question: relocateAbroadQuestion(home), options: RELOCATE_ABROAD_OPTIONS },
    sponsorship: { question: sponsorshipAbroadQuestion(home), options: SPONSORSHIP_ABROAD_OPTIONS },
  };
  return (
    <Screen>
      <QuestionsForm initial={initial} standing={standing} />
    </Screen>
  );
}
