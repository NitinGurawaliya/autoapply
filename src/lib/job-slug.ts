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

/**
 * This app's public origin. APP_URL tidied first: a stray space, newline or quotes pasted into a host's settings made
 * `new URL` throw in the share page's metadata, a 500 for every visitor (23 Nov). Without a usable APP_URL, Vercel's
 * own production host, else localhost.
 */
export function appOrigin(): string {
  const raw = (process.env.APP_URL ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (raw) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.hostname) return url.origin;
    } catch {
      // Not a URL even with a scheme: fall through.
    }
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

/** An absolute URL on this app, for the preview card, metadata and copied links. */
export function absoluteUrl(path: string): string {
  return `${appOrigin()}${path}`;
}
