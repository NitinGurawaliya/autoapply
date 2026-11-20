/**
 * The tech skills a posting names, and the ones a candidate shows (Phase M2, docs/job-match/TDD.md §3, §4.1).
 *
 * Accuracy over coverage (owner, 18 Nov: "it should never make things up"): a job's skills are only terms from this
 * fixed list that literally appear in its title or description. Words that are also plain English ("Go", "REST",
 * "Spring", "Excel") match only in their tech spelling, and the riskiest only inside a list of other tech terms.
 * Missing a term is acceptable; inventing one is not. Shared with Phase L's resume keywords (resume-tailoring TDD).
 */

type Term = {
  /** The canonical name shown to the user and stored on Job.skills. */
  name: string;
  /** Spellings matched case-insensitively. */
  any?: string[];
  /** Spellings matched with this exact case (acronyms, words that are also English). */
  exact?: string[];
  /** The `exact` spellings count only next to another tech term (within LIST_REACH characters) and never as the
   * first word of a sentence: "Go, Rust and Kafka", not "Go beyond". */
  listOnly?: boolean;
};

const LIST_REACH = 60;

export const TECH_VOCAB: readonly Term[] = [
  // Languages
  { name: "JavaScript", any: ["javascript", "java script", "ecmascript", "es6"], exact: ["JS"] },
  { name: "TypeScript", any: ["typescript"] },
  { name: "Python", any: ["python", "python3"] },
  { name: "Java", any: ["java", "java 8", "java 11", "java 17", "core java"] },
  { name: "Kotlin", any: ["kotlin"] },
  { name: "Scala", any: ["scala"] },
  { name: "Go", any: ["golang", "go lang"], exact: ["Go"], listOnly: true },
  { name: "Rust", any: ["rustlang"], exact: ["Rust"], listOnly: true },
  { name: "C++", any: ["c++", "cpp"] },
  { name: "C#", any: ["c#", "csharp", "c sharp"] },
  { name: "Ruby", any: ["ruby"] },
  { name: "PHP", any: ["php"] },
  { name: "Swift", any: ["swift 5", "swift ui"], exact: ["Swift"], listOnly: true },
  { name: "SwiftUI", any: ["swiftui"] },
  { name: "Objective-C", any: ["objective-c", "objective c", "objc"] },
  { name: "Dart", exact: ["Dart"], listOnly: true },
  { name: "Elixir", any: ["elixir"] },
  { name: "Haskell", any: ["haskell"] },
  { name: "Perl", any: ["perl"] },
  { name: "Julia", exact: ["Julia"], listOnly: true },
  { name: "MATLAB", any: ["matlab"] },
  { name: "Solidity", any: ["solidity"] },
  { name: "Bash", any: ["bash", "shell scripting", "shell script", "shell scripts"] },
  { name: "PowerShell", any: ["powershell"] },
  { name: "SQL", any: ["sql"] },
  { name: "PL/SQL", any: ["pl/sql", "plsql"] },
  { name: "Embedded C", any: ["embedded c"] },
  { name: "Verilog", any: ["verilog", "systemverilog"] },
  { name: "VHDL", any: ["vhdl"] },

  // Frontend
  { name: "HTML", any: ["html", "html5"] },
  { name: "CSS", any: ["css", "css3"] },
  { name: "Sass", any: ["sass", "scss"] },
  { name: "Tailwind CSS", any: ["tailwind", "tailwindcss", "tailwind css"] },
  { name: "Bootstrap", any: ["bootstrap"] },
  { name: "React", any: ["react.js", "reactjs", "react js"], exact: ["React"] },
  { name: "React Native", any: ["react native", "react-native"] },
  { name: "Next.js", any: ["next.js", "nextjs", "next js"] },
  { name: "Vue.js", any: ["vue.js", "vuejs", "vue js", "vue"] },
  { name: "Nuxt", any: ["nuxt", "nuxt.js", "nuxtjs"] },
  { name: "Angular", any: ["angular", "angularjs", "angular.js"] },
  { name: "Svelte", any: ["svelte", "sveltekit"] },
  { name: "Redux", any: ["redux", "redux toolkit"] },
  { name: "jQuery", any: ["jquery"] },
  { name: "Webpack", any: ["webpack"] },
  { name: "Vite", exact: ["Vite"], listOnly: true },
  { name: "Three.js", any: ["three.js", "threejs"] },
  { name: "D3.js", any: ["d3.js", "d3js"] },
  { name: "Electron", any: ["electron.js", "electronjs"], exact: ["Electron"], listOnly: true },
  { name: "Figma", any: ["figma"] },
  { name: "Storybook", any: ["storybook"] },
  { name: "Web accessibility", any: ["wcag", "web accessibility", "a11y"] },

  // Backend and APIs
  { name: "Node.js", any: ["node.js", "nodejs", "node js"], exact: ["Node"], listOnly: true },
  { name: "Express", any: ["express.js", "expressjs"], exact: ["Express"], listOnly: true },
  { name: "NestJS", any: ["nestjs", "nest.js"] },
  { name: "Django", any: ["django"] },
  { name: "Flask", any: ["flask"] },
  { name: "FastAPI", any: ["fastapi", "fast api"] },
  { name: "Spring Boot", any: ["spring boot", "springboot", "spring-boot"] },
  { name: "Spring", any: ["spring framework", "spring mvc"], exact: ["Spring"], listOnly: true },
  { name: "Hibernate", any: ["hibernate"] },
  { name: ".NET", any: [".net", "dotnet", ".net core"] },
  { name: "ASP.NET", any: ["asp.net", "asp.net core"] },
  { name: "Ruby on Rails", any: ["ruby on rails", "ror"], exact: ["Rails"], listOnly: true },
  { name: "Laravel", any: ["laravel"] },
  { name: "GraphQL", any: ["graphql"] },
  { name: "REST", any: ["rest api", "rest apis", "restful", "restful apis", "rest services", "rest-based"], exact: ["REST"] },
  { name: "gRPC", any: ["grpc"] },
  { name: "WebSockets", any: ["websocket", "websockets", "web sockets"] },
  { name: "Microservices", any: ["microservices", "microservice", "micro-services", "micro services"] },
  { name: "Serverless", any: ["serverless"] },
  { name: "System design", any: ["system design", "systems design"] },
  { name: "Distributed systems", any: ["distributed systems", "distributed system"] },
  { name: "Data structures and algorithms", any: ["data structures and algorithms", "data structures & algorithms", "data structures"], exact: ["DSA"] },
  { name: "OOP", any: ["object-oriented programming", "object oriented programming", "object-oriented design", "object oriented design"], exact: ["OOP", "OOPS"] },

  // Databases and messaging
  { name: "PostgreSQL", any: ["postgresql", "postgres", "psql"] },
  { name: "MySQL", any: ["mysql"] },
  { name: "SQL Server", any: ["sql server", "mssql", "ms sql"] },
  { name: "Oracle Database", any: ["oracle db", "oracle database"], exact: ["Oracle"], listOnly: true },
  { name: "SQLite", any: ["sqlite"] },
  { name: "MongoDB", any: ["mongodb", "mongo db", "mongo"] },
  { name: "Redis", any: ["redis"] },
  { name: "Elasticsearch", any: ["elasticsearch", "elastic search"] },
  { name: "Cassandra", any: ["cassandra"] },
  { name: "DynamoDB", any: ["dynamodb", "dynamo db"] },
  { name: "NoSQL", any: ["nosql"] },
  { name: "Firebase", any: ["firebase", "firestore"] },
  { name: "Supabase", any: ["supabase"] },
  { name: "Prisma", exact: ["Prisma"], listOnly: true },
  { name: "Kafka", any: ["kafka", "apache kafka"] },
  { name: "RabbitMQ", any: ["rabbitmq", "rabbit mq"] },
  { name: "Neo4j", any: ["neo4j"] },
  { name: "Vector databases", any: ["vector database", "vector databases", "vector db", "pinecone", "pgvector", "weaviate", "qdrant", "milvus", "chromadb"] },

  // Cloud and DevOps
  { name: "AWS", any: ["aws", "amazon web services"] },
  { name: "Azure", any: ["azure", "microsoft azure"] },
  { name: "GCP", any: ["gcp", "google cloud", "google cloud platform"] },
  { name: "AWS Lambda", any: ["aws lambda"] },
  { name: "EC2", any: ["ec2"] },
  { name: "S3", exact: ["S3"], listOnly: true },
  { name: "CloudFormation", any: ["cloudformation"] },
  { name: "Docker", any: ["docker", "dockerfile"] },
  { name: "Kubernetes", any: ["kubernetes", "k8s", "eks", "aks", "gke"] },
  { name: "Helm", exact: ["Helm"], listOnly: true },
  { name: "OpenShift", any: ["openshift"] },
  { name: "Terraform", any: ["terraform"] },
  { name: "Ansible", any: ["ansible"] },
  { name: "Chef", exact: ["Chef"], listOnly: true },
  { name: "Puppet", exact: ["Puppet"], listOnly: true },
  { name: "Jenkins", any: ["jenkins"] },
  { name: "GitHub Actions", any: ["github actions"] },
  { name: "GitLab CI", any: ["gitlab ci", "gitlab-ci", "gitlab ci/cd"] },
  { name: "CircleCI", any: ["circleci", "circle ci"] },
  { name: "Argo CD", any: ["argocd", "argo cd"] },
  { name: "CI/CD", any: ["ci/cd", "ci-cd", "cicd", "ci / cd", "continuous integration"] },
  { name: "Git", any: ["git"] },
  { name: "GitHub", any: ["github"] },
  { name: "GitLab", any: ["gitlab"] },
  { name: "Linux", any: ["linux"] },
  { name: "Unix", any: ["unix"] },
  { name: "Nginx", any: ["nginx"] },
  { name: "Prometheus", any: ["prometheus"] },
  { name: "Grafana", any: ["grafana"] },
  { name: "Datadog", any: ["datadog"] },
  { name: "New Relic", any: ["new relic", "newrelic"] },
  { name: "ELK", any: ["elk stack", "logstash", "kibana"], exact: ["ELK"] },
  { name: "Istio", any: ["istio"] },
  { name: "Vercel", any: ["vercel"] },

  // Data
  { name: "Pandas", any: ["pandas"] },
  { name: "NumPy", any: ["numpy"] },
  { name: "Apache Spark", any: ["apache spark", "spark sql", "spark streaming"], exact: ["Spark"], listOnly: true },
  { name: "PySpark", any: ["pyspark"] },
  { name: "Hadoop", any: ["hadoop", "hdfs", "mapreduce"] },
  { name: "Hive", exact: ["Hive"], listOnly: true },
  { name: "Airflow", any: ["airflow", "apache airflow"] },
  { name: "dbt", exact: ["dbt", "DBT"], listOnly: true },
  { name: "Databricks", any: ["databricks"] },
  { name: "Snowflake", exact: ["Snowflake"], listOnly: true },
  { name: "BigQuery", any: ["bigquery", "big query"] },
  { name: "Redshift", any: ["redshift"] },
  { name: "Flink", any: ["flink", "apache flink"] },
  { name: "ETL", any: ["elt pipelines", "etl pipelines"], exact: ["ETL", "ELT"] },
  { name: "Data warehousing", any: ["data warehouse", "data warehousing", "data warehouses"] },
  { name: "Power BI", any: ["power bi", "powerbi"] },
  { name: "Tableau", any: ["tableau"] },
  { name: "Looker", exact: ["Looker"], listOnly: true },
  { name: "Excel", any: ["ms excel", "microsoft excel", "advanced excel"], exact: ["Excel"], listOnly: true },
  { name: "SAS", exact: ["SAS"], listOnly: true },
  { name: "SPSS", any: ["spss"] },
  { name: "Statistics", any: ["statistical modeling", "statistical modelling", "statistical analysis", "hypothesis testing"] },
  { name: "A/B testing", any: ["a/b testing", "a/b tests", "ab testing"] },

  // AI and ML
  { name: "Machine learning", any: ["machine learning"], exact: ["ML"] },
  { name: "Deep learning", any: ["deep learning"] },
  { name: "LLM", any: ["llm", "llms", "large language model", "large language models"] },
  { name: "Generative AI", any: ["generative ai", "genai", "gen ai", "gen-ai"] },
  { name: "RAG", any: ["retrieval-augmented generation", "retrieval augmented generation"], exact: ["RAG"] },
  { name: "Prompt engineering", any: ["prompt engineering", "prompt design"] },
  { name: "AI agents", any: ["ai agents", "agentic", "multi-agent", "agent frameworks"] },
  { name: "NLP", any: ["nlp", "natural language processing"] },
  { name: "Computer vision", any: ["computer vision"] },
  { name: "OpenCV", any: ["opencv"] },
  { name: "TensorFlow", any: ["tensorflow"] },
  { name: "PyTorch", any: ["pytorch"] },
  { name: "Keras", any: ["keras"] },
  { name: "scikit-learn", any: ["scikit-learn", "scikit learn", "sklearn"] },
  { name: "XGBoost", any: ["xgboost"] },
  { name: "Hugging Face", any: ["hugging face", "huggingface", "transformers library"] },
  { name: "LangChain", any: ["langchain"] },
  { name: "LangGraph", any: ["langgraph"] },
  { name: "LlamaIndex", any: ["llamaindex", "llama index"] },
  { name: "OpenAI API", any: ["openai api", "openai apis"] },
  { name: "MLOps", any: ["mlops", "ml ops"] },
  { name: "MLflow", any: ["mlflow"] },
  { name: "Reinforcement learning", any: ["reinforcement learning"] },

  // Mobile
  { name: "Android", any: ["android"] },
  { name: "iOS", any: ["ios"] },
  { name: "Flutter", any: ["flutter"] },
  { name: "Jetpack Compose", any: ["jetpack compose"] },
  { name: "Xamarin", any: ["xamarin"] },

  // Testing and QA
  { name: "Selenium", any: ["selenium"] },
  { name: "Cypress", any: ["cypress"] },
  { name: "Playwright", any: ["playwright"] },
  { name: "Appium", any: ["appium"] },
  { name: "Jest", exact: ["Jest"], listOnly: true },
  { name: "JUnit", any: ["junit"] },
  { name: "TestNG", any: ["testng"] },
  { name: "pytest", any: ["pytest"] },
  { name: "JMeter", any: ["jmeter"] },
  { name: "Postman", any: ["postman"] },
  { name: "Cucumber", exact: ["Cucumber"], listOnly: true },
  { name: "BDD", any: ["behavior-driven development", "behaviour-driven development", "behavior driven development"], exact: ["BDD"] },
  { name: "Unit testing", any: ["unit testing", "unit tests", "unit test"] },
  { name: "TDD", any: ["test-driven development", "test driven development"], exact: ["TDD"] },

  // Security
  { name: "OWASP", any: ["owasp"] },
  { name: "SIEM", any: ["siem"] },
  { name: "Splunk", any: ["splunk"] },
  { name: "Penetration testing", any: ["penetration testing", "pentesting", "pen testing", "vapt"] },
  { name: "Burp Suite", any: ["burp suite", "burpsuite"] },
  { name: "Wireshark", any: ["wireshark"] },
  { name: "IAM", any: ["identity and access management"], exact: ["IAM"] },
  { name: "OAuth", any: ["oauth", "oauth2", "oauth 2.0"] },

  // Embedded and other
  { name: "RTOS", any: ["rtos", "freertos"] },
  { name: "FPGA", any: ["fpga"] },
  { name: "Arduino", any: ["arduino"] },
  { name: "Raspberry Pi", any: ["raspberry pi"] },
  { name: "Unity", any: ["unity3d", "unity 3d", "unity engine"] },
  { name: "Unreal Engine", any: ["unreal engine"] },
  { name: "Blockchain", any: ["blockchain", "web3", "smart contracts"] },
  { name: "Salesforce", any: ["salesforce development", "lightning web components"], exact: ["Salesforce"], listOnly: true },
  { name: "SAP", any: ["sap abap", "abap", "sap hana"], exact: ["SAP"], listOnly: true },
  { name: "ServiceNow", any: ["servicenow"] },
  { name: "Jira", any: ["jira"] },
];

