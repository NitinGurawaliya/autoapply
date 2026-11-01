// Checks lib/description.ts: headings, paragraphs and labelled lists come out of the flat stored text, and joining
// every block gives the input back word for word (nothing added, dropped or reordered). Run: npx tsx scripts/description-test.ts
import { blockText, describe, previewCount, type DescriptionBlock } from "../src/lib/description";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail && !ok ? ` (${detail})` : ""}`);
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const joined = (blocks: DescriptionBlock[]) => squash(blocks.map(blockText).join(" "));
const headings = (blocks: DescriptionBlock[]) => blocks.filter((block) => block.kind === "heading").map((block) => (block as { text: string }).text);

const databricks =
  "CSQ128R189 As a Forward Deployment Strategist (FDS), you are the critical bridge between a customer's business problem and our technical solution. You are a product manager for the field. You will report to the Director, Forward Deployed Engineering. The impact you will have: C-Suite Scoping & Value Definition: Partner with Sales to perform deep discovery. You will scope the value. Pilot Ownership: Define the Minimum Viable Product for a pilot. Write the PRD. What we look for: 5+ years in a customer-facing role.";
const keka =
  "Experience: 2-3 years Who are we? Kapture CX is an AI-native SaaS platform helping enterprises automate work. Today, Kapture is trusted by 1,000+ enterprises across 18 countries. What is this role all about? We are looking for a driven Talent Acquisition Specialist who is passionate about finding great talent.";
const uipath =
  "LIFE AT UIPATH The people at UiPath believe in the power of automation. We are committed to creating category-leading software. Could that be you? About the Role We are seeking a highly skilled Software Engineer to be part of the Data Fabric team. As a developer, you will build robust systems. What you'll do at UiPath We are looking for talented engineers. Requirements: Python, e.g. Django. 2+ years of experience.";
const plain = "We build tools for teams. You will write code. You will review code. You will ship often. You will learn a lot.";

for (const [name, text] of [["databricks", databricks], ["keka", keka], ["uipath", uipath], ["plain", plain], ["empty", ""]] as const) {
  const blocks = describe(text);
  check(`${name}: joining the blocks gives the text back`, joined(blocks) === squash(text), `${joined(blocks)}\n   vs ${squash(text)}`);
}

const d = describe(databricks);
check("a lead-in with a colon is a heading", headings(d).includes("The impact you will have:"), JSON.stringify(headings(d)));
const list = d.find((block) => block.kind === "list");
check(
  "labelled lines become one list with their labels",
  !!list && list.kind === "list" && list.items.map((item) => item.label).join("|") === "C-Suite Scoping & Value Definition|Pilot Ownership",
  JSON.stringify(list),
);
check("a sentence after a labelled line stays with it", !!list && list.kind === "list" && list.items[0].text.endsWith("You will scope the value."));

const k = describe(keka);
check("questions that open a section are headings", headings(k).includes("Who are we?") && headings(k).includes("What is this role all about?"), JSON.stringify(headings(k)));
check("the text before a split-off question stays a paragraph", k[0].kind === "paragraph" && blockText(k[0]) === "Experience: 2-3 years");

const u = describe(uipath);
check("an ALL-CAPS lead-in is a heading", headings(u)[0] === "LIFE AT UIPATH", JSON.stringify(headings(u)));
check("a section name without a colon is a heading", headings(u).includes("About the Role") && headings(u).includes("What you'll do at UiPath"), JSON.stringify(headings(u)));
check("a section name with a colon keeps it", headings(u).includes("Requirements:"), JSON.stringify(headings(u)));
check("a closing question that is not a section stays in its paragraph", !headings(u).includes("Could that be you?"));
check("'e.g. Django' does not end a sentence", u.some((block) => blockText(block).includes("Python, e.g. Django.")));

const flat =
  "Key responsibilities include: Develop and support physical design CAD flows using industry-standard EDA tools Build automation infrastructure for implementation, analysis, reporting, and debug Support design teams in areas such as Synthesis and Placement Create scripts and utilities to improve productivity and flow robustness Work with multiple functions such as Legal and Finance";
const f = describe(flat);
check("flat: joining the blocks gives the text back", joined(f) === squash(flat), joined(f));
check("a flattened list becomes a list under its lead-in", headings(f)[0] === "Key responsibilities include:" && f[1]?.kind === "list" && f[1].items.length === 5, JSON.stringify(f));
check("a capital after a joining word stays inside its line", f[1]?.kind === "list" && f[1].items.some((item) => item.text.endsWith("such as Legal and Finance")));
check("a label for one item is not a heading", !headings(describe("Partnership with our technology teams: Work across groups. We ship.")).length);
check("curly apostrophes are recognised", headings(describe("What You’ll Do Serve as Mission Strategist: Plan the work. Track it.")).includes("What You’ll Do"));

const singlestore =
  "This role requires a delivery mindset. Role and Responsibilities Design and implement end-to-end solutions. Lead whiteboard sessions to shape ideas. Own delivery of high-impact initiatives. Your Experience 10+ years of experience in solutions architecture. Proven experience delivering production-grade solutions. SingleStore delivers the cloud-native database.";
const s = describe(singlestore);
check("singlestore: joining the blocks gives the text back", joined(s) === squash(singlestore), joined(s));
check("section names without a colon in the middle of the text are headings", headings(s).includes("Role and Responsibilities") && headings(s).includes("Your Experience"), JSON.stringify(headings(s)));
check("sentences that open like bullets become a list", s.filter((block) => block.kind === "list").map((block) => (block.kind === "list" ? block.items.length : 0)).join(",") === "3,2", JSON.stringify(s));
check("prose after the bullets is a paragraph again", s[s.length - 1].kind === "paragraph" && blockText(s[s.length - 1]) === "SingleStore delivers the cloud-native database.");
check("one bullet-like sentence alone stays a paragraph", describe("We are a small team. Strong opinions are welcome here. We ship.").every((block) => block.kind === "paragraph"));

const p = describe(plain);
check("plain text becomes paragraphs of at most three sentences", p.every((block) => block.kind === "paragraph") && p.length === 2, JSON.stringify(p));
check("an empty description has no blocks", describe("   ").length === 0);
check("the preview never shows less than one block", previewCount(describe(uipath), 10) >= 1 && previewCount([], 10) === 0);

console.log(failed === 0 ? "PASS description" : `FAIL description (${failed})`);
process.exit(failed === 0 ? 0 : 1);
