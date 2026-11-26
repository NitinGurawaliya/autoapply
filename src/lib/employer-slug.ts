// Employer slugs (Phase W, docs/employers/TDD.md 4.4): the /companies/<slug> part of a public address. ASCII, lower
// case, hyphens, never a dot (src/proxy.ts's matcher skips dotted paths). Set once when an employer is created and
// never changed afterwards: a rename keeps it, a merge turns the loser's slug into an alias.

/** Words a slug may not be: they are paths under /companies or read as one. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set(["browse", "search", "new", "api", "page", "a-z", "all", "top"]);

const MAX_LENGTH = 60;

/** The name as plain ASCII: NFKD, diacritics dropped, lower case. */
function ascii(text: string) {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The name as a slug candidate: `[a-z0-9-]`, at most 60 characters, cut at a hyphen, never reserved or one character. */
export function slugBase(name: string): string {
  let slug = ascii(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > MAX_LENGTH) {
    const cut = slug.slice(0, MAX_LENGTH);
    const hyphen = cut.lastIndexOf("-");
    slug = (hyphen > 0 ? cut.slice(0, hyphen) : cut).replace(/-+$/g, "");
  }
  if (!slug) return "company";
  if (slug.length < 2 || RESERVED_SLUGS.has(slug)) return `${slug}-company`;
  return slug;
}

/** The sort key: lower-case ASCII letters and digits of the name; its first character is the letter on /companies. */
export function nameKeyOf(name: string): string {
  const key = ascii(name).replace(/[^a-z0-9]+/g, "");
  return key || "0";
}

/**
 * A slug for a new employer that is not in `taken` (employer slugs and aliases together): the name's, else the name's
 * with the domain's first label, else the name's with 2, 3, ... The caller adds the result to `taken`.
 */
export function employerSlug(name: string, domain: string | null, taken: ReadonlySet<string>): string {
  const base = slugBase(name);
  if (!taken.has(base)) return base;
  const label = domain ? ascii(domain.split(".")[0] ?? "").replace(/[^a-z0-9]+/g, "") : "";
  if (label) {
    const room = MAX_LENGTH - label.length - 1;
    const withLabel = `${room > 1 ? base.slice(0, room).replace(/-+$/g, "") : base.slice(0, 2)}-${label}`.slice(0, MAX_LENGTH).replace(/-+$/g, "");
    if (!taken.has(withLabel)) return withLabel;
  }
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const numbered = `${base.slice(0, MAX_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(numbered)) return numbered;
  }
}
