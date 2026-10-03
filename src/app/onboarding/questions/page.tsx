import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAll } from "@/modules/answers";
import { redirect } from "next/navigation";
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
  const saved = answers.some((row) =>
    ["current_ctc", "expected_ctc", "notice_period", "employment_type", "preferred_location"].includes(row.key),
  );

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Common questions</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {saved ? "Your saved answers are filled in." : "Nothing saved yet. These stay in your answer bank."}
        </p>
      </div>
      <QuestionsForm initial={initial} />
    </main>
  );
}
