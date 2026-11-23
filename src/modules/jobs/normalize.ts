import type { Salary } from "./salary";

/** One reply from a board's API, the part of a fetch Response the fetchers read. */
export type HttpReply = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
};

/**
 * How a fetcher reaches a board's API: the process's own fetch by default; a board whose Cloudflare refuses this
 * server's requests (Workday, 17 Nov) can be read from inside the stealthy Chrome instead (modules/apply/board-reader.ts),
 * which sends the same requests the site's own page sends.
 */
export type BoardHttp = {
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpReply>;
};

export const processHttp: BoardHttp = {
  fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) }),
};

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
  /** Pay from the board's own structured fields (salary.ts), when it publishes any. */
  salary?: Salary | null;
  raw: Record<string, unknown>;
  /** Read from the board's list only, because ingest already holds this posting (Workday, M2): proves it is still listed,
   * carries no description, and never overwrites the stored row's content. */
  listOnly?: boolean;
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
