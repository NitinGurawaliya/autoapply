import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchAshby } from "./fetchers/ashby";
import { fetchGreenhouse } from "./fetchers/greenhouse";
import { fetchLever } from "./fetchers/lever";
import type { FetchedJob } from "./normalize";
import { tagPosting } from "./tagging";

async function fetchCompany(source: string, slug: string): Promise<FetchedJob[]> {
  if (source === "greenhouse") return fetchGreenhouse(slug);
  if (source === "lever") return fetchLever(slug);
  if (source === "ashby") return fetchAshby(slug);
  return [];
}

export async function ingestJobs(days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const companies = await db.company.findMany({
    where: { active: true },
    orderBy: [{ source: "asc" }, { name: "asc" }],
  });

  for (const company of companies) {
    let fetched = 0;
    let kept = 0;
    try {
      const jobs = await fetchCompany(company.source, company.slug);
      fetched = jobs.length;
      for (const job of jobs) {
        if (job.postedAt.getTime() < cutoff) continue;
        const tags = tagPosting(job);
        const fetchedAt = new Date();
        await db.job.upsert({
          where: { source_externalId: { source: company.source, externalId: job.externalId } },
          create: {
            source: company.source,
            externalId: job.externalId,
            companyId: company.id,
            title: job.title,
            location: job.location,
            country: tags.country,
            remoteType: tags.remoteType,
            experienceMin: tags.experienceMin,
            description: job.description,
            applyUrl: job.applyUrl,
            postedAt: job.postedAt,
            fetchedAt,
            raw: job.raw as Prisma.InputJsonValue,
          },
          update: {
            companyId: company.id,
            title: job.title,
            location: job.location,
            country: tags.country,
            remoteType: tags.remoteType,
            experienceMin: tags.experienceMin,
            description: job.description,
            applyUrl: job.applyUrl,
            postedAt: job.postedAt,
            fetchedAt,
            raw: job.raw as Prisma.InputJsonValue,
          },
        });
        kept += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "fetch failed";
      console.error(`ingest error ${company.source} ${company.slug}: ${message}`);
    }
    await db.company.update({
      where: { id: company.id },
      data: { lastFetchedAt: new Date(), lastFetchCount: fetched },
    });
    console.log(`${company.source} | ${company.name} | ${fetched} | ${kept}`);
  }
}
