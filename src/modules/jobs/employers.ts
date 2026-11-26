import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { employerSlug, nameKeyOf, slugBase } from "@/lib/employer-slug";
import { SITES } from "@/modules/sources/sites";
import { employerDomain, isGenericCompanyName } from "./domains";
import { plainName } from "./logos";

// Employers: one real business above its board accounts (Phase W, docs/employers/TDD.md 4.4 and 4.6). An Employer is
// one website domain; every Company row belongs to one; names never merge rows on their own; Job stays under Company.

type Tx = Prisma.TransactionClient;

/** Sources whose jobs are never shown publicly or counted for a public page: signed-in ones (Naukri) and the mock board. */
export const PRIVATE_SOURCES: readonly string[] = [...SITES, "mock"];

// Boards whose account name the company set itself (a tie between two spellings goes to these).
const SELF_NAMED = new Set(["ashby", "workable", "keka", "zohorecruit"]);
const BASIS_ORDER = ["owner", "board", "redirect", "job_links", "name_evidence"];

/**
 * An employer's display name from its rows' names: each through plainName (no legal suffix or code), generic names
 * dropped, the most common wins; a tie goes to a name a company set itself (Ashby, Workable, Keka, Zoho), then the
 * shortest. With none left: the domain's first label, capitalised.
 */
export function displayName(rows: Array<{ name: string; source: string }>, domain: string | null): string {
  const seen = new Map<string, { name: string; count: number; self: boolean }>();
  for (const row of rows) {
    const name = plainName(row.name);
    if (!name || isGenericCompanyName(name)) continue;
    const entry = seen.get(name) ?? { name, count: 0, self: false };
    entry.count += 1;
    entry.self = entry.self || SELF_NAMED.has(row.source);
    seen.set(name, entry);
  }
  const best = [...seen.values()].sort((a, b) => b.count - a.count || Number(b.self) - Number(a.self) || a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
  if (best) return best.name;
  const label = domain?.split(".")[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Company";
}

/** The slug for a new employer: free among employer slugs and aliases. */
async function freeSlug(tx: Tx, name: string, domain: string | null): Promise<string> {
  const base = slugBase(name);
  const rows = await tx.$queryRaw<Array<{ slug: string }>>`
    SELECT slug FROM "Employer" WHERE slug = ${base} OR slug LIKE ${`${base}-%`}
    UNION SELECT slug FROM "EmployerAlias" WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`;
  return employerSlug(name, domain, new Set(rows.map((row) => row.slug)));
}

const commonOf = (values: Array<string | null>) => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
};

/**
 * Recomputes an employer's name (unless the owner set it), logo and stage from its rows. The slug is never touched.
 */
export async function refreshEmployer(employerId: string, client?: Tx): Promise<void> {
  const run = async (tx: Tx) => {
    const employer = await tx.employer.findUnique({ where: { id: employerId }, select: { name: true, nameBasis: true, domain: true } });
    if (!employer) return;
    const rows = await tx.company.findMany({ where: { employerId }, select: { name: true, source: true, logoUrl: true, stage: true, indiaOpen: true } });
    if (rows.length === 0) return;
    const name = employer.nameBasis === "owner" ? employer.name : displayName(rows, employer.domain);
    const logoUrl = [...rows].sort((a, b) => Number(b.indiaOpen > 0) - Number(a.indiaOpen > 0)).find((row) => row.logoUrl)?.logoUrl ?? null;
    await tx.employer.update({ where: { id: employerId }, data: { name, nameKey: nameKeyOf(name), logoUrl, stage: commonOf(rows.map((row) => row.stage)) } });
  };
  if (client) await run(client);
  else await db.$transaction(run, { timeout: 30000 });
}

/** The loser's slug (and every alias pointing at it) becomes an alias of the survivor; the loser is deleted. */
async function mergeInto(tx: Tx, survivorId: string, loserId: string): Promise<void> {
  const loser = await tx.employer.findUnique({ where: { id: loserId }, select: { slug: true } });
  if (!loser) return;
  await tx.employerAlias.upsert({ where: { slug: loser.slug }, create: { slug: loser.slug, employerId: survivorId }, update: { employerId: survivorId } });
  await tx.employerAlias.updateMany({ where: { employerId: loserId }, data: { employerId: survivorId } });
  await tx.employer.delete({ where: { id: loserId } });
}

export type LinkResult = "kept" | "created" | "joined" | "merged" | "domain_set";

/**
 * Puts one board account under its employer (TDD 4.6), in one transaction under an advisory lock so two linkers never
 * race on a domain: the employer with its domain, a new one when none has it, a one-row employer without a domain, the
 * lone row's own employer given the domain when a row's domain turns up. An emptied employer merges into the one its
 * last row moved to (its slug stays as an alias).
 */
export async function linkCompany(companyId: string): Promise<LinkResult> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employers'))`;
      const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, domain: true, domainBasis: true, employerId: true } });
      if (!company) return "kept";
      const current = company.employerId ? await tx.employer.findUnique({ where: { id: company.employerId }, select: { id: true, domain: true } }) : null;
      const rowsInCurrent = current ? await tx.company.count({ where: { employerId: current.id } }) : 0;
      const alone = rowsInCurrent === 1;
      const touch = () => tx.company.update({ where: { id: companyId }, data: { linkedAt: new Date() } });
      const move = async (to: string) => {
        await tx.company.update({ where: { id: companyId }, data: { employerId: to, linkedAt: new Date() } });
      };
      // The employer this row left, when that was its last row: merged into the survivor. True when it was.
      const leave = async (survivor: string) => {
        if (!current || current.id === survivor || (await tx.company.count({ where: { employerId: current.id } })) > 0) return false;
        await mergeInto(tx, survivor, current.id);
        return true;
      };
      const domain = company.domain;

      if (!domain) {
        if (current && alone && current.domain === null) {
          await touch();
          return "kept";
        }
        const name = displayName([{ name: company.name, source: "" }], null);
        const created = await tx.employer.create({ data: { slug: await freeSlug(tx, name, null), name, nameKey: nameKeyOf(name) } });
        await move(created.id);
        const merged = await leave(created.id);
        await refreshEmployer(created.id, tx);
        if (current && !merged) await refreshEmployer(current.id, tx);
        return "created";
      }

      const target = await tx.employer.findUnique({ where: { domain }, select: { id: true } });
      if (!target) {
        if (current && alone) {
          await tx.employer.update({ where: { id: current.id }, data: { domain, domainBasis: company.domainBasis } });
          await touch();
          await refreshEmployer(current.id, tx);
          return "domain_set";
        }
        const name = displayName([{ name: company.name, source: "" }], domain);
        const created = await tx.employer.create({ data: { slug: await freeSlug(tx, name, domain), name, nameKey: nameKeyOf(name), domain, domainBasis: company.domainBasis } });
        await move(created.id);
        const merged = await leave(created.id);
        await refreshEmployer(created.id, tx);
        if (current && !merged) await refreshEmployer(current.id, tx);
        return "created";
      }
      if (target.id === company.employerId) {
        await touch();
        return "kept";
      }
      await move(target.id);
      const merged = await leave(target.id);
      await refreshEmployer(target.id, tx);
      if (current && !merged) await refreshEmployer(current.id, tx);
      return merged ? "merged" : "joined";
    },
    { timeout: 30000 },
  );
}

