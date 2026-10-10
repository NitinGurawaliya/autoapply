import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAll } from "@/modules/answers";
import { TitleTopBar } from "@/components/patterns/top-bar";
import { AnswersManager } from "./answers-manager";

export default async function AnswersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const rows = await getAll(user.id);
  return (
    <>
      <TitleTopBar
        title="Saved answers"
        sub="Everything we reuse when an application asks. Change a wrong one, or delete it and the next application asks you again."
      />
      <AnswersManager initial={rows.map((row) => ({ key: row.key, question: row.question, answer: row.answer, source: row.source }))} />
    </>
  );
}
