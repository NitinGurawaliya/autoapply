import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAll } from "@/modules/answers";
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
  const profile = await db.profile.findUnique({ where: { userId: user.id }, select: { id: true } });
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
    work_authorization: valueOf(map, "work_authorization"),
    needs_sponsorship: valueOf(map, "needs_sponsorship"),
  };
  return (
    <Screen>
      <QuestionsForm initial={initial} />
    </Screen>
  );
}
