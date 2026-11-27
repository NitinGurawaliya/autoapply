import { Prisma } from "@prisma/client";
import { sitesOn } from "@/lib/site-flags";

// Boards the agent applies on: the feed, its filters, swipes, retries and the runner all read this list. One fixed list
// (owner, 18 Nov), no per-board switches: every board runs in the stealthy Chrome (modules/apply/real-browser.ts), the
// worker presses Submit and a challenge goes to the person in that window. Since 15 Nov: Greenhouse 21 of 22 sent, Keka
// 21 of 24, SmartRecruiters 12 of 12, Ashby 8 of 14, Workable 7 of 14 (the misses mostly not the board). Zoho Recruit
// back in on 21 Nov (owner), with its CAPTCHA read by the worker as Keka's (adapters/zohorecruit.ts, M13b). Left out
// until they prove themselves (INGEST_CONTRACT: a board goes in after real submits), their jobs still ingested: Lever
// (none: hCaptcha). Workday in on 23 Nov (owner, Phase V): two real submits (Cisco, DXC) through adapters/workday.ts
// with an employer account the agent makes under the user's permission (ARCHITECTURE 6.24).
const SHARED_BOARDS: readonly string[] = ["greenhouse", "ashby", "keka", "workable", "smartrecruiters", "zohorecruit", "workday"];
/**
 * Sites applied on through the user's own signed-in account (Phase K, docs/naukri/TDD.md 4.7): Naukri only where both
 * ENABLE_NAUKRI=1 and ENABLE_NAUKRI_APPLY=1, and then only for a user connected to it (modules/apply/sites/gate.ts).
 * Never in the shared pool (poolSql): a user who has not connected Naukri never sees its jobs.
 */
export const SIGNED_IN_APPLY_BOARDS: readonly string[] = sitesOn("apply");
export const APPLY_BOARDS: readonly string[] = [...SHARED_BOARDS, ...SIGNED_IN_APPLY_BOARDS];

/**
 * The feed's pool (Phase P, docs/relevance/TDD.md 4.1.1) as SQL on "Job" `alias`: open, on a board the agent applies
 * on, India-eligible, posted within INGEST_DAYS (60). Skills labels and job readings are spent on these jobs only.
 */
export function poolSql(alias = "j") {
  const days = Number(process.env.INGEST_DAYS) || 60;
  const j = Prisma.raw(`"${alias}"`);
  return Prisma.sql`${j}."closedAt" IS NULL AND ${j}.source = ANY(${[...SHARED_BOARDS]}::text[])
    AND ${j}.eligibility IN ('india', 'remote_india') AND ${j}."postedAt" >= (now() AT TIME ZONE 'UTC') - make_interval(days => ${days}::int)`;
}
