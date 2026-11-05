import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeEvent } from "./audit";

/**
 * Pace and caps for a site the user connects with their own account (Phase K, docs/naukri/TDD.md 4.8): a person browsing,
 * not a crawler. Read by the per-user ingest (K2) and the apply checks (K4).
 */
const sourceRulesSchema = z.object({
  searches_per_run: z.number().int().min(1),
  pages_per_search: z.number().int().min(1),
  details_per_run: z.number().int().min(0),
  seconds_between_pages: z.number().min(1),
  runs_per_day: z.number().int().min(1),
  max_applies_per_day: z.number().int().min(0),
  min_minutes_between_applies: z.number().min(0),
  pause_hours_after_challenge: z.number().min(1),
});
export type SourceRules = z.infer<typeof sourceRulesSchema>;

const rulesSchema = z.object({
  require_user_approval: z.boolean(),
  allow_submit_on_real_sites: z.boolean(),
  test_profile_mock_only: z.boolean(),
  no_fabrication: z.boolean(),
  sensitive_keys_never_ai: z.array(z.string()),
  eeo_default: z.string(),
  min_match_score: z.number(),
  max_applications_per_day: z.number(),
  max_per_company_per_week: z.number().default(3),
  max_in_flight_per_user: z.number().default(25),
  no_duplicate_role: z.boolean().default(true),
  max_ai_drafts_per_application: z.number(),
  max_attempts: z.number(),
  signed_in_sources: z.record(z.string(), sourceRulesSchema).default({}),
});

export type Rules = z.infer<typeof rulesSchema>;

export type GovernanceStage = "swipe_right" | "start" | "submit";

export type GovernanceContext = {
  applicationId: string;
  profileExists?: boolean;
  score?: number | null;
  applicationsToday?: number;
  duplicateRole?: boolean;
  companyWeekCount?: number;
  inFlight?: number;
  isTest?: boolean;
  adapterSource?: string;
};

let cached: Rules | null = null;

export function loadRules(): Rules {
  if (cached) return cached;
  const raw = readFileSync("config/rules.json", "utf8");
  cached = rulesSchema.parse(JSON.parse(raw));
  return cached;
}

/** The pace and caps for one signed-in site, or null when the rules file has none (the site then never runs). */
export function sourceRules(site: string): SourceRules | null {
  return loadRules().signed_in_sources[site] ?? null;
}

export async function check(stage: GovernanceStage, ctx: GovernanceContext) {
  const rules = loadRules();
  let ok = true;
  let rule: string = stage;
  let message = `${stage} passed`;

  if (stage === "swipe_right") {
    if (!ctx.profileExists) {
      ok = false;
      rule = "profile_required";
      message = "A profile is required before applying";
    } else if (rules.no_duplicate_role && ctx.duplicateRole) {
      ok = false;
      rule = "no_duplicate_role";
      message = "You already applied to this role";
    } else if ((ctx.companyWeekCount ?? 0) >= rules.max_per_company_per_week) {
      ok = false;
      rule = "max_per_company_per_week";
      message = `Already ${ctx.companyWeekCount} applications to this company in the last 7 days (limit ${rules.max_per_company_per_week})`;
    } else if ((ctx.inFlight ?? 0) >= rules.max_in_flight_per_user) {
      ok = false;
      rule = "max_in_flight";
      message = `${ctx.inFlight} applications are already running or waiting in line (limit ${rules.max_in_flight_per_user})`;
    } else if (ctx.score != null && ctx.score < rules.min_match_score) {
      ok = false;
      rule = "min_match_score";
      message = `Match score ${ctx.score} is below ${rules.min_match_score}`;
    } else if ((ctx.applicationsToday ?? 0) >= rules.max_applications_per_day) {
      ok = false;
      rule = "max_applications_per_day";
      message = `Daily cap of ${rules.max_applications_per_day} reached`;
    }
  }

  if (stage === "submit") {
    if (rules.test_profile_mock_only && ctx.isTest && ctx.adapterSource !== "mock") {
      ok = false;
      rule = "test_profile_mock_only";
      message = "Test profiles can only submit on the mock form";
    } else if (!rules.allow_submit_on_real_sites && ctx.adapterSource !== "mock") {
      ok = false;
      rule = "allow_submit_on_real_sites";
      message = "Submitting on real sites is turned off";
    }
  }

  await writeEvent(ctx.applicationId, ok ? "rule_check" : "block", message, rule);
  return { ok, rule: ok ? undefined : rule, message };
}
