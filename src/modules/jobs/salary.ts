import { z } from "zod";

/**
 * Pay, from the board's own structured fields only (Phase M5, docs/job-match/TDD.md §3): never parsed from the
 * description, so a figure on the card is one the employer published.
 */

export type Salary = { min: number | null; max: number | null; currency: string; period: "year" | "month" | "hour" };

const SYMBOL: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", SGD: "S$", AUD: "A$", CAD: "C$" };
const PERIOD_SUFFIX: Record<Salary["period"], string> = { year: " / yr", month: " / mo", hour: " / hr" };

function amount(value: number, currency: string, period: Salary["period"]) {
  const symbol = SYMBOL[currency] ?? `${currency} `;
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  if (currency === "INR" && period === "year") {
    // Indian pay is read in lakhs and crores ("₹15L", "₹1.2Cr").
    if (value >= 1e7) return `${symbol}${trim(Math.round(value / 1e6) / 10)}Cr`;
    if (value >= 1e5) return `${symbol}${trim(Math.round(value / 1e4) / 10)}L`;
  }
  if (value >= 1e6) return `${symbol}${trim(Math.round(value / 1e5) / 10)}M`;
  if (value >= 1e4) return `${symbol}${Math.round(value / 1e3)}k`;
  return `${symbol}${Math.round(value).toLocaleString("en-IN")}`;
}

/** "₹15L – ₹30L", "$120k – $150k / yr", "From ₹8L", "Up to €60k / yr"; null without a usable figure. */
export function formatSalary(salary: { min: number | null; max: number | null; currency: string | null; period: string | null }): string | null {
  const { min, max, currency } = salary;
  const period = (["year", "month", "hour"] as const).find((value) => value === salary.period);
  const valid = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0;
  if (!currency || !period || (!valid(min) && !valid(max))) return null;
  // Yearly Indian pay needs no suffix ("LPA" is how it is always read); everything else says its period.
  const suffix = currency === "INR" && period === "year" ? "" : PERIOD_SUFFIX[period];
  if (valid(min) && valid(max) && max > min) return `${amount(min, currency, period)} – ${amount(max, currency, period)}${suffix}`;
  if (valid(min) && valid(max)) return `${amount(min, currency, period)}${suffix}`;
  if (valid(min)) return `From ${amount(min, currency, period)}${suffix}`;
  return `Up to ${amount(max!, currency, period)}${suffix}`;
}

const ASHBY_PERIOD: Record<string, Salary["period"]> = { "1 YEAR": "year", "1 MONTH": "month", "1 HOUR": "hour" };
const ashbyComponents = z.object({
  summaryComponents: z
    .array(z.object({ compensationType: z.string().optional(), interval: z.string().optional(), currencyCode: z.string().nullish(), minValue: z.number().nullish(), maxValue: z.number().nullish() }))
    .optional(),
});

const positive = (value: number | null | undefined) => (value != null && Number.isFinite(value) && value > 0 ? Math.round(value) : null);

/** Ashby's posting API with includeCompensation=true: the first Salary component (verified on a live board, 18 Nov). */
export function ashbySalary(compensation: unknown): Salary | null {
  const parsed = ashbyComponents.safeParse(compensation);
  if (!parsed.success) return null;
  const salary = (parsed.data.summaryComponents ?? []).find((part) => part.compensationType === "Salary");
  const period = salary?.interval ? ASHBY_PERIOD[salary.interval] : undefined;
  const min = positive(salary?.minValue);
  const max = positive(salary?.maxValue);
  if (!salary?.currencyCode || !period || (min == null && max == null)) return null;
  return { min, max, currency: salary.currencyCode.toUpperCase(), period };
}

const LEVER_PERIOD: Record<string, Salary["period"]> = { "per-year-salary": "year", "per-month-salary": "month", "per-hour-wage": "hour" };
const leverRange = z.object({ currency: z.string().optional(), interval: z.string().optional(), min: z.number().nullish(), max: z.number().nullish() });

/** Lever's postings API `salaryRange` (rare: 1 of 1,568 postings on the largest board we read, 18 Nov). */
export function leverSalary(range: unknown): Salary | null {
  const parsed = leverRange.safeParse(range);
  if (!parsed.success) return null;
  const period = parsed.data.interval ? LEVER_PERIOD[parsed.data.interval] : undefined;
  const min = positive(parsed.data.min);
  const max = positive(parsed.data.max);
  if (!parsed.data.currency || !period || (min == null && max == null)) return null;
  return { min, max, currency: parsed.data.currency.toUpperCase(), period };
}
