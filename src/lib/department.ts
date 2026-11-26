// The department a job sits in, for the filter chips on a company page (Phase W). A display grouping read from the title
// and the job's stored function; it decides nothing about matching or applying. The proper fields and tracks for
// non-tech roles are the next phase's work (docs/employers/TDD.md section 12) and will replace this.

export const DEPARTMENTS = [
  { id: "engineering", label: "Engineering" },
  { id: "data", label: "Data & AI" },
  { id: "product", label: "Product" },
  { id: "design", label: "Design" },
  { id: "sales", label: "Sales & Business" },
  { id: "marketing", label: "Marketing" },
  { id: "finance", label: "Finance" },
  { id: "people", label: "People" },
  { id: "operations", label: "Operations" },
  { id: "other", label: "Other roles" },
] as const;

export type DepartmentId = (typeof DEPARTMENTS)[number]["id"];

export const departmentLabel = (id: string): string => DEPARTMENTS.find((department) => department.id === id)?.label ?? "Other roles";
export const isDepartment = (value: unknown): value is DepartmentId => DEPARTMENTS.some((department) => department.id === value);

// Checked in this order, so "Product Marketing Manager" is marketing and "Sales Operations" is sales.
const RULES: Array<[DepartmentId, RegExp]> = [
  ["marketing", /\b(marketing|brand|content|seo|growth|social media|communications?|copywriter|community|public relations)\b/i],
  ["product", /\b(product (manager|owner|management|lead|head|director|specialist|analyst)|group product|chief product)\b/i],
  ["design", /\b(ux|ui|ux\/ui|designer|design (lead|manager|director)|creative director|illustrator|animator)\b/i],
  ["sales", /\b(sales|account (executive|manager|director)|business development|bdr|sdr|customer success|partnerships?|relationship manager|presales|pre-sales|channel|key account|territory)\b/i],
  ["finance", /\b(finance|financial|accountant|accounting|accounts (payable|receivable)|audit(or)?|tax|treasury|controller|payroll|fp&a|credit|underwriter|actuar\w*|investment|banker|banking|collections)\b/i],
  ["people", /\b(recruit\w*|talent|hr|human resources|people (partner|operations|ops|business)|learning and development|l&d|compensation|benefits)\b/i],
  ["operations", /\b(operations?|ops|supply chain|logistics|procurement|purchasing|warehouse|plant|manufacturing|production|quality|maintenance|facilit\w*|project manager|program manager|store|inventory|planner|dispatch|field|technician|driver|admin\w*|assistant|coordinator|customer (service|support|care|experience)|executive assistant|receptionist)\b/i],
];

/** The department of a job: its stored function first (engineering and data/AI come from the posting's own reading), then the title. */
export function departmentOf(job: { title: string; function: string | null }): DepartmentId {
  if (job.function === "data_ai") return "data";
  if (job.function === "engineering") return "engineering";
  for (const [id, pattern] of RULES) if (pattern.test(job.title)) return id;
  return "other";
}
