import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAll } from "@/modules/answers";
import { profileSchema } from "@/modules/profile";
import { redirect } from "next/navigation";
import { Screen } from "@/components/patterns/layout";
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
    <Screen>
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
    </Screen>
  );
}
