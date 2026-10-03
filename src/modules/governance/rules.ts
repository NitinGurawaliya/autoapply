import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeEvent } from "./audit";

const rulesSchema = z.object({
  require_user_approval: z.boolean(),
  allow_submit_on_real_sites: z.boolean(),
  test_profile_mock_only: z.boolean(),
  no_fabrication: z.boolean(),
  sensitive_keys_never_ai: z.array(z.string()),
  eeo_default: z.string(),
  min_match_score: z.number(),
  max_applications_per_day: z.number(),
  max_ai_drafts_per_application: z.number(),
  max_attempts: z.number(),
});

export type Rules = z.infer<typeof rulesSchema>;

export type GovernanceStage = "swipe_right" | "start" | "submit";

export type GovernanceContext = {
  applicationId: string;
  profileExists?: boolean;
  score?: number | null;
  applicationsToday?: number;
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
