// Workday companies from a CSV of career sites (23 Nov): every row's `career_site` address becomes a Company on the
// workday board ("{tenant}.{wdN}/{site}", the site keeping its case), or turns an existing one back on. Nothing is
// verified here (Workday's Cloudflare refuses this server's reads); every row is made due now, and the read that
// follows is the check: npx tsx scripts/ingest-workday-browser.ts (new rows are `addedBy = import`; existing rows keep theirs)
// Dry run by default; --write stores. Columns: any; `career_site` (a myworkdayjobs.com address) and `name` are read.
//   npx tsx scripts/import-workday-companies.ts --file C:\path\workday.csv [--write]
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { workdaySlugOf } from "../src/modules/jobs/fetchers/workday";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** A CSV line's fields, quotes honoured ("a, b" stays one field). */
function fields(line: string) {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') {
      field += '"';
      i++;
    } else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((value) => value.trim());
}

export function companiesFromCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const header = fields(lines[0]).map((name) => name.toLowerCase());
  const site = header.indexOf("career_site");
  const name = header.indexOf("name");
  if (site < 0 || name < 0) throw new Error(`the CSV needs "name" and "career_site" columns; found: ${header.join(", ")}`);
  const seen = new Map<string, { slug: string; name: string; site: string }>();
  const rejected: string[] = [];
  for (const line of lines.slice(1)) {
    const row = fields(line);
    let slug: string | null = null;
    try {
      slug = workdaySlugOf(new URL(row[site]));
    } catch {
      slug = null;
    }
    if (!slug) {
      rejected.push(row[site] || line);
      continue;
    }
    // The file is sorted by size: the first row of a slug names the company.
    if (!seen.has(slug.toLowerCase())) seen.set(slug.toLowerCase(), { slug, name: row[name].replace(/\s+/g, " ").trim(), site: row[site] });
  }
  return { companies: [...seen.values()], rejected };
}

async function main() {
  const file = arg("--file");
  if (!file) throw new Error("--file <csv> is required");
  const write = process.argv.includes("--write");
  const { companies, rejected } = companiesFromCsv(readFileSync(file, "utf8"));
  const existing = await db.company.findMany({ where: { source: "workday" }, select: { id: true, slug: true, name: true, active: true, offReason: true } });
  const bySlug = new Map(existing.map((company) => [company.slug.toLowerCase(), company]));
  const now = new Date();
  const counts = { rows: companies.length, rejected: rejected.length, alreadyOn: 0, turnedOn: 0, created: 0 };
  for (const company of companies) {
    const known = bySlug.get(company.slug.toLowerCase());
    if (known?.active) {
      counts.alreadyOn += 1;
      // Due now, so the run that follows reads it.
      if (write) await db.company.update({ where: { id: known.id }, data: { nextFetchAt: now } });
      continue;
    }
    if (known) {
      counts.turnedOn += 1;
      console.log(`on again  ${known.slug}  (was off: ${known.offReason ?? "no reason"})`);
      if (write) await db.company.update({ where: { id: known.id }, data: { active: true, offReason: null, failedFetches: 0, notFoundFetches: 0, lastError: null, nextFetchAt: now } });
      continue;
    }
    counts.created += 1;
    console.log(`new       ${company.slug}  ${company.name}`);
    if (write) await db.company.create({ data: { source: "workday", slug: company.slug, name: company.name, stage: "mnc", addedBy: "import", nextFetchAt: now } });
  }
  for (const line of rejected) console.log(`not a Workday career site: ${line}`);
  console.log(`${write ? "written" : "dry run"}: ${JSON.stringify(counts)}`);
}

// Run only as a script: scripts/ingest-workday-browser.ts imports companiesFromCsv.
if (/import-workday-companies/.test(process.argv[1] ?? "")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
