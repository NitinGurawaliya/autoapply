// ASHBY_DIAGNOSTICS output carries no applicant data: allowlisted codes and fixed categories only (ashbyDiagnostics.ts).
// Pure: no browser, no database. npx tsx scripts/ashby-diagnostics-test.ts
import { allowlistedCode, ashbyDiagnosticsOn, categorize, graphqlErrorSummary, redact } from "../src/modules/apply/adapters/ashbyDiagnostics";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const SECRETS = ["Priya Sharma", "priya.sharma@example.com", "+91 98765 43210", "eyJhbGciOiJIUzI1NiJ9.c2VjcmV0dG9rZW4", "linkedin.com/in/priya", "Stanford"];
const leaks = (text: string) => SECRETS.filter((secret) => text.includes(secret));

// A GraphQL answer whose messages and data echo the applicant, as a refusal or a validation error might.
const body = JSON.stringify({
  errors: [
    { message: "reCAPTCHA verification failed for priya.sharma@example.com", extensions: { code: "BAD_USER_INPUT" } },
    { message: "Phone +91 98765 43210 is not valid for Priya Sharma", extensions: { code: "SOME_PRIVATE_CODE" } },
  ],
  data: {
    applicationFormSubmit: { errors: ["Missing entry for required field: School (Stanford)"], applicant: { name: "Priya Sharma", email: "priya.sharma@example.com" } },
    "weird key with spaces eyJhbGciOiJIUzI1NiJ9.c2VjcmV0dG9rZW4": true,
  },
});
const summary = graphqlErrorSummary(body);
const summaryText = `${summary.errors.join(",")} ${summary.dataKeys}`;
check("GraphQL summary keeps allowlisted codes and categories", summary.errors[0] === "BAD_USER_INPUT/captcha" && summary.errors[1] === "other/validation", summary.errors.join(","));
check("GraphQL summary reduces nested data errors to categories", summary.errors.includes("nested/missing_field"), summary.errors.join(","));
check("GraphQL summary keeps only plain schema keys", summary.dataKeys === "applicationFormSubmit", summary.dataKeys);
check("GraphQL summary leaks none of the applicant's details", leaks(summaryText).length === 0, leaks(summaryText).join(" | "));
check("an unreadable body gives an empty summary", graphqlErrorSummary("<html>Priya Sharma</html>").errors.length === 0);

check("codes outside the allowlist become other", allowlistedCode("PRIYA_SHARMA") === "other" && allowlistedCode("UNAUTHENTICATED") === "UNAUTHENTICATED");
const consoleLine = "Uncaught TypeError: cannot read 'value' of input name=Priya Sharma email=priya.sharma@example.com";
check("a console line becomes a category with no text", categorize(consoleLine) === "other" && !categorize(consoleLine).includes("Priya"));
check("categories cover captcha, spam, missing fields, rate limits", ["captcha", "spam", "missing_field", "rate_limit"].every((c, i) => categorize(["Please complete the reCAPTCHA", "flagged as possible spam", "Missing entry for required field: Name", "Too many requests"][i]) === c));

const redacted = redact("Contact priya.sharma@example.com or +91 98765 43210, token eyJhbGciOiJIUzI1NiJ9.c2VjcmV0dG9rZW4 at https://x.io/p?email=priya.sharma@example.com");
check("redact strips emails, phone numbers, tokens and query strings", leaks(redacted).length === 0, redacted);

const before = process.env.ASHBY_DIAGNOSTICS;
delete process.env.ASHBY_DIAGNOSTICS;
const offWhenUnset = !ashbyDiagnosticsOn();
process.env.ASHBY_DIAGNOSTICS = "1";
const onWhenSet = ashbyDiagnosticsOn();
process.env.ASHBY_DIAGNOSTICS = "true";
const onlyExactOne = !ashbyDiagnosticsOn();
if (before === undefined) delete process.env.ASHBY_DIAGNOSTICS;
else process.env.ASHBY_DIAGNOSTICS = before;
check("diagnostics are off unless ASHBY_DIAGNOSTICS=1", offWhenUnset && onWhenSet && onlyExactOne);

console.log(failed === 0 ? "PASS ashby-diagnostics" : `FAIL ashby-diagnostics (${failed})`);
process.exit(failed === 0 ? 0 : 1);