type Alias = { term: string; text: string; caseSensitive: boolean; listOnly: boolean };

// Longest spelling first, so "React Native" claims its words before "React" and "Spring Boot" before "Spring".
const ALIASES: Alias[] = TECH_VOCAB.flatMap((term) => [
  ...(term.any ?? []).map((text) => ({ term: term.name, text: text.toLowerCase(), caseSensitive: false, listOnly: false })),
  ...(term.exact ?? []).map((text) => ({ term: term.name, text, caseSensitive: true, listOnly: Boolean(term.listOnly) })),
]).sort((a, b) => b.text.length - a.text.length);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// Each spelling as written (case-sensitive ones) and lower-cased (the rest, and every spelling in lenient mode).
const EXACT = new Map(ALIASES.map((alias) => [alias, new RegExp(`(?<![A-Za-z0-9+#])${escape(alias.text)}(?![A-Za-z0-9+#])`, "g")]));
const LOWER = new Map(ALIASES.map((alias) => [alias, new RegExp(`(?<![a-z0-9+#])${escape(alias.text.toLowerCase())}(?![a-z0-9+#])`, "g")]));
const BY_NAME = new Map(TECH_VOCAB.map((term) => [term.name.toLowerCase(), term.name]));

/** The first word of a sentence: only spaces back to a full stop, "!", "?", a line start or the text start. */
function sentenceStart(text: string, at: number) {
  for (let i = at - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (char === " " || char === "\t") continue;
    return char === "." || char === "!" || char === "?" || char === "\n";
  }
  return true;
}

