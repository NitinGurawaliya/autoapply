// Saved answers that contradict what the profile, the resume or the user's standing answers prove. Prints to the
// terminal only (answers are personal: never written to a file). With --fix (owner, 10 Oct: "fix them"), each one is
// corrected: a profile fact takes the profile's value; a yes / no answer takes the proven one (source derived).
// npx tsx scripts/contradictions.ts [--fix]
import { db } from "../src/lib/db";
import { detectConcept } from "../src/modules/answers";
import { abroadAnswer } from "../src/modules/apply/abroad";
import { deriveAnswers, yesNoOf as yesNo } from "../src/modules/apply/derive";
import { SPONSORSHIP_ABROAD_KEY } from "../src/modules/apply/sponsorship";

const PROFILE_KEYS: Record<string, "city" | "country" | "phone" | "linkedin" | "github" | "portfolio" | "currentCompany" | "currentTitle"> = {
  city: "city", country: "country", phone: "phone", linkedin: "linkedin", github: "github", portfolio: "portfolio", current_company: "currentCompany", current_title: "currentTitle",
};

async function main() {
  const profiles = await db.profile.findMany({ where: { isTest: false } });
  let total = 0;
  const fix = process.argv.includes("--fix");
  const fixes: Array<{ id: string; answer: string; source: string }> = [];
  for (const profile of profiles) {
    const answers = await db.answer.findMany({ where: { userId: profile.userId }, orderBy: { updatedAt: "asc" } });
    const bank = new Map(answers.map((row) => [row.key, row]));
    // Without the standing sponsorship answer, the general one ("will you need sponsorship?") stands in, for review only.
    if (!bank.has(SPONSORSHIP_ABROAD_KEY) && bank.get("needs_sponsorship")) bank.set(SPONSORSHIP_ABROAD_KEY, { ...bank.get("needs_sponsorship")!, key: SPONSORSHIP_ABROAD_KEY });
    const found: string[] = [];
    for (const [key, field] of Object.entries(PROFILE_KEYS)) {
      const saved = bank.get(key)?.answer.trim();
      const actual = (profile[field] as string | null)?.trim();
      if (saved && actual && saved.toLowerCase() !== actual.toLowerCase()) {
        found.push(`${key}: saved "${saved}", profile says "${actual}" (the profile is used now; the saved one is stale)`);
        fixes.push({ id: bank.get(key)!.id, answer: actual, source: "resume" });
      }
    }
    const questions = answers.filter((row) => row.question && yesNo(row.answer));
    const derived = await deriveAnswers({ profile, fields: questions.map((row) => ({ selector: row.key, label: row.question!, type: "text" as const, required: true })) }).catch(() => new Map());
    for (const row of questions) {
      const saidYes = yesNo(row.answer);
      const worked = derived.get(row.question!);
      if (worked && yesNo(worked.answer) && yesNo(worked.answer) !== saidYes) {
        found.push(`${row.key}: "${row.question!.slice(0, 90)}" saved "${row.answer.slice(0, 40)}", but ${worked.basis.slice(0, 90)} → ${worked.answer}`);
        fixes.push({ id: row.id, answer: worked.answer, source: "derived" });
        continue;
      }
      const kind = detectConcept(row.question!);
      if (!kind) continue;
      const abroad = abroadAnswer({ kind, label: row.question!, required: false, profile, jobCountry: null, bank: (k) => bank.get(k) });
      if (abroad && "answer" in abroad && yesNo(abroad.answer) !== saidYes) {
        found.push(`${row.key}: "${row.question!.slice(0, 90)}" saved "${row.answer.slice(0, 40)}", but ${abroad.basis.slice(0, 90)} → ${abroad.answer}`);
        fixes.push({ id: row.id, answer: abroad.answer, source: "derived" });
      }
    }
    if (found.length === 0) continue;
    total += found.length;
    console.log(`\n${profile.fullName} (…${profile.userId.slice(-6)}, ${profile.city ?? "?"}, ${profile.country ?? "?"}): ${found.length}`);
    for (const line of found) console.log(`  - ${line}`);
  }
  console.log(`\n${total} contradictions in ${profiles.length} real profiles`);
  if (fix && fixes.length > 0) {
    // Only rows that came from the user's own answers (or an old resume read) are changed; the id pins each one.
    await db.$transaction(fixes.map((row) => db.answer.update({ where: { id: row.id }, data: { answer: row.answer, source: row.source } })));
    console.log(`fixed ${fixes.length}`);
  }
}
main().finally(() => db.$disconnect());
