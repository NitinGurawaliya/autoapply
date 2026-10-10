export type FetchedJob = {
  externalId: string;
  title: string;
  location: string;
  description: string;
  applyUrl: string;
  postedAt: Date;
  isRemote?: boolean;
  /** The board's office names and places ("India Locations", "Bengaluru @ Bengaluru, Karnataka, India"): where the job
   * can be done, used for eligibility when the location line says only "Remote" or names several places. */
  offices?: string[];
  raw: Record<string, unknown>;
};

// Greenhouse sends its descriptions HTML-escaped ("&lt;p&gt;"): unescape the markup first, or its tags stay as text.
const unescape = (text: string) =>
  text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");

export function plainText(value: string) {
  // Once to turn the escaped markup back into tags, once more for the entities inside the text ("&amp;amp;").
  return unescape(unescape(value).replace(/<[^>]+>/g, " "))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

export function asDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