/**
 * Canonical vocabulary terms found in `text`, in order of first appearance. `lenient` (for the candidate's own skills
 * list, where "go" means Go) matches every spelling case-insensitively and needs no list around it.
 */
function findTerms(text: string, lenient = false): string[] {
  return termPositions(text, lenient).map((hit) => hit.term);
}

/** Numeric HTML entities some boards leave in their text ("C&#43;&#43;" is C++), decoded before matching. */
export function decodeEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "");
}

/** Each term found, with where its first spelling sits in decodeEntities(text), in order of first appearance. */
export function termPositions(text: string, lenient = false): Array<{ term: string; at: number; end: number }> {
  let original = decodeEntities(text);
  let lower = original.toLowerCase();
  const first = new Map<string, { at: number; end: number }>();
  const deferred: Array<{ term: string; at: number; end: number }> = [];
  const blank = (at: number, end: number) => {
    const fill = " ".repeat(end - at);
    original = original.slice(0, at) + fill + original.slice(end);
    lower = lower.slice(0, at) + fill + lower.slice(end);
  };
  for (const alias of ALIASES) {
    const caseSensitive = alias.caseSensitive && !lenient;
    const pattern = (caseSensitive ? EXACT : LOWER).get(alias)!;
    const haystack = caseSensitive ? original : lower;
    for (const match of haystack.matchAll(pattern)) {
      const at = match.index ?? 0;
      const end = at + match[0].length;
      if (alias.listOnly && !lenient) {
        deferred.push({ term: alias.term, at, end });
        continue;
      }
      if (!first.has(alias.term) || first.get(alias.term)!.at > at) first.set(alias.term, { at, end });
      blank(at, end);
    }
  }
  // An English-looking spelling counts only inside a run of tech terms ("Go, Kafka and AWS"), and never as the first
  // word of a sentence ("Go beyond", "Spring is here").
  const anchors = [...first.values()].map((hit) => hit.at);
  for (const hit of deferred) {
    if (sentenceStart(original, hit.at)) continue;
    if (!anchors.some((at) => Math.abs(at - hit.at) <= LIST_REACH)) continue;
    if (!first.has(hit.term) || first.get(hit.term)!.at > hit.at) first.set(hit.term, { at: hit.at, end: hit.end });
  }
  return [...first.entries()].map(([term, hit]) => ({ term, ...hit })).sort((a, b) => a.at - b.at);
}