/**
 * Links the rows with no employer, never linked, or looked at again since: India-hiring first. Does nothing until the
 * first build has run (buildAllEmployers), so the bigger employer of a domain keeps the bare slug.
 */
export async function linkPending(limit = 500): Promise<{ linked: number; created: number; merged: number }> {
  const result = { linked: 0, created: 0, merged: 0 };
  if (!(await db.employer.findFirst({ select: { id: true } }))) return result;
  const due = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Company"
    WHERE "employerId" IS NULL OR "linkedAt" IS NULL OR "linkedAt" < "domainCheckedAt"
    ORDER BY ("indiaOpen" > 0) DESC, "addedAt" ASC
    LIMIT ${limit}`;
  for (const row of due) {
    try {
      const outcome = await linkCompany(row.id);
      result.linked += 1;
      if (outcome === "created") result.created += 1;
      if (outcome === "merged") result.merged += 1;
    } catch (error) {
      console.warn(`employers: link ${row.id} failed: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`);
    }
  }
  return result;
}

/**
 * Open public jobs and open India jobs per employer, in one statement (TDD 4.6): signed-in and mock sources never
 * count; neither does a company not read in the last 3 days. Returns the employers whose counts changed.
 */
export async function refreshEmployerCounts(): Promise<number> {
  return db.$executeRaw`
    WITH counts AS (
      SELECT c."employerId" AS id, count(*)::int AS open,
             count(*) FILTER (WHERE j.eligibility IN ('india', 'remote_india'))::int AS india
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
      WHERE j."closedAt" IS NULL AND c."employerId" IS NOT NULL
        AND j.source <> ALL(${[...PRIVATE_SOURCES]}::text[])
        AND c."lastFetchedAt" > now() - interval '3 days'
      GROUP BY 1)
    UPDATE "Employer" e SET "openJobs" = coalesce(k.open, 0), "openIndia" = coalesce(k.india, 0), "updatedAt" = now()
    FROM "Employer" e2 LEFT JOIN counts k ON k.id = e2.id
    WHERE e.id = e2.id AND (e."openJobs" <> coalesce(k.open, 0) OR e."openIndia" <> coalesce(k.india, 0))`;
}

type BuildRow = { id: string; source: string; name: string; domain: string | null; domainBasis: string | null; stage: string | null; logoUrl: string | null; indiaOpen: number; lastFetchCount: number | null };

/**
 * The first build (TDD 4.6): every Company row grouped by domain (a row without one is its own group), the employer of
 * more listed jobs first so it keeps the bare slug, written in bulk. Refuses to run when any employer exists. A dry run
 * counts and writes nothing.
 */
export async function buildAllEmployers(options: { write: boolean }): Promise<{ employers: number; rows: number; withDomain: number; multiRow: number }> {
  if (await db.employer.findFirst({ select: { id: true } })) throw new Error("employers already exist: buildAllEmployers runs only on an empty Employer table (linkPending keeps them current)");
  const rows = await db.$queryRaw<BuildRow[]>`SELECT id, source, name, domain, "domainBasis", stage, "logoUrl", "indiaOpen", "lastFetchCount" FROM "Company"`;
  const groups = new Map<string, BuildRow[]>();
  for (const row of rows) {
    const key = row.domain ? `d:${row.domain}` : `c:${row.id}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const weight = (group: BuildRow[]) => group.reduce((sum, row) => sum + (row.lastFetchCount ?? 0), 0);
  const ordered = [...groups.values()].sort((a, b) => weight(b) - weight(a) || (a[0]?.name ?? "").localeCompare(b[0]?.name ?? ""));
  const taken = new Set<string>();
  const employers: Array<Prisma.EmployerCreateManyInput> = [];
  const links: Array<[string, string]> = [];
  for (const group of ordered) {
    const domain = group[0]?.domain ?? null;
    const name = displayName(group, domain);
    const slug = employerSlug(name, domain, taken);
    taken.add(slug);
    const id = randomUUID();
    const basis = domain ? (BASIS_ORDER.find((b) => group.some((row) => row.domainBasis === b)) ?? null) : null;
    employers.push({
      id,
      slug,
      name,
      nameKey: nameKeyOf(name),
      domain,
      domainBasis: basis,
      logoUrl: [...group].sort((a, b) => Number(b.indiaOpen > 0) - Number(a.indiaOpen > 0)).find((row) => row.logoUrl)?.logoUrl ?? null,
      stage: commonOf(group.map((row) => row.stage)),
    });
    for (const row of group) links.push([row.id, id]);
  }
  const summary = { employers: employers.length, rows: rows.length, withDomain: employers.filter((e) => e.domain).length, multiRow: ordered.filter((g) => g.length > 1).length };
  if (!options.write) return summary;
  for (let at = 0; at < employers.length; at += 1000) await db.employer.createMany({ data: employers.slice(at, at + 1000) });
  for (let at = 0; at < links.length; at += 1000) {
    const chunk = links.slice(at, at + 1000);
    await db.$executeRaw`UPDATE "Company" c SET "employerId" = v.eid, "linkedAt" = now()
      FROM (VALUES ${Prisma.join(chunk.map(([id, eid]) => Prisma.sql`(${id}, ${eid})`))}) AS v(id, eid) WHERE c.id = v.id`;
  }
  await refreshEmployerCounts();
  return summary;
}

// The owner's overrides (scripts/employer-set.ts). A row with an owner basis is never overwritten by the facts sweep.

/** Sets one row's domain by hand (basis `owner`) and links it. Throws when the address cannot be an employer's own. */
export async function setCompanyDomain(companyId: string, address: string): Promise<LinkResult> {
  const domain = employerDomain(address);
  if (!domain) throw new Error(`"${address}" cannot be an employer's own website`);
  await db.company.update({ where: { id: companyId }, data: { domain, domainBasis: "owner", domainCheckedAt: new Date() } });
  return linkCompany(companyId);
}

/** Takes one row out of its employer into its own (a wrong join undone): no domain, basis `owner`. */
export async function splitCompany(companyId: string): Promise<LinkResult> {
  await db.company.update({ where: { id: companyId }, data: { domain: null, domainBasis: "owner", domainCheckedAt: new Date() } });
  return linkCompany(companyId);
}

/** Sets an employer's display name by hand; refreshEmployer leaves it alone from then on. The slug stays. */
export async function setEmployerName(slug: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new Error("a name is needed");
  await db.employer.update({ where: { slug }, data: { name: clean, nameKey: nameKeyOf(clean), nameBasis: "owner" } });
}
