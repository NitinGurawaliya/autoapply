// The department a job sits in, for a company page's filter chips (src/lib/department.ts, Phase W). Pure; no network, no
// database. npx tsx scripts/department-test.ts
import { departmentLabel, departmentOf, isDepartment } from "../src/lib/department";
import { parseEmployerFilters, placesLine } from "../src/modules/jobs/employer-pages";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const of = (title: string, fn: string | null = "non_tech") => departmentOf({ title, function: fn });

ok("a stored engineering function wins over the title", of("Technical Support Engineer", "engineering") === "engineering" && of("Sales Engineer", "engineering") === "engineering");
ok("a stored data/AI function is Data & AI", of("Analyst", "data_ai") === "data");
ok("Product Manager is product", of("Product Manager - Weighing Solutions") === "product");
ok("Product Marketing Manager is marketing, not product", of("Product Marketing Manager") === "marketing");
ok("Marketing & BD Manager is marketing", of("Marketing & BD Manager") === "marketing");
ok("Senior Account Executive is sales", of("Senior Account Executive") === "sales");
ok("Customer Success Manager is sales & business", of("Customer Success Manager") === "sales");
ok("Sales Operations Analyst is sales (before operations)", of("Sales Operations Analyst") === "sales");
ok("Financial Controller is finance", of("Financial Controller") === "finance");
ok("Payroll Specialist is finance", of("Payroll Specialist") === "finance");
ok("Talent Acquisition Partner is people", of("Talent Acquisition Partner") === "people");
ok("Supply Chain Planner is operations", of("Supply Chain Planner") === "operations");
ok("Customer Service Executive is operations", of("Customer Service Executive") === "operations");
ok("Plant Maintenance Technician is operations", of("Plant Maintenance Technician") === "operations");
ok("UX Designer is design", of("UX Designer") === "design");
ok("something unclear is other roles", of("Associate, Special Projects") === "other");
ok("no function and no pattern is other roles", departmentOf({ title: "", function: null }) === "other");
ok("the word only counts whole: 'Hrithik' is not HR, 'Production' stays operations", of("Hrithik Roshan") === "other" && of("Production Supervisor") === "operations");
ok("labels", departmentLabel("sales") === "Sales & Business" && departmentLabel("data") === "Data & AI" && departmentLabel("nope") === "Other roles");
ok("isDepartment", isDepartment("finance") && !isDepartment("nope") && !isDepartment(undefined));

// The cities on an employer's row, and the search and department read from an address.
const place = (...locations: string[]) => placesLine(locations.map((location) => ({ location, n: 1 })));
ok("places: one spelling per city", place("Bangalore, Karnataka", "Bengaluru", "bangalore") === "Bengaluru");
ok("places: a lower-case city gets capitals", place("coimbatore") === "Coimbatore");
ok("places: 'India - ' and 'IND-' prefixes are dropped", place("India - Hyderabad", "IND-Gurgaon") === "Gurugram and Hyderabad" || place("India - Hyderabad", "IND-Gurgaon") === "Hyderabad and Gurugram");
ok("places: a place in another country is left out", place("US - California - Remote", "Pune") === "Pune");
ok("places: three or more", place("Pune", "Pune", "Mumbai", "Delhi", "Chennai") === "Pune, Chennai and 2 more");
ok("places: none", place("", "12345") === "");
ok("filters: the text is trimmed and spaces collapsed", parseEmployerFilters({ q: "  data   analyst " }).q === "data analyst");
ok("filters: a known department is kept, an unknown one dropped", parseEmployerFilters({ f: "sales" }).department === "sales" && parseEmployerFilters({ f: "nope" }).department === null);
ok("filters: the text is cut at 80 characters", parseEmployerFilters({ q: "x".repeat(200) }).q.length === 80);

console.log(failed === 0 ? "PASS department-test" : `FAIL department-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
