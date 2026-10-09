import { db } from "@/lib/db";

// What actually happened when applications went to each company, across every user. Only company-level counts leave
// this module: never who applied or what they said.

export type CompanyResult = {
  companyId: string;
  company: string;
  source: string;
  submitted: number;
  failed: number;
  finished: number; // submitted + failed + blocked-by-run, the runs that reached an outcome
  codeAsked: number; // runs where the form asked for an emailed security code
};

export type Verdict = {
  /** Shown on the card when something is worth knowing before swiping. */
  hint: string | null;
  /** A small nudge to the feed order; the match score itself is never changed. */
  nudge: number;
};

const MIN_RUNS = 3;

/** Turns a company's history into a hint and a ranking nudge. Needs a few runs before it says anything. */
export function judge(result: CompanyResult | undefined): Verdict {
  if (!result || result.finished < MIN_RUNS) return { hint: null, nudge: 0 };
  const codeRate = result.codeAsked / result.finished;
  const failRate = result.failed / result.finished;
  if (failRate >= 0.6) return { hint: "Often fails to submit", nudge: -4 };
  if (codeRate >= 0.5) return { hint: "Usually needs an emailed code", nudge: -2 };
  if (result.submitted >= 2 && failRate < 0.3 && codeRate < 0.3) return { hint: null, nudge: 3 };
  return { hint: null, nudge: 0 };
}

export async function loadCompanyResults(): Promise<CompanyResult[]> {
  const rows = await db.$queryRaw<
    Array<{ companyId: string; company: string; source: string; submitted: bigint; failed: bigint; finished: bigint; codeAsked: bigint }>
  >`
    SELECT c."id" AS "companyId", c."name" AS "company", j."source" AS "source",
      count(*) FILTER (WHERE a."status" = 'submitted') AS "submitted",
      count(*) FILTER (WHERE a."status" = 'failed') AS "failed",
      count(*) FILTER (WHERE a."status" IN ('submitted', 'failed')) AS "finished",
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "ApplicationEvent" e
        WHERE e."applicationId" = a."id" AND e."type" = 'ask_user' AND e."message" ILIKE '%security code%'
      )) AS "codeAsked"
    FROM "Application" a
    JOIN "Job" j ON j."id" = a."jobId"
    JOIN "Company" c ON c."id" = j."companyId"
    WHERE j."source" <> 'mock'
    GROUP BY c."id", c."name", j."source"`;
  return rows.map((row) => ({
    companyId: row.companyId,
    company: row.company,
    source: row.source,
    submitted: Number(row.submitted),
    failed: Number(row.failed),
    finished: Number(row.finished),
    codeAsked: Number(row.codeAsked),
  }));
}

let cache: { at: number; byCompany: Map<string, CompanyResult> } | null = null;

/** The same numbers for every feed load in the next minute; the data changes slowly. */
export async function companyResultsById(maxAgeMs = 60_000) {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.byCompany;
  const byCompany = new Map((await loadCompanyResults()).map((row) => [row.companyId, row]));
  cache = { at: Date.now(), byCompany };
  return byCompany;
}

export function clearCompanyResultsCache() {
  cache = null;
}
