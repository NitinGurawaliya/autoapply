import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAll } from "@/modules/answers";
import { AnswersManager } from "./answers-manager";

export default async function AnswersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  const rows = await getAll(user.id);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saved answers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything we reuse when an application asks. Change a wrong one, or delete it and the next application asks you again.
        </p>
      </div>
      <AnswersManager initial={rows.map((row) => ({ key: row.key, question: row.question, answer: row.answer, source: row.source }))} />
    </>
  );
}
