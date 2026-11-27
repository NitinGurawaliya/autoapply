import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { employerSlug, nameKeyOf, slugBase } from "@/lib/employer-slug";
import { employerDomain, isGenericCompanyName } from "./domains";
import { plainName } from "./logos";
import { PRIVATE_SOURCES } from "./private-sources";

// Employers: one real business above its board accounts (Phase W, docs/employers/TDD.md 4.4 and 4.6). An Employer is
// one website domain; every Company row belongs to one; names never merge rows on their own; Job stays under Company.

type Tx = Prisma.TransactionClient;

export { PRIVATE_SOURCES } from "./private-sources";

// Boards whose account name the company set itself (a tie between two spellings goes to these).
const SELF_NAMED = new Set(["ashby", "workable", "keka", "zohorecruit"]);
const BASIS_ORDER = ["owner", "board", "redirect", "job_links", "name_evidence"];

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The text two or more names start with, to a whole word, case ignored ("Deloitte East Africa" and "DeloitteNZ": "Deloitte"). */
function commonStart(names: string[]): string {
  const first = names[0] ?? "";
  let length = 0;
  while (length < first.length && names.every((name) => name.charAt(length).toLowerCase() === first.charAt(length).toLowerCase())) length += 1;
  const cut = first.slice(0, length);
  // Whole words only: "Infosys BPM" and "Infosys Limited" share "Infosys ", but "Tatra" and "Tata Steel" share nothing useful.
  const atWord = names.every((name) => name.length === length || !/[A-Za-z0-9]/.test(name.charAt(length)) || /[a-z]/.test(name.charAt(length - 1)) !== /[a-z]/.test(name.charAt(length)));
  return atWord ? cut.replace(/[\s,.&-]+$/g, "") : "";
}

/**
 * An employer's display name from its rows' names: each through plainName (no legal suffix or code), generic names
 * dropped, the most common wins; a tie goes to a name a company set itself (Ashby, Workable, Keka, Zoho), then the
 * shortest. When every name is different and they all start with the same word of 4 or more letters ("Deloitte East
 * Africa", "DeloitteNZ"), that word is the employer. With none left: the domain's first label, else a board slug's
 * first label ("abbott.zohorecruit.com" → "Abbott"), capitalised.
 */
export function displayName(rows: Array<{ name: string; source: string; slug?: string }>, domain: string | null): string {
  const seen = new Map<string, { name: string; count: number; self: boolean }>();
  for (const row of rows) {
    // A board address ("mrisoftware.wd501/External_CareerSite") is never a name; judged before plainName cuts "india" out of it.
    if (isGenericCompanyName(row.name)) continue;
    const name = plainName(row.name);
    if (!name || isGenericCompanyName(name)) continue;
    const entry = seen.get(name) ?? { name, count: 0, self: false };
    entry.count += 1;
    entry.self = entry.self || SELF_NAMED.has(row.source);
    seen.set(name, entry);
  }
  const best = [...seen.values()].sort((a, b) => b.count - a.count || Number(b.self) - Number(a.self) || a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
  if (best) {
    if (best.count === 1 && seen.size >= 2) {
      const shared = commonStart([...seen.keys()]);
      if (shared.length >= 4 && shared.length < best.name.length) return shared;
    }
    return best.name;
  }
  const label = domain?.split(".")[0] || rows.find((row) => row.slug)?.slug?.split(/[./]/)[0];
  return label ? capital(label) : "Company";
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
    const rows = await tx.company.findMany({ where: { employerId }, select: { name: true, source: true, slug: true, logoUrl: true, stage: true, indiaOpen: true } });
    if (rows.length === 0) return;
    const name = employer.nameBasis === "owner" ? employer.name : displayName(rows, employer.domain);
    const logoUrl = [...rows].sort((a, b) => Number(b.indiaOpen > 0) - Number(a.indiaOpen > 0)).find((row) => row.logoUrl)?.logoUrl ?? null;
    await tx.employer.update({ where: { id: employerId }, data: { name, nameKey: nameKeyOf(name), logoUrl, stage: commonOf(rows.map((row) => row.stage)) } });
  };
  if (client) await run(client);
  else await db.$transaction(run, { timeout: 30000 });
}

/**
 * Names a board row that carries only its board address ("mrisoftware.wd501/External_CareerSite") with the name its
 * board or website gives (`name`), and its employer after it (unless the owner named that). A row with a real name, or
 * a `name` that is itself generic, is left alone. True when the row was renamed.
 */
export async function nameBoardIdCompany(companyId: string, name: string | null | undefined): Promise<boolean> {
  const clean = name?.replace(/\s+/g, " ").trim();
  if (!clean || isGenericCompanyName(clean)) return false;
  const row = await db.company.findUnique({ where: { id: companyId }, select: { name: true, employerId: true } });
  if (!row || !isGenericCompanyName(row.name)) return false;
  await db.company.update({ where: { id: companyId }, data: { name: clean } });
  if (row.employerId) await refreshEmployer(row.employerId);
  return true;
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
      const company = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, slug: true, domain: true, domainBasis: true, employerId: true } });
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
        const name = displayName([{ name: company.name, source: "", slug: company.slug }], null);
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
        const name = displayName([{ name: company.name, source: "", slug: company.slug }], domain);
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
 * Links the rows with no employer or with a domain their employer lacks: India-hiring first. Does nothing until the
 * first build has run (buildAllEmployers), so the bigger employer of a domain keeps the bare slug.
 */
