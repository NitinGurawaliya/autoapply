// Offline checks for share-link slugs (src/lib/job-slug.ts, Phase U2): the text is for people, the trailing id is the key.
// npx tsx scripts/job-slug-test.ts
import { absoluteUrl, appOrigin, jobIdFromSlug, jobPath, slugText } from "../src/lib/job-slug";
import { shareLinksEnabled } from "../src/lib/share-gate";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const id = "cmh3k2x9p0001abcd1234efgh";
const job = (company: string, title: string) => ({ id, title, company: { name: company } });

const plain = jobPath(job("Razorpay", "Backend Engineer, Payments"));
check("plain path", plain === `/j/razorpay-backend-engineer-payments-${id}`, plain);
check("parse plain", jobIdFromSlug(plain.slice(3)) === id);

const accents = jobPath(job("Société Générale", "Ingénieur Logiciel (Java/Go)"));
check("accents become ASCII", accents === `/j/societe-generale-ingenieur-logiciel-java-go-${id}`, accents);

const amp = slugText("AT&T", "C++ / C# Developer");
check("ampersand and symbols", amp === "at-and-t-c-c-developer", amp);

const long = jobPath(job("Very Long Company Name Private Limited", "Senior Staff Software Engineer, Distributed Systems and Storage Infrastructure"));
const text = long.slice(3, long.length - id.length - 1);
check("text cut to 60 at a word", text.length <= 60 && !text.endsWith("-") && !text.includes("--"), `${text.length}: ${text}`);
check("parse long", jobIdFromSlug(long.slice(3)) === id);

const empty = jobPath(job("日本", "エンジニア"));
check("no ASCII text gives /j/<id>", empty === `/j/${id}`, empty);
check("parse bare id", jobIdFromSlug(id) === id);

check("old title still finds the job", jobIdFromSlug(`razorpay-sde-2-${id}`) === id);
check("encoded slug", jobIdFromSlug(encodeURIComponent(`razorpay-backend-${id}`)) === id);
check("no id", jobIdFromSlug("razorpay-backend-engineer") === null);
check("upper case is not an id", jobIdFromSlug(`razorpay-${id.toUpperCase()}`) === null);
check("short tail is not an id", jobIdFromSlug("razorpay-abc123") === null);
check("empty", jobIdFromSlug("") === null);

// The switch (src/lib/share-gate.ts): on in development, off in production unless SHARE_LINKS=1; SHARE_LINKS=0 wins.
const env = process.env as Record<string, string | undefined>;
const gate = (nodeEnv: string, share: string | undefined) => {
  const before = { NODE_ENV: env.NODE_ENV, SHARE_LINKS: env.SHARE_LINKS };
  env.NODE_ENV = nodeEnv;
  if (share === undefined) delete env.SHARE_LINKS;
  else env.SHARE_LINKS = share;
  const on = shareLinksEnabled();
  env.NODE_ENV = before.NODE_ENV;
  if (before.SHARE_LINKS === undefined) delete env.SHARE_LINKS;
  else env.SHARE_LINKS = before.SHARE_LINKS;
  return on;
};
check("production, unset: off", gate("production", undefined) === false);
check("production, 1: on", gate("production", "1") === true);
check("development, unset: on", gate("development", undefined) === true);
check("development, 0: off", gate("development", "0") === false);

// APP_URL as people paste it into a host's settings (23 Nov: one with a stray character made every share page a 500).
const origin = (value: string | undefined, vercel?: string) => {
  const before = { APP_URL: env.APP_URL, V: env.VERCEL_PROJECT_PRODUCTION_URL };
  if (value === undefined) delete env.APP_URL;
  else env.APP_URL = value;
  if (vercel === undefined) delete env.VERCEL_PROJECT_PRODUCTION_URL;
  else env.VERCEL_PROJECT_PRODUCTION_URL = vercel;
  const out = appOrigin();
  if (before.APP_URL === undefined) delete env.APP_URL;
  else env.APP_URL = before.APP_URL;
  if (before.V === undefined) delete env.VERCEL_PROJECT_PRODUCTION_URL;
  else env.VERCEL_PROJECT_PRODUCTION_URL = before.V;
  return out;
};
const SITE = "https://autoapply-u74v.vercel.app";
for (const [label, value] of [
  ["clean", SITE],
  ["trailing slash", `${SITE}/`],
  ["trailing space", `${SITE} `],
  ["trailing newline", `${SITE}\n`],
  ["quoted", `"${SITE}"`],
  ["no scheme", "autoapply-u74v.vercel.app"],
  ["a path", `${SITE}/feed`],
] as const) {
  const got = origin(value);
  check(`APP_URL ${label}`, got === SITE, got);
}
check("APP_URL unusable: Vercel's production host", origin("http://", "autoapply-u74v.vercel.app") === SITE, origin("http://", "autoapply-u74v.vercel.app"));
check("no APP_URL anywhere: localhost", origin(undefined) === "http://localhost:3000");
check("absoluteUrl never throws in metadata", (() => {
  env.APP_URL = `${SITE} `;
  try {
    new URL(absoluteUrl("/"));
    return true;
  } catch {
    return false;
  } finally {
    delete env.APP_URL;
  }
})());

console.log(failed === 0 ? "PASS job-slug-test" : `FAIL job-slug-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
