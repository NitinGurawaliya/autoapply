import type { AtsAdapter } from "./adapter";
import { ashbyAdapter } from "./adapters/ashby";
import { greenhouseAdapter } from "./adapters/greenhouse";
import { kekaAdapter } from "./adapters/keka";
import { leverAdapter } from "./adapters/lever";
import { mockAdapter } from "./adapters/mock";
import { smartRecruitersAdapter } from "./adapters/smartrecruiters";
import { workableAdapter } from "./adapters/workable";
import { workdayAdapter } from "./adapters/workday";
import { zohoAdapter } from "./adapters/zohorecruit";

const BY_SOURCE: Record<string, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  keka: kekaAdapter,
  workable: workableAdapter,
  zohorecruit: zohoAdapter,
  smartrecruiters: smartRecruitersAdapter,
  workday: workdayAdapter,
};

// Job source wins: Greenhouse listings often link to a company careers site, not greenhouse.io.
export function pickAdapter(url: string, source?: string): AtsAdapter {
  if (mockAdapter.matches(url)) return mockAdapter;
  if (source && BY_SOURCE[source]) return BY_SOURCE[source];
  if (greenhouseAdapter.matches(url)) return greenhouseAdapter;
  if (leverAdapter.matches(url)) return leverAdapter;
  if (ashbyAdapter.matches(url)) return ashbyAdapter;
  if (kekaAdapter.matches(url)) return kekaAdapter;
  if (workableAdapter.matches(url)) return workableAdapter;
  if (zohoAdapter.matches(url)) return zohoAdapter;
  if (smartRecruitersAdapter.matches(url)) return smartRecruitersAdapter;
  if (workdayAdapter.matches(url)) return workdayAdapter;
  return greenhouseAdapter;
}
