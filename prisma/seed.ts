import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/** Companies on public Greenhouse, Lever, and Ashby boards that hire in India or remote. */
export const COMPANIES: Array<{
  source: string;
  slug: string;
  name: string;
}> = [
  { source: "greenhouse", slug: "groww", name: "Groww" },
  { source: "greenhouse", slug: "slice", name: "slice" },
  { source: "greenhouse", slug: "hackerrank", name: "HackerRank" },
  { source: "greenhouse", slug: "druva", name: "Druva" },
  { source: "greenhouse", slug: "rubrik", name: "Rubrik" },
  { source: "greenhouse", slug: "inmobi", name: "InMobi" },
  { source: "greenhouse", slug: "turing", name: "Turing" },
  { source: "greenhouse", slug: "mongodb", name: "MongoDB" },
  { source: "greenhouse", slug: "databricks", name: "Databricks" },
  { source: "greenhouse", slug: "stripe", name: "Stripe" },
  { source: "greenhouse", slug: "okta", name: "Okta" },
  { source: "greenhouse", slug: "zscaler", name: "Zscaler" },
  { source: "greenhouse", slug: "purestorage", name: "Pure Storage" },
  { source: "greenhouse", slug: "roku", name: "Roku" },
  { source: "greenhouse", slug: "netskope", name: "Netskope" },
  { source: "greenhouse", slug: "gitlab", name: "GitLab" },
  { source: "greenhouse", slug: "anaplan", name: "Anaplan" },
  { source: "greenhouse", slug: "highradius", name: "HighRadius" },
  { source: "greenhouse", slug: "fivetran", name: "Fivetran" },
  { source: "greenhouse", slug: "toast", name: "Toast" },
  { source: "greenhouse", slug: "commvault", name: "Commvault" },
  { source: "greenhouse", slug: "twilio", name: "Twilio" },
  { source: "greenhouse", slug: "singlestore", name: "SingleStore" },
  { source: "greenhouse", slug: "samsara", name: "Samsara" },
  { source: "greenhouse", slug: "agoda", name: "Agoda" },
  { source: "greenhouse", slug: "newrelic", name: "New Relic" },
  { source: "greenhouse", slug: "sumologic", name: "Sumo Logic" },
  { source: "greenhouse", slug: "thoughtworks", name: "Thoughtworks" },
  { source: "greenhouse", slug: "cloudflare", name: "Cloudflare" },
  { source: "greenhouse", slug: "coinbase", name: "Coinbase" },
  { source: "greenhouse", slug: "airbnb", name: "Airbnb" },
  { source: "lever", slug: "hevodata", name: "Hevo Data" },
  { source: "lever", slug: "cred", name: "CRED" },
  { source: "lever", slug: "meesho", name: "Meesho" },
  { source: "lever", slug: "paytm", name: "Paytm" },
  { source: "lever", slug: "epifi", name: "Fi" },
  { source: "lever", slug: "zimperium", name: "Zimperium" },
  { source: "lever", slug: "levelai", name: "Level AI" },
  { source: "lever", slug: "fampay", name: "FamPay" },
  { source: "lever", slug: "binance", name: "Binance" },
  { source: "lever", slug: "palantir", name: "Palantir" },
  { source: "ashby", slug: "atlan", name: "Atlan" },
  { source: "ashby", slug: "posthog", name: "PostHog" },
  { source: "ashby", slug: "supabase", name: "Supabase" },
  { source: "ashby", slug: "cursor", name: "Cursor" },
  { source: "ashby", slug: "openai", name: "OpenAI" },
  { source: "ashby", slug: "notion", name: "Notion" },
  { source: "ashby", slug: "snowflake", name: "Snowflake" },
  { source: "ashby", slug: "ashby", name: "Ashby" },
];

async function main() {
  for (const company of COMPANIES) {
    await db.company.upsert({
      where: {
        source_slug: { source: company.source, slug: company.slug },
      },
      update: { name: company.name, active: true },
      create: {
        source: company.source,
        slug: company.slug,
        name: company.name,
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
