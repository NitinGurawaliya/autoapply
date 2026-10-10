// T81: the tech-track classifier (modules/jobs/functions.ts) on real Greenhouse titles seen on 10 Oct 2026, the level
// each title states, and the tracks read from six kinds of tech profile. Offline. npx tsx scripts/functions-test.ts
import { classifyTitle, seniorityOf, trackFit, tracksFromProfile } from "../src/modules/jobs/functions";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` (${detail})` : ""}`);
  } else passed += 1;
}

const TITLES: Record<string, string[]> = {
  ml_ai: [
    "Senior Machine Learning Engineer, Public Sector", "Staff Machine Learning Engineer, Generative AI (Auth0)", "Applied AI Engineer", "Principal Applied AI Engineer",
    "AI ML Ops Software Engineer (Bangalore Hybrid)", "Senior Machine Learning Platform Engineer", "Software Engineer I - AI Observability", "SDE IV (ML Engineering)",
    "Machine Learning / Data Engineer", "Principal AI Engineer - Context - Agents and Context", "Software Engineer, GenAI Platform", "Research Scientist, NLP",
    "Computer Vision Engineer", "LLM Inference Engineer", "Deep Learning Engineer", "PhD Machine Learning Software Engineer Intern (Summer 2027)",
    "Applied Scientist II", "Senior Software Engineer - Recommendation Systems", "Distinguished Engineer, Machine Learning - Discovery", "AI Engineer",
  ],
  data_science: [
    "Senior Data Scientist", "Data Scientist, Optimization - Real-Time Supply Management", "Data Analyst, NYC", "Senior Data Analyst", "Product Analyst II",
    "Lead Business Intelligence Analyst", "Data Analyst Intern (Summer 2027)", "PhD Data Scientist, Intern", "Staff Data Scientist", "Data Science Intern (2027)",
    "Principal Data Scientist - Safety", "Senior Business Analyst - NPI Operations", "Analytics Lead, Airports", "Data Science, Metrics", "Senior Data Scientist (Economist)",
  ],
  data_engineering: ["Senior Data Engineer", "Data Engineer II", "Staff Data Platform Engineer", "Big Data Engineer", "Database Reliability Engineer", "ETL Developer", "Data Infrastructure Engineer"],
  security: [
    "Senior Security Engineer, Incident Response Team (Australia)", "Staff Application Security Engineer", "Offensive Security Engineer", "Security Engineer, Product & Production Infrastructure",
    "Senior Application Security Engineer", "Staff Security Engineer, Threat Hunting", "Senior Threat Intelligence Engineer", "Cybersecurity Threat Researcher (Hybrid)",
    "Security Operations Centre Specialist II", "Software Engineer II - EDR Workflows - Security", "Principal Security Software Engineer, IAM", "SOC Analyst", "Penetration Tester",
    "Senior Security Engineer,Detection & Incident Response", "Cloud Security Engineer",
  ],
  devops: [
    "Senior Site Reliability Engineer, Compute", "Senior DevOps Engineer", "DevOps Engineer III", "Staff Site Reliability Engineer - Kubernetes", "Cloud Platform Engineer",
    "Software Engineer, Infrastructure", "Senior Release Engineer", "Senior Network Engineer - Data Center Networking", "Associate Site Reliability Engineer/Site Reliability Engineer",
    "Staff Software Engineer, Infrastructure (Distributed Systems)", "Cloud Architect", "Senior Systems Engineer", "Platform Engineer", "Observability Engineer",
  ],
  mobile: ["Senior iOS Engineer", "Android Developer", "Mobile Software Engineer", "Early Career Mobile Software Engineer, Quality Platform", "Senior React Native Engineer", "Flutter Developer"],
  frontend: ["Senior Frontend Engineer", "Front-End Developer", "Software Development Engineer II - Frontend", "UX Engineer", "Web Engineer", "UI Engineer", "Junior Web Developer"],
  fullstack: ["Software Engineer II - Full Stack", "Full Stack Developer", "Platform Full-Stack Engineer, New Grad 2027", "Senior Fullstack Engineer", "MERN Stack Developer", "Full-Stack Engineer"],
  backend: ["Backend Engineer", "Senior Backend Engineer, Payments", "Back-End Developer", "Staff Backend Engineer", "Software Engineer, Backend", "Distributed Systems Engineer", "API Engineer"],
  qa: ["Software Development Engineer in Test, SASE", "Sr. Software Development Engineer in Test (Agentic)", "QA Engineer", "Analyst, Quality Assurance", "Test Automation Engineer", "SDET II", "Quality Engineer"],
  embedded: ["Embedded Software Engineer", "Firmware Engineer", "Hardware Systems Engineer", "FPGA Engineer", "ASIC Design Verification Engineer", "Linux Kernel Software Engineer - Systems Engineering", "Robotics Engineer"],
  solutions: [
    "Solutions Architect", "Senior Solutions Engineer - Benelux Geo", "Sales Engineer - Enterprise", "Forward Deployed Engineer", "Technical Support Engineer - 2", "Customer Engineer, Korea",
    "Principal Implementation Engineer, Customer Support", "Senior Designated Support Engineer", "Sr. Developer Advocate, Open Source", "Senior Security Sales Engineer", "Technical Architect, Salesforce Engineering",
  ],
  eng_management: ["Engineering Manager", "Senior Engineering Manager, Payments", "Director of Engineering", "Manager I, Engineering - Anomaly Detection", "Manager, Site Reliability Engineering", "Head of Engineering", "VP, Engineering"],
  software: [
    "Software Engineer", "Senior Software Engineer", "Software Engineer II", "Staff Software Engineer", "Software Engineer 3", "Lead Software Engineer", "Engineer IV",
    "Software Engineering Intern", "Graduate Software Engineer", "Software Developer", "SDE I", "Member of Technical Staff, Software Engineer", "Senior Software Engineer (Onboarding & Activation)",
    "Software Engineer, Economy Platform", "Senior Software Engineer, Internal Fraud Platform",
  ],
  non_tech: [
    "Account Executive, Commercial", "Sales Development Representative", "Product Manager - Developer Experience, Bridge", "Senior Staff Product Manager", "Recruiter, Engineering",
    "Technical Recruiter", "Customer Success Manager (Tech Touch & SMB)", "Accountant", "Strategic Finance Intern", "Procurement Manager", "Brand Designer – Identity & Campaigns",
    "Manager, Product Design: AI Products", "Strategic Account Manager", "Project Manager", "Talent Brand Manager", "Tax Operations Intern", "Revenue Enablement Manager, Americas",
    "Global People Operations - Systems Administrator", "People Systems Engineer", "Product Designer", "Legal Counsel", "Payroll Specialist", "Marketing Manager, India", "VP, International Sales",
    "Deal Desk Analyst", "Account Executive, AI Startups - Grower", "Senior Consultant, Analytics Consulting", "HR Business Partner", "Executive Assistant", "Content Marketing Manager",
  ],
};

let total = 0;
for (const [want, titles] of Object.entries(TITLES)) {
  for (const title of titles) {
    total += 1;
    const got = classifyTitle(title).track ?? "non_tech";
    check(`${title} → ${want}`, got === want, `got ${got}`);
  }
}

const LEVELS: Array<[string, string | null]> = [
  ["Software Engineering Intern", "intern"], ["Data Analyst Intern (Summer 2027)", "intern"], ["Graduate Software Engineer", "entry"], ["Platform Full-Stack Engineer, New Grad 2027", "entry"],
  ["Junior Web Developer", "entry"], ["Software Engineer I - AI Observability", "entry"], ["SDE I", "entry"], ["Early Career Mobile Software Engineer, Quality Platform", "entry"],
  ["Software Engineer II", "mid"], ["Security Engineer II", "mid"], ["Software Engineer - 2", "mid"], ["SDET II", "mid"], ["Intermediate Security Engineer", "mid"],
  ["Senior Software Engineer", "senior"], ["Sr. Solutions Architect", "staff"], ["Software Engineer 3", "senior"], ["Engineer IV", "senior"], ["DevOps Engineer III", "senior"],
  ["Staff Software Engineer", "staff"], ["Principal Applied AI Engineer", "staff"], ["Lead Software Engineer", "staff"], ["Engineering Manager", "manager"], ["Director of Engineering", "manager"],
  ["Software Engineer", null], ["Backend Engineer", null], ["Data Scientist", null],
];
for (const [title, want] of LEVELS) {
  total += 1;
  check(`level of ${title} → ${want}`, seniorityOf(title) === want, `got ${seniorityOf(title)}`);
}

const PROFILES: Array<[string, Parameters<typeof tracksFromProfile>[0], string]> = [
  ["frontend developer", { currentTitle: "Frontend Developer", experienceTitles: ["Frontend Developer Intern"], skills: ["React", "TypeScript", "CSS", "Next.js"] }, "frontend"],
  ["backend developer", { currentTitle: "Backend Engineer", experienceTitles: [], skills: ["Java", "Spring Boot", "PostgreSQL", "Redis"] }, "backend"],
  ["ML engineer", { currentTitle: "Machine Learning Engineer", experienceTitles: [], skills: ["PyTorch", "Python", "MLflow", "NLP"] }, "ml_ai"],
  ["data scientist", { currentTitle: "Data Scientist", experienceTitles: ["Data Analyst"], skills: ["Python", "Pandas", "SQL", "Statistics", "Tableau"] }, "data_science"],
  ["security engineer", { currentTitle: "SOC Analyst", experienceTitles: [], skills: ["Splunk", "SIEM", "Wireshark", "Incident Response"] }, "security"],
  ["DevOps engineer", { currentTitle: "DevOps Engineer", experienceTitles: [], skills: ["Kubernetes", "Terraform", "AWS", "Jenkins"] }, "devops"],
  ["student with ML skills", { currentTitle: "Student", experienceTitles: [], skills: ["PyTorch", "TensorFlow", "Python"] }, "ml_ai"],
  ["MERN developer", { currentTitle: "MERN Stack Developer", experienceTitles: [], skills: ["React", "Node.js", "MongoDB", "Express"] }, "fullstack"],
];
for (const [name, input, want] of PROFILES) {
  total += 1;
  const got = tracksFromProfile(input);
  check(`${name} → ${want} first`, got[0] === want, got.join(", "));
}

total += 4;
check("a data scientist is not matched with frontend roles", trackFit("frontend", ["data_science"]) === "none");
check("a security engineer is matched with security roles", trackFit("security", ["security"]) === "same");
check("an ML engineer sees data science as adjacent", trackFit("data_science", ["ml_ai"]) === "adjacent");
check("a full-stack developer sees general software roles", trackFit("software", ["fullstack"]) === "adjacent");

console.log(`${passed}/${total} checks`);
console.log(failed === 0 ? "PASS functions" : `FAIL functions (${failed})`);
process.exit(failed === 0 ? 0 : 1);
