// K17: one signed-out window on Hirist, as the shared reader will open it, to learn which of the page's own calls carry
// the listings and what their JSON looks like (docs/hirist/TDD.md 2, 4.2). Run in the screen image, through the reader's
// own proxy address:  node --import tsx scripts/hirist-probe.ts [--search /k/python-jobs]
// Prints paths, statuses, sizes and JSON KEY NAMES only: no listing text, no title, no company is printed or kept.
import { openBrowser } from "../src/modules/apply/browser";
import { readerOwner } from "../src/modules/sources";

type Seen = { method: string; status: number; host: string; path: string; type: string; bytes: number; keys?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function keysOf(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${keysOf(value[0], depth + 1)}]×${value.length}`;
  if (value && typeof value === "object") {
    if (depth > 2) return "{…}";
    return `{${Object.entries(value as Record<string, unknown>).map(([key, inner]) => (inner && typeof inner === "object" ? `${key}:${keysOf(inner, depth + 1)}` : key)).join(",")}}`;
  }
  return typeof value;
}

async function main() {
  const at = process.argv.indexOf("--search");
  const search = at > 0 ? process.argv[at + 1] : "/k/python-jobs";
  const session = await openBrowser("https://www.hirist.tech/", readerOwner(1, 0), { site: "hirist", fresh: true, persist: false });
  const page = session.page;
  const seen: Seen[] = [];
  const hosts = new Map<string, { n: number; bytes: number }>();
  page.on("response", (response) => {
    const url = new URL(response.url());
    const request = response.request();
    const type = response.headers()["content-type"]?.split(";")[0] ?? "";
    const entry: Seen = { method: request.method(), status: response.status(), host: url.host, path: url.pathname, type, bytes: Number(response.headers()["content-length"] ?? 0) };
    const known = hosts.get(url.host) ?? { n: 0, bytes: 0 };
    hosts.set(url.host, { n: known.n + 1, bytes: known.bytes + entry.bytes });
    if (/hirist/i.test(url.host) && /json/i.test(type)) {
      void response
        .json()
        .then((json) => {
          entry.keys = keysOf(json).slice(0, 700);
        })
        .catch(() => undefined);
    }
    seen.push(entry);
  });
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
    await sleep(4000);
    console.log(`front: ${page.url()}`);
    await page.goto(`https://www.hirist.tech${search}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
    await sleep(3000);
    const title = await page.title().catch(() => "");
    const jobLinks = await page.locator('a[href*="/j/"]').evaluateAll((nodes) => nodes.slice(0, 3).map((node) => (node as HTMLAnchorElement).getAttribute("href")));
    console.log(`search page: ${page.url()} title-length=${title.length} job-links=${jobLinks.length}`);
    const captcha = await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title*="challenge" i]').count().catch(() => 0);
    console.log(`captcha frames on the search page: ${captcha}`);
    const first = jobLinks.find(Boolean);
    if (first) {
      const before = seen.length;
      await sleep(8000);
      await page.goto(new URL(first, "https://www.hirist.tech").toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
      await sleep(3000);
      console.log(`job page: ${new URL(page.url()).pathname.replace(/[0-9]+$/, "<id>")} — ${seen.length - before} responses`);
    }
    await sleep(1000);
  } finally {
    await session.close();
  }
  console.log("\nJSON calls on hirist hosts (method status host path bytes keys):");
  for (const entry of seen.filter((row) => /hirist/i.test(row.host) && /json/i.test(row.type))) {
    console.log(`${entry.method} ${entry.status} ${entry.host}${entry.path.replace(/[0-9]{4,}/g, "<id>")} ${entry.bytes} ${entry.keys ?? ""}`);
  }
  console.log("\nhosts (requests, bytes):");
  for (const [host, value] of [...hosts.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) console.log(`${host} ${value.n} ${value.bytes}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
