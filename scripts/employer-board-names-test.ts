// Employers and board rows are never named by a board address ("mrisoftware.wd501/External_CareerSite"; 27 Nov):
// isBoardIdName, displayName skipping such names, Workday's hiring organisation as the name, and (read-only) no employer
// with open jobs whose name is a Workday site, a Zoho portal or a Workday site id. Writes nothing.
//   npx tsx scripts/employer-board-names-test.ts [--no-db]
import { db } from "../src/lib/db";
import { isBoardIdName, isGenericCompanyName } from "../src/modules/jobs/domains";
import { displayName } from "../src/modules/jobs/employers";
import { cleanHiringName, hiringNameOf } from "../src/modules/jobs/fetchers/workday";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

// Board addresses are not names; names with a slash are.
eq("a Workday site is a board address", isBoardIdName("mrisoftware.wd501/External_CareerSite"), true);
eq("a lower-cased Workday site too", isBoardIdName("cadence.wd1/external_careers"), true);
eq("a Workday tenant alone too", isBoardIdName("otis.wd504"), true);
eq("a Zoho portal too", isBoardIdName("mycloudassist.zohorecruit.in/alifconsulting"), true);
eq("a bare site id too", isBoardIdName("External_CareerSite"), true);
eq("Turn/River is a name", isBoardIdName("Turn/River"), false);
eq("Metro/makro is a name", isBoardIdName("Metro/makro"), false);
eq("Web.com is a name", isBoardIdName("Web.com"), false);
eq("a board address is generic (the facts sweep renames it)", isGenericCompanyName("globalhr.wd5/REC_RTX_Ext_Gateway"), true);

// The employer's name never comes from a board address.
eq("a board address is skipped for the domain's label", displayName([{ name: "cadence.wd1/External_Careers", source: "workday", slug: "cadence.wd1/External_Careers" }], "cadence.com"), "Cadence");
eq("with no domain, the tenant", displayName([{ name: "mrisoftware.wd501/External_CareerSite", source: "workday", slug: "mrisoftware.wd501/External_CareerSite" }], null), "Mrisoftware");
eq("a named row wins over its twin named by address", displayName([{ name: "cat.wd5/caterpillarcareers", source: "workday", slug: "cat.wd5/caterpillarcareers" }, { name: "Caterpillar", source: "workday", slug: "cat.wd5/CaterpillarCareers" }], "cat.com"), "Caterpillar");
eq("an India Zoho portal's address is skipped whole, not cut to 'aristo-'", displayName([{ name: "aristo-india.zohorecruit.in/careers", source: "zohorecruit", slug: "aristo-india.zohorecruit.in/careers" }], null), "Aristo-india");

// Workday's hiring organisation as the name.
eq("Private Limited is cut", cleanHiringName("MRI Software India Private Limited"), "MRI Software");
eq("Inc. is cut", cleanHiringName("Caterpillar Inc."), "Caterpillar");
eq("empty is null", cleanHiringName("  "), null);
eq("the most named organisation of a read", hiringNameOf([{ raw: { hiringOrganization: "RTX" } }, { raw: { hiringOrganization: "Pratt & Whitney" } }, { raw: { hiringOrganization: "RTX" } }, { raw: {} }]), "RTX");
eq("none named: null", hiringNameOf([{ raw: { id: "1" } }]), null);

async function database() {
  // The tenant pattern: a Workday site or tenant, a Zoho portal, a Workday site id.
  const rows = await db.$queryRaw<Array<{ slug: string; name: string; openJobs: number }>>`
    SELECT slug, name, "openJobs" FROM "Employer"
    WHERE "openJobs" > 0 AND (name ~* '\.wd[0-9]{1,3}(/|$)' OR name ~* '\.zohorecruit\.' OR name ~* 'External_')`;
  eq("no employer with open jobs is named by a board address", rows.map((row) => `${row.slug}: ${row.name}`), []);
  const [companies] = await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM "Company" c JOIN "Employer" e ON e.id = c."employerId"
    WHERE e."openJobs" > 0 AND e."nameBasis" IS DISTINCT FROM 'owner' AND (c.name ~* '\.wd[0-9]{1,3}(/|$)' OR c.name ~* '\.zohorecruit\.' OR c.name ~* 'External_')`;
  eq("no board row behind them is named by a board address", companies?.n ?? -1, 0);
}

(process.argv.includes("--no-db") ? Promise.resolve() : database())
  .catch((error) => {
    failed += 1;
    console.log(`FAIL database check (${error instanceof Error ? error.message.slice(0, 120) : "error"})`);
  })
  .finally(async () => {
    await db.$disconnect();
    console.log(failed === 0 ? "PASS employer-board-names-test" : `FAIL employer-board-names-test (${failed})`);
    process.exit(failed === 0 ? 0 : 1);
  });
