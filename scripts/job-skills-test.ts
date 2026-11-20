// Offline checks for the job skills vocabulary (Phase M2). npx tsx scripts/job-skills-test.ts
import { candidateShows, candidateSkills, compareSkills, jobSkills, TECH_VOCAB, withImplied } from "../src/modules/jobs/skills";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((item, i) => item === b[i]);
const has = (list: string[], term: string) => list.includes(term);

// Word boundaries
const js = jobSkills("Frontend Engineer", "Strong JavaScript and TypeScript. Java is not used here.");
check("JavaScript found", has(js, "JavaScript"), js.join(", "));
check("Java only where written alone", has(js, "Java"));
check("Java not inside JavaScript", !has(jobSkills("Dev", "We use JavaScript daily."), "Java"));
check("C++ and C#", same(jobSkills("Engineer", "Experience in C++ or C# required."), ["C++", "C#"]));
check("no bare C or R", jobSkills("Engineer", "Series C startup. R&D team, C-suite exposure.").length === 0);
check(".NET not inside ASP.NET", same(jobSkills("Engineer", "ASP.NET Core services"), ["ASP.NET"]));

// English words that are also tech
check("Go beyond is not Go", !has(jobSkills("Engineer", "Go beyond the brief. We go the extra mile with Kafka."), "Go"));
check("Go in a list is Go", has(jobSkills("Backend Engineer", "Our stack: Python, Go, Kafka and PostgreSQL."), "Go"));
check("golang always Go", has(jobSkills("Backend Engineer", "You write golang every day."), "Go"));
check("rest of the team is not REST", !has(jobSkills("Engineer", "Work with the rest of the team."), "REST"));
check("REST APIs is REST", has(jobSkills("Engineer", "Design REST APIs."), "REST"));
check("restful is REST", has(jobSkills("Engineer", "Build restful services."), "REST"));
check("Spring alone, no list: not Spring", !has(jobSkills("Engineer", "Our office opens in Spring. Hiring now."), "Spring"));
check("Spring Boot is not also Spring", same(jobSkills("Engineer", "Java and Spring Boot microservices"), ["Java", "Spring Boot", "Microservices"]));
check("react to incidents is not React", !has(jobSkills("SRE", "You will react to incidents quickly."), "React"));
check("React Native is not also React", same(jobSkills("Mobile Engineer", "React Native and TypeScript"), ["React Native", "TypeScript"]));
check("excel at is not Excel", !has(jobSkills("Analyst", "You excel at communication."), "Excel"));
check("RAG acronym only in caps", !has(jobSkills("Engineer", "a rag-tag team"), "RAG") && has(jobSkills("AI Engineer", "Build RAG pipelines with LLMs"), "RAG"));
check("Express as a verb is not Express", !has(jobSkills("Engineer", "Express your ideas clearly to Node teams."), "Express"));
check("Express in a list is Express", has(jobSkills("Engineer", "Experience with Node.js, Express and MongoDB."), "Express"));

// Aliases
const aliases = jobSkills("Engineer", "Postgres, K8s, NodeJS, Next.js, GCP and TS-free JS.");
check("aliases canonicalise", ["PostgreSQL", "Kubernetes", "Node.js", "Next.js", "GCP", "JavaScript"].every((term) => has(aliases, term)) && !has(aliases, "TypeScript"), aliases.join(", "));

// Every term found is literally in the text (by one of its spellings)
const sample = `Full Stack Developer
Experience in backend application development. Strong experience with Angular or React. Good understanding of REST APIs and
microservices. Hands-on experience with Generative AI / LLM applications. Experience building RAG (Retrieval-Augmented Generation)
solutions. Experience with LLM integration, prompt engineering, and chatbot development. Good understanding of databases.
Bachelor's degree in computer science. Location: Bangalore. Java preferred.`;
const found = jobSkills("Full Stack Developer", sample);
const lower = sample.toLowerCase();
const literal = found.every((name) => {
  const term = TECH_VOCAB.find((item) => item.name === name)!;
  return [...(term.any ?? []), ...(term.exact ?? [])].some((spelling) => lower.includes(spelling.toLowerCase()));
});
check("Capco sample terms", same(found, ["Angular", "React", "REST", "Microservices", "Generative AI", "LLM", "RAG", "Prompt engineering", "Java"]), found.join(", "));
check("every term is in the text", literal);
check("limit respected", jobSkills("x", TECH_VOCAB.map((term) => term.any?.[0] ?? "").join(", "), 20).length === 20);
// From the 18 Nov hand check of 20 real jobs
check("HTML entities decoded: C&#43;&#43; is C++", has(jobSkills("Developer", "Languages such as C&#43;&#43;, Java, and Python."), "C++"));
check("BDD is BDD, not Cucumber", same(jobSkills("QA", "Quality: TDD, BDD, UML."), ["TDD", "BDD"]));
check("X++ is not C++", !has(jobSkills("D365 Developer", "Expertise in X&#43;&#43;, .NET/C#, SQL."), "C++"));

// The candidate side: skills list (any case) plus resume text
const candidate = candidateSkills({ skills: ["python", "React.js", "go", "Some Custom Tool"], resumeText: "Built a RAG chatbot with LangChain and PostgreSQL. Used Java at university." });
check("candidate skills list, any case", ["Python", "React", "Go"].every((term) => candidate.has(term)), [...candidate].join(", "));
check("candidate resume text counts", ["RAG", "LangChain", "PostgreSQL", "Java"].every((term) => candidate.has(term)));
const compared = compareSkills(found, ["Angular", "Java", "REST"], candidate);
check("have = job skills the candidate shows", same(compared.have, ["React", "RAG", "Java"]), compared.have.join(", "));
check("missing = required only, never one the candidate shows", same(compared.missing, ["Angular", "REST"]) && compared.split, compared.missing.join(", "));
const unsplit = compareSkills(found, null, candidate);
check("without labels, missing = all not shown", !unsplit.split && unsplit.missing.length === found.length - unsplit.have.length);
check("required outside the job's skills is ignored", compareSkills(["Python"], ["Rust"], new Set()).missing.length === 0);

// 20 Nov: a skill proves the ones under it (a React developer writes HTML and CSS); IMPLIES names only real ones.
const shows = candidateShows({ skills: ["Next.js", "TypeScript", "FastAPI", "PostgreSQL"] });
check("Next.js implies React, HTML, CSS and JavaScript", ["React", "HTML", "CSS", "JavaScript"].every((term) => shows.has(term)), [...shows].join(", "));
check("FastAPI implies Python, PostgreSQL implies SQL", shows.has("Python") && shows.has("SQL"));
check("nothing is implied the other way or sideways", !shows.has("Node.js") && !shows.has("Django") && !shows.has("Vue.js"));
check("a frontend job's HTML and CSS are not missing for a React resume", compareSkills(["React", "HTML", "CSS", "AWS"], ["HTML", "CSS", "AWS"], shows).missing.join() === "AWS");
check("the vocabulary names every implied skill", [...withImplied(new Set(TECH_VOCAB.map((t) => t.name)))].length === TECH_VOCAB.length);

console.log(`${failed === 0 ? "PASS" : "FAIL"} job-skills-test (${TECH_VOCAB.length} terms)`);
process.exit(failed === 0 ? 0 : 1);
