import type { AtsAdapter } from "./adapter";
import { ashbyAdapter } from "./adapters/ashby";
import { greenhouseAdapter } from "./adapters/greenhouse";
import { leverAdapter } from "./adapters/lever";
import { mockAdapter } from "./adapters/mock";

const BY_SOURCE: Record<string, AtsAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
};

// Job source wins: Greenhouse listings often link to a company careers site, not greenhouse.io.
export function pickAdapter(url: string, source?: string): AtsAdapter {
  if (mockAdapter.matches(url)) return mockAdapter;
  if (source && BY_SOURCE[source]) return BY_SOURCE[source];
  if (greenhouseAdapter.matches(url)) return greenhouseAdapter;
  if (leverAdapter.matches(url)) return leverAdapter;
  if (ashbyAdapter.matches(url)) return ashbyAdapter;
  return greenhouseAdapter;
}
