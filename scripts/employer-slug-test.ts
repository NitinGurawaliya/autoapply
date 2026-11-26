// Employer slugs (src/lib/employer-slug.ts, docs/employers/TDD.md 4.4). Pure; no network, no database.
// npx tsx scripts/employer-slug-test.ts
import { employerSlug, nameKeyOf, RESERVED_SLUGS, slugBase } from "../src/lib/employer-slug";

let failed = 0;
function ok(name: string, pass: boolean, detail = "") {
  if (!pass) failed += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}
const eq = (name: string, got: string, want: string) => ok(name, got === want, got === want ? "" : `got "${got}", want "${want}"`);

eq("Razorpay", slugBase("Razorpay"), "razorpay");
eq("legal words are kept (plainName is for display only)", slugBase("Zoho Corporation Pvt. Ltd."), "zoho-corporation-pvt-ltd");
eq("diacritics dropped", slugBase("Café Coffee Day"), "cafe-coffee-day");
const long = slugBase("Alpha ".repeat(14).trim());
ok("80 characters: at most 60, no trailing hyphen", long.length <= 60 && !long.endsWith("-") && long.startsWith("alpha-alpha"), `${long.length}: ${long}`);
eq("one character", slugBase("X"), "x-company");
eq("reserved word", slugBase("Browse"), "browse-company");
eq("every reserved word is refused", [...RESERVED_SLUGS].map((word) => slugBase(word)).filter((slug) => RESERVED_SLUGS.has(slug)).join(","), "");
eq("empty", slugBase(""), "company");
eq("only punctuation", slugBase("***"), "company");
eq("digits", slugBase("3M India"), "3m-india");

eq("free slug is the base", employerSlug("Glide", "glideapps.com", new Set()), "glide");
eq("taken: the domain's first label", employerSlug("Glide", "glideapps.com", new Set(["glide"])), "glide-glideapps");
eq("taken, no domain: a number", employerSlug("Glide", null, new Set(["glide"])), "glide-2");
eq("both taken: a number", employerSlug("Glide", "glideapps.com", new Set(["glide", "glide-glideapps"])), "glide-2");
eq("numbers count up", employerSlug("Glide", null, new Set(["glide", "glide-2", "glide-3"])), "glide-4");
eq("a label from a long domain", employerSlug("Reach", "reach.co.uk", new Set(["reach"])), "reach-reach");

const dotted = [
  employerSlug("Acme.io", "acme.io", new Set()),
  employerSlug("Acme.io", "acme.io", new Set(["acme-io"])),
  employerSlug("Acme", "a.b.c.example.com", new Set(["acme"])),
  slugBase("v1.2 Labs"),
];
ok("no result ever contains a dot", dotted.every((slug) => !slug.includes(".")), dotted.join(", "));
const sixty = "a".repeat(60);
ok("a 60-character base with a taken slug stays within 60", employerSlug(sixty, "example.com", new Set([sixty])).length <= 60);

eq("nameKey: lower ASCII", nameKeyOf("Zoho Corp."), "zohocorp");
eq("nameKey: digit stays first", nameKeyOf("3M India")[0], "3");
eq("nameKey: empty is 0", nameKeyOf("***"), "0");
eq("nameKey: diacritics", nameKeyOf("Élan"), "elan");

console.log(failed === 0 ? "PASS employer-slug-test" : `FAIL employer-slug-test (${failed})`);
process.exit(failed === 0 ? 0 : 1);
