import type { AtsAdapter } from "./adapter";
import { greenhouseAdapter } from "./adapters/greenhouse";
import { mockAdapter } from "./adapters/mock";

function laterAdapter(source: "lever" | "ashby"): AtsAdapter {
  return {
    source,
    matches(url: string) {
      if (source === "lever") return /lever\.co/i.test(url);
      return /ashbyhq\.com/i.test(url);
    },
    async inspect() {
      throw new Error(`${source} adapter is not ready`);
    },
    async fill() {
      throw new Error(`${source} adapter is not ready`);
    },
    async submit() {
      throw new Error(`${source} adapter is not ready`);
    },
  };
}

const leverAdapter = laterAdapter("lever");
const ashbyAdapter = laterAdapter("ashby");

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
