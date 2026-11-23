/**
 * Share links (Phase U, docs/share/TDD.md §3): `/j/<company>-<title>-<id>`. The text is only for people reading the
 * link in a post; the trailing job id is the key, so a link never breaks when a title changes, and a request whose text
 * differs from today's is redirected to the canonical path.
 */

const MAX_TEXT = 60;
// Job ids are Prisma cuids: lower-case letters and digits, no dash. Anything else is not an id.
const ID = /^[a-z0-9]{20,40}$/;

/** Lower case ASCII words joined by dashes, cut at a word boundary to 60 characters. */
export function slugText(...parts: string[]): string {
  const words = parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let text = "";
  for (const word of words) {
    const next = text ? `${text}-${word}` : word;
    if (next.length > MAX_TEXT) break;
    text = next;
  }
  return text;
}

/** The share page's path for a job. */
export function jobPath(job: { id: string; title: string; company: { name: string } }): string {
  const text = slugText(job.company.name, job.title);
  return text ? `/j/${text}-${job.id}` : `/j/${job.id}`;
}

/** The job id at the end of a share slug, or null when the slug does not end in one. */
export function jobIdFromSlug(slug: string): string | null {
  const id = decodeURIComponent(slug).split("-").pop() ?? "";
  return ID.test(id) ? id : null;
}

/** An absolute URL on this app (APP_URL), for the preview card and copied links. */
export function absoluteUrl(path: string): string {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}