export async function linkPending(limit = 500): Promise<{ linked: number; created: number; merged: number }> {
  const result = { linked: 0, created: 0, merged: 0 };
  if (!(await db.employer.findFirst({ select: { id: true } }))) return result;
  // Rows that need work: no employer yet, or a domain their employer does not have (the facts sweep found it since).
  const due = await db.$queryRaw<Array<{ id: string }>>`
    SELECT c.id FROM "Company" c LEFT JOIN "Employer" e ON e.id = c."employerId"
    WHERE c."employerId" IS NULL OR (c.domain IS NOT NULL AND e.domain IS DISTINCT FROM c.domain)
    ORDER BY (c."indiaOpen" > 0) DESC, c."addedAt" ASC
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
 * The common relinks in a few statements (the first build left most rows without a domain; the backfill found them
 * since): a one-row employer whose row now has a domain no employer holds takes that domain (its slug stays), and a one-row
 * employer whose domain another employer holds joins it, its slug left as an alias. Rows that are anything else (an
 * employer with several accounts whose domain changed) are for linkPending, which does them one at a time.
 */
export async function relinkDomains(): Promise<{ domainSet: number; joined: number; left: number }> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('employers'))`;
      const domainSet = await tx.$executeRaw`
        WITH cand AS (
          SELECT DISTINCT ON (c.domain) c.domain, c."domainBasis" AS basis, c."employerId" AS eid
          FROM "Company" c JOIN "Employer" e ON e.id = c."employerId"
          WHERE c.domain IS NOT NULL AND e.domain IS NULL
            AND (SELECT count(*) FROM "Company" o WHERE o."employerId" = e.id) = 1
            AND NOT EXISTS (SELECT 1 FROM "Employer" h WHERE h.domain = c.domain)
          ORDER BY c.domain, c.id)
        UPDATE "Employer" e SET domain = cand.domain, "domainBasis" = cand.basis, "updatedAt" = now() FROM cand WHERE e.id = cand.eid`;
      const moves = await tx.$queryRaw<Array<{ id: string; old: string; target: string; slug: string }>>`
        SELECT c.id, e.id AS old, h.id AS target, e.slug
        FROM "Company" c JOIN "Employer" e ON e.id = c."employerId" JOIN "Employer" h ON h.domain = c.domain
        WHERE c.domain IS NOT NULL AND e.domain IS NULL AND h.id <> e.id
          AND (SELECT count(*) FROM "Company" o WHERE o."employerId" = e.id) = 1`;
      for (let at = 0; at < moves.length; at += 1000) {
        const chunk = moves.slice(at, at + 1000);
        await tx.$executeRaw`UPDATE "Company" c SET "employerId" = v.target, "linkedAt" = now()
          FROM (VALUES ${Prisma.join(chunk.map((m) => Prisma.sql`(${m.id}, ${m.target})`))}) AS v(id, target) WHERE c.id = v.id`;
        await tx.$executeRaw`INSERT INTO "EmployerAlias" (slug, "employerId") SELECT v.slug, v.target
          FROM (VALUES ${Prisma.join(chunk.map((m) => Prisma.sql`(${m.slug}, ${m.target})`))}) AS v(slug, target) ON CONFLICT (slug) DO NOTHING`;
        await tx.$executeRaw`DELETE FROM "Employer" WHERE id = ANY(${chunk.map((m) => m.old)}::text[])`;
      }
      const [left] = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM "Company" c JOIN "Employer" e ON e.id = c."employerId" WHERE c.domain IS NOT NULL AND e.domain IS DISTINCT FROM c.domain`;
      return { domainSet, joined: moves.length, left: left?.n ?? 0 };
    },
    { timeout: 120000, maxWait: 30000 },
  );
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

type BuildRow = { id: string; source: string; slug: string; name: string; domain: string | null; domainBasis: string | null; stage: string | null; logoUrl: string | null; indiaOpen: number; lastFetchCount: number | null };

/**
 * The first build (TDD 4.6): every Company row grouped by domain (a row without one is its own group), the employer of
 * more listed jobs first so it keeps the bare slug, written in bulk. Refuses to run when any employer exists. A dry run
 * counts and writes nothing.
 */
export async function buildAllEmployers(options: { write: boolean }): Promise<{ employers: number; rows: number; withDomain: number; multiRow: number }> {
  if (await db.employer.findFirst({ select: { id: true } })) throw new Error("employers already exist: buildAllEmployers runs only on an empty Employer table (linkPending keeps them current)");
  const rows = await db.$queryRaw<BuildRow[]>`SELECT id, source, slug, name, domain, "domainBasis", stage, "logoUrl", "indiaOpen", "lastFetchCount" FROM "Company"`;
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

/**
 * Recomputes the display name, logo and stage of employers whose rows changed since the build: those with several board
 * accounts and those still named "Company" (`scope` "multi"), or every employer ("all"). Slugs never change.
 */
export async function refreshAllEmployers(options: { scope: "multi" | "all" }): Promise<number> {
  const ids = await db.$queryRaw<Array<{ id: string }>>`
    SELECT e.id FROM "Employer" e
    WHERE ${options.scope === "all"} OR e.name = 'Company' OR (SELECT count(*) FROM "Company" c WHERE c."employerId" = e.id) > 1
    ORDER BY e.id`;
  for (const row of ids) await refreshEmployer(row.id).catch((error) => console.warn(`employers: refresh ${row.id} failed: ${error instanceof Error ? error.message.slice(0, 100) : "error"}`));
  return ids.length;
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
