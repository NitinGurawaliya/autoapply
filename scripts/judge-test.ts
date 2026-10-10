// The model's job verdicts (modules/jobs/semantic.ts judgeBatch) on labelled pairs: field (developer vs sales, ML vs
// frontend, security vs data) and level (fresher vs senior, overqualified). Live: one model call per candidate, nothing
// stored. Each case lists the verdicts that count as right. npx tsx scripts/judge-test.ts
import { judgeBatch } from "../src/modules/jobs/semantic";

type Fit = "strong" | "good" | "stretch" | "no";
type Case = { title: string; needs: string; ok: Fit[] };
const candidates: Array<{ name: string; summary: string; years: number; cases: Case[] }> = [
  {
    name: "fresher MERN developer",
    years: 0,
    summary: "Full Stack Developer Intern, 0 years of experience\nSkills: React, Node.js, Express, MongoDB, JavaScript, TypeScript, HTML, CSS\nFull Stack Developer Intern: built React dashboards and Node.js REST APIs\nB.Tech, Computer Science",
    cases: [
      { title: "Software Development Engineer Intern", needs: "Students graduating in 2026 or 2027. JavaScript or any language.", ok: ["strong", "good"] },
      { title: "Graduate Software Engineer", needs: "New graduates. 0-1 years of experience. React, Node.js.", ok: ["strong", "good"] },
      { title: "Frontend Engineer", needs: "0-2 years of experience with React and TypeScript.", ok: ["strong", "good"] },
      { title: "Software Engineer II - Full Stack", needs: "3+ years of experience building web applications with React and Node.js.", ok: ["stretch", "no"] },
      { title: "Senior Backend Engineer", needs: "6+ years of experience with distributed systems in Go.", ok: ["no"] },
      { title: "Staff Software Engineer", needs: "10+ years of experience leading large systems.", ok: ["no"] },
      { title: "Sales Development Representative", needs: "Generate pipeline through outbound calls.", ok: ["no"] },
      { title: "Product Manager, Developer Platform", needs: "Own the roadmap for our developer platform. 3+ years in product management.", ok: ["no"] },
    ],
  },
  {
    name: "6-year software engineer",
    years: 6,
    summary: "Senior Software Engineer, 6 years of experience\nSkills: Java, Spring Boot, PostgreSQL, Kafka, AWS, TypeScript\nSenior Software Engineer: payments services in Java and Kafka\nSoftware Engineer: REST APIs and PostgreSQL",
    cases: [
      { title: "Senior Software Engineer", needs: "5+ years of experience with Java and distributed systems.", ok: ["strong"] },
      { title: "Staff Software Engineer, Payments", needs: "8+ years of experience; Java, Kafka.", ok: ["good", "stretch"] },
      { title: "Junior Web Developer", needs: "0-1 years of experience. HTML, CSS, JavaScript.", ok: ["no", "stretch"] },
      { title: "Software Engineering Intern", needs: "Students in their final year.", ok: ["no"] },
      { title: "Account Executive, Enterprise", needs: "Close enterprise deals. 5+ years of SaaS sales.", ok: ["no"] },
    ],
  },
  {
    name: "2-year data scientist",
    years: 2,
    summary: "Data Scientist, 2 years of experience\nSkills: Python, Pandas, SQL, Statistics, scikit-learn, A/B testing, Tableau\nData Scientist: churn models and experiment analysis\nData Analyst Intern: SQL dashboards",
    cases: [
      { title: "Data Scientist", needs: "2+ years of experience. Python, SQL, statistics, experimentation.", ok: ["strong", "good"] },
      { title: "Product Analyst", needs: "1-3 years. SQL, dashboards, A/B tests.", ok: ["strong", "good", "stretch"] },
      { title: "Senior Frontend Engineer", needs: "5+ years React and TypeScript.", ok: ["no"] },
      { title: "Machine Learning Engineer", needs: "2+ years building ML models in Python; deploying to production.", ok: ["good", "stretch"] },
      { title: "Recruiter, Engineering", needs: "Hire engineers.", ok: ["no"] },
    ],
  },
  {
    name: "3-year security engineer",
    years: 3,
    summary: "Security Engineer, 3 years of experience\nSkills: SIEM, Splunk, incident response, threat hunting, AWS security, Python\nSecurity Engineer: SOC detections and incident response\nSOC Analyst: alert triage",
    cases: [
      { title: "Security Engineer, Detection & Response", needs: "2-4 years in incident response and detection engineering.", ok: ["strong", "good"] },
      { title: "SOC Analyst II", needs: "2+ years in a SOC; SIEM experience.", ok: ["strong", "good"] },
      { title: "Application Security Engineer", needs: "3+ years in application security, code review, threat modeling.", ok: ["good", "stretch"] },
      { title: "Frontend Engineer", needs: "3+ years of React.", ok: ["no", "stretch"] },
      { title: "Director, Security Engineering", needs: "12+ years; lead a team of 30.", ok: ["no"] },
    ],
  },
  {
    name: "2-year ML engineer",
    years: 2,
    summary: "Machine Learning Engineer, 2 years of experience\nSkills: Python, PyTorch, Transformers, LLMs, RAG, MLflow, Docker\nMachine Learning Engineer: fine-tuned LLMs and built RAG search\nResearch intern: NLP models",
    cases: [
      { title: "Applied AI Engineer", needs: "1-3 years building LLM applications, RAG and evaluation.", ok: ["strong", "good"] },
      { title: "Machine Learning Engineer, NLP", needs: "2+ years with PyTorch and transformers.", ok: ["strong", "good"] },
      { title: "Data Scientist, Experimentation", needs: "2+ years of statistics and A/B testing.", ok: ["good", "stretch"] },
      { title: "Senior iOS Engineer", needs: "5+ years of Swift.", ok: ["no"] },
      { title: "Principal Machine Learning Scientist", needs: "10+ years of research leadership.", ok: ["no"] },
      { title: "Technical Writer", needs: "Write documentation for our ML platform.", ok: ["no"] },
    ],
  },
];

async function main() {
  let failed = 0;
  let total = 0;
  for (const candidate of candidates) {
    const verdicts = await judgeBatch({ summary: candidate.summary, years: candidate.years }, candidate.cases.map((c) => ({ title: c.title, description: c.needs })));
    candidate.cases.forEach((c, i) => {
      total += 1;
      const got = verdicts.get(i);
      const ok = !!got && c.ok.includes(got.fit);
      if (!ok) failed += 1;
      console.log(`${ok ? "ok  " : "FAIL"} ${candidate.name} · ${c.title} → ${got?.fit ?? "missing"} (want ${c.ok.join("/")})${got ? ` — ${got.why}` : ""}`);
    });
  }
  console.log(`${total - failed}/${total} right`);
  // The model is not perfectly repeatable; one miss in 30 is allowed, more means the prompt needs work.
  console.log(failed <= 1 ? "PASS judge" : `FAIL judge (${failed})`);
  process.exit(failed <= 1 ? 0 : 1);
}
main();
