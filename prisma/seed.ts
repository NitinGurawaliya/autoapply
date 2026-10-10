import { PrismaClient } from "@prisma/client";
import { COMPANIES } from "./companies";

const db = new PrismaClient();

export { COMPANIES } from "./companies";

async function main() {
  for (const company of COMPANIES) {
    await db.company.upsert({
      where: {
        source_slug: { source: company.source, slug: company.slug },
      },
      update: { name: company.name, active: true, stage: company.stage },
      create: {
        source: company.source,
        slug: company.slug,
        name: company.name,
        stage: company.stage,
      },
    });
  }
  console.log(`seed: upserted ${COMPANIES.length} companies`);

  const mockCompany = await db.company.upsert({
    where: { source_slug: { source: "mock", slug: "greenhouse" } },
    update: { name: "SwipeApply Mock", active: false },
    create: {
      source: "mock",
      slug: "greenhouse",
      name: "SwipeApply Mock",
      active: false,
    },
  });
  const postedAt = new Date("2026-10-03T00:00:00.000Z");
  await db.job.upsert({
    where: { source_externalId: { source: "mock", externalId: "greenhouse" } },
    update: {
      companyId: mockCompany.id,
      title: "Software Engineer",
      location: "Remote",
      country: "REMOTE",
      remoteType: "remote",
      description: "Mock Greenhouse application used by test profiles.",
      applyUrl: "http://localhost:3000/mock/greenhouse",
    },
    create: {
      source: "mock",
      externalId: "greenhouse",
      companyId: mockCompany.id,
      title: "Software Engineer",
      location: "Remote",
      country: "REMOTE",
      remoteType: "remote",
      description: "Mock Greenhouse application used by test profiles.",
      applyUrl: "http://localhost:3000/mock/greenhouse",
      postedAt,
      fetchedAt: postedAt,
      raw: {},
    },
  });
  console.log("seed: upserted mock job");
}

main()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