/** The tech skills a posting names (stored on Job.skills at ingest), at most `limit`. */
export function jobSkills(title: string, description: string, limit = 20): string[] {
  return findTerms(`${title}\n${description}`).slice(0, limit);
}

/**
 * Every vocabulary skill the candidate shows: in their resume text (the same strict rules as a posting) or in their
 * skills list (any spelling, any case). A job skill is "missing" only when it is in neither.
 */
export function candidateSkills(profile: { skills: unknown; resumeText?: string | null }): Set<string> {
  const listed = Array.isArray(profile.skills) ? profile.skills.filter((skill): skill is string => typeof skill === "string") : [];
  const found = new Set<string>(findTerms(profile.resumeText ?? ""));
  for (const skill of listed) {
    const named = BY_NAME.get(skill.trim().toLowerCase());
    if (named) found.add(named);
    for (const term of findTerms(skill, true)) found.add(term);
  }
  return found;
}

/**
 * What a skill proves the candidate also has: a React developer writes HTML, CSS and JavaScript, a FastAPI one Python,
 * a PostgreSQL one SQL. Only certain implications (20 Nov: a React and TypeScript resume showed "Missing: HTML, CSS").
 */
const IMPLIES: Record<string, string[]> = {
  React: ["HTML", "CSS", "JavaScript"],
  "Next.js": ["React"],
  "Vue.js": ["HTML", "CSS", "JavaScript"],
  Nuxt: ["Vue.js"],
  Angular: ["HTML", "CSS", "TypeScript"],
  Svelte: ["HTML", "CSS", "JavaScript"],
  jQuery: ["HTML", "CSS", "JavaScript"],
  Redux: ["JavaScript"],
  "Tailwind CSS": ["CSS"],
  Sass: ["CSS"],
  Bootstrap: ["CSS"],
  TypeScript: ["JavaScript"],
  "Node.js": ["JavaScript"],
  Express: ["Node.js"],
  NestJS: ["Node.js", "TypeScript"],
  Django: ["Python"],
  Flask: ["Python"],
  FastAPI: ["Python"],
  Pandas: ["Python"],
  NumPy: ["Python"],
  PySpark: ["Python", "Apache Spark"],
  "Spring Boot": ["Spring"],
  Spring: ["Java"],
  Hibernate: ["Java"],
  "ASP.NET": [".NET"],
  Laravel: ["PHP"],
  "Ruby on Rails": ["Ruby"],
  PostgreSQL: ["SQL"],
  MySQL: ["SQL"],
  "SQL Server": ["SQL"],
  SQLite: ["SQL"],
  "Oracle Database": ["SQL"],
  "PL/SQL": ["SQL"],
  GitHub: ["Git"],
  GitLab: ["Git"],
  SwiftUI: ["Swift"],
  Flutter: ["Dart"],
  "Jetpack Compose": ["Kotlin", "Android"],
  "AWS Lambda": ["AWS"],
  EC2: ["AWS"],
  S3: ["AWS"],
  CloudFormation: ["AWS"],
};

/** The candidate's skills with everything they imply (IMPLIES, followed to the end): what the card and the judge compare. */
export function withImplied(skills: Set<string>): Set<string> {
  const out = new Set(skills);
  const queue = [...skills];
  while (queue.length > 0) {
    for (const implied of IMPLIES[queue.pop()!] ?? []) {
      if (out.has(implied)) continue;
      out.add(implied);
      queue.push(implied);
    }
  }
  return out;
}

/**
 * The job's skills split by what the candidate shows. With the model's labels (`required`, a subset of `skills`),
 * missing lists only required ones and `split` is true; without, missing is every skill not shown.
 */
export function compareSkills(skills: string[], required: string[] | null, have: Set<string>) {
  const shown = skills.filter((skill) => have.has(skill));
  const split = required != null;
  const pool = split ? required.filter((skill) => skills.includes(skill)) : skills;
  return { have: shown, missing: pool.filter((skill) => !have.has(skill)), split };
}

/** What the card and the fit judge count as the candidate's skills: candidateSkills plus what they imply. The brief
 * keeps candidateSkills alone (its own list, unchanged, so verdicts stay cached). */
export function candidateShows(profile: { skills: unknown; resumeText?: string | null }): Set<string> {
  return withImplied(candidateSkills(profile));
}
