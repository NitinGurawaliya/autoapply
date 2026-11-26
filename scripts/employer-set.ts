// The owner's overrides on employers (modules/jobs/employers.ts, docs/employers/TDD.md W3). Each prints before and after.
// A row set by hand has basis "owner" and is never overwritten by the facts sweep.
//   npx tsx scripts/employer-set.ts --company <companyId> --domain <domain>   put one board account under that domain's employer
//   npx tsx scripts/employer-set.ts --split <companyId>                        take one board account out into its own employer
//   npx tsx scripts/employer-set.ts --employer <slug> --name "<display name>"  set an employer's display name (the slug stays)
import { db } from "../src/lib/db";
import { setCompanyDomain, setEmployerName, splitCompany } from "../src/modules/jobs/employers";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}

async function describe(companyId: string) {
  const row = await db.company.findUnique({ where: { id: companyId }, select: { source: true, slug: true, name: true, domain: true, domainBasis: true, employer: { select: { slug: true, name: true, domain: true } } } });
  return row ? `${row.source}/${row.slug} "${row.name}" domain=${row.domain ?? "-"} (${row.domainBasis ?? "-"}) employer=${row.employer ? `${row.employer.slug} "${row.employer.name}" ${row.employer.domain ?? "no domain"}` : "-"}` : "no such company";
}

async function main() {
  const company = arg("--company");
  const domain = arg("--domain");
  const split = arg("--split");
  const employer = arg("--employer");
  const name = arg("--name");
  if (company && domain) {
    console.log("before:", await describe(company));
    console.log("result:", await setCompanyDomain(company, domain));
    console.log("after: ", await describe(company));
  } else if (split) {
    console.log("before:", await describe(split));
    console.log("result:", await splitCompany(split));
    console.log("after: ", await describe(split));
  } else if (employer && name) {
    const before = await db.employer.findUnique({ where: { slug: employer }, select: { name: true } });
    if (!before) throw new Error(`no employer with slug ${employer}`);
    console.log(`before: "${before.name}"`);
    await setEmployerName(employer, name);
    console.log(`after:  "${name.trim()}" (slug ${employer} unchanged)`);
  } else {
    console.log("usage: --company <id> --domain <domain> | --split <companyId> | --employer <slug> --name \"<name>\"");
    process.exitCode = 1;
  }
  await db.$disconnect();
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed");
  await db.$disconnect();
  process.exit(1);
});
