import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAll } from "@/modules/answers";
import { profileSchema } from "@/modules/profile";
import { redirect } from "next/navigation";
import { ConfirmForm } from "./confirm-form";

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
  const answers = await getAll(user.id);

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Confirm profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Edit anything that is wrong, then save.</p>
      </div>
      <ConfirmForm
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
          answers: answers.map((answer) => ({
            key: answer.key,
            question: answer.question,
            answer: answer.answer,
            source: answer.source,
          })),
        }}
      />
      <a href="/onboarding/questions" className="text-sm font-medium underline underline-offset-4">
        Continue to questions
      </a>
    </main>
  );
}
