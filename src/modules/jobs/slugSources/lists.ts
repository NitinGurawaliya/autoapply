/**
 * The open company lists discovery may import (Phase M, M3; docs/boards/TDD.md fact 16, owner 9 Nov: all of them).
 * Each is pinned to the version imported and carries its licence. Only lists we may use commercially are allowed (MIT,
 * CC BY with credit); a non-commercial list (CC BY-NC) is refused by name, so its slugs never reach discovery. We take
 * slugs and company names from these lists (facts), never job texts: every slug is checked on the board's own API.
 */

export type SlugList = { name: string; licence: string; source: string; version: string; credit?: string };

const ALLOWED_LICENCES = new Set(["MIT", "CC-BY-4.0"]);

export const SLUG_LISTS: SlugList[] = [
  { name: "ats-scrapers", licence: "MIT", source: "https://github.com/kalil0321/ats-scrapers/tree/main/ats-companies", version: "6b44a1badc9bfbf5cf176f75265cc5729e520e99" },
  { name: "upstreamit", licence: "MIT", source: "https://github.com/ElliotGbaum/upstreamit/tree/main/data/slugs (*-live.txt)", version: "bbf926c83733c74b9c404dbbd6fa0921f43d47e9" },
  {
    name: "latmay",
    licence: "CC-BY-4.0",
    source: "https://huggingface.co/datasets/latmay/ats-career-page-urls",
    version: "e2e25e5fed3964ec6f2f90cee503ea490c5122aa",
    credit: "ATS career page URLs by latmay (Hugging Face), CC BY 4.0",
  },
  // Registered 17 Nov (M3: the planning's other MIT lists). Slugs only; openroles' Zoho names become both portal hosts.
  { name: "openroles", licence: "MIT", source: "https://github.com/datascry/openroles/tree/main/data/tenants", version: "8de53f077b3c3fcdfd556a107d1439c4a1cdfac7" },
  { name: "jobseek", licence: "MIT", source: "https://github.com/colophon-group/jobseek/blob/main/apps/crawler/data/boards.csv", version: "5fcebc679cf8bde9c9e04f1a2711f6f0a80c61e4" },
  { name: "open-ats-feed", licence: "MIT", source: "https://github.com/veresk06/open-ats-feed/tree/main/docs/data", version: "01b3908c8a8fe13bb4117cd2b2f7e2c7d489a108" },
  { name: "job-scraper", licence: "MIT", source: "https://github.com/chrisdothtml/job-scraper/blob/main/src/companies/seed.ts", version: "d016a7890346619f2b1999bd1b75a673c209a172" },
  // Known and refused: its data is non-commercial only.
  { name: "feashliaa", licence: "CC-BY-NC-4.0", source: "https://github.com/Feashliaa/job-board-aggregator", version: "-" },
];

/** The list a `--from list:<name>` names, when we may import it; throws for an unknown or non-commercial list. */
export function allowedList(name: string): SlugList {
  const list = SLUG_LISTS.find((item) => item.name === name);
  if (!list) throw new Error(`Unknown slug list "${name}": add it to slugSources/lists.ts with its licence first`);
  if (!ALLOWED_LICENCES.has(list.licence)) throw new Error(`Slug list "${name}" is ${list.licence}: not allowed (commercial use)`);
  return list;
}
