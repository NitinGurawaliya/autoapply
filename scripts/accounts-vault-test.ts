// Phase U, U1/U4 (docs/accounts/TASKS.md): the vault, the password the agent makes, and Workday's URL and message
// reading. Offline, no database. npx tsx scripts/accounts-vault-test.ts
import { randomBytes } from "node:crypto";
process.env.ACCOUNTS_KEY = randomBytes(32).toString("base64");
import { decrypt, encrypt, generatePassword, passwordFitsRule, vaultReady } from "../src/modules/accounts/vault";
import { readAccountMessage, workdayFormUrl, workdayTenant } from "../src/modules/apply/adapters/workday";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

check("vault is ready with a 32-byte key", vaultReady());
const sealed = encrypt("Ab3$secret-value");
check("round trip", decrypt(sealed) === "Ab3$secret-value");
check("sealed text does not contain the plain text", !sealed.includes("secret-value"));
check("two seals of one value differ (fresh IV)", encrypt("same") !== encrypt("same"));
const tampered = sealed.slice(0, -4) + (sealed.endsWith("A") ? "BBBB" : "AAAA");
check("a tampered seal is refused", (() => { try { decrypt(tampered); return false; } catch { return true; } })());
const goodKey = process.env.ACCOUNTS_KEY;
process.env.ACCOUNTS_KEY = randomBytes(32).toString("base64");
check("another key cannot open it", (() => { try { decrypt(sealed); return false; } catch { return true; } })());
process.env.ACCOUNTS_KEY = "short";
check("a short key is refused", !vaultReady());
process.env.ACCOUNTS_KEY = goodKey;

const made = Array.from({ length: 200 }, () => generatePassword());
check("every made password is 16 long and fits the rule", made.every((p) => p.length === 16 && passwordFitsRule(p)), made.find((p) => !passwordFitsRule(p)));
check("Workday's rule (upper, lower, digit, symbol, 8+)", made.every((p) => /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p)));
check("no quotes, spaces or backslashes", made.every((p) => !/["'`\s\\]/.test(p)));
check("passwords differ", new Set(made).size === made.length);
check("rule refuses a short one", !passwordFitsRule("Ab3$xyz"));
check("rule refuses one without a symbol", !passwordFitsRule("Abcdefgh1234"));

check("form url: posting + /apply/applyManually", workdayFormUrl("https://cotality.wd115.myworkdayjobs.com/Global/job/Bengaluru/Sr-Professional_REQ19385?source=x") === "https://cotality.wd115.myworkdayjobs.com/Global/job/Bengaluru/Sr-Professional_REQ19385/apply/applyManually");
check("form url: an apply path is not doubled", workdayFormUrl("https://otis.wd504.myworkdayjobs.com/REC/job/X/Y_1/apply") === "https://otis.wd504.myworkdayjobs.com/REC/job/X/Y_1/apply/applyManually");
check("tenant is the host's first label", workdayTenant("https://BristolMyersSquibb.wd5.myworkdayjobs.com/BMS/job/x") === "bristolmyerssquibb");

check("message: verify", readAccountMessage("We've sent you an email. Please verify your account before signing in.") === "verify");
check("message: exists", readAccountMessage("An account with this email already exists.") === "exists");
check("message: password rule", readAccountMessage("Password does not meet the requirements") === "refused");
check("message: wrong sign-in", readAccountMessage("Wrong email address or password. Try again.") === "refused");
check("message: none", readAccountMessage("  ") === null);
check("message: other words kept", JSON.stringify(readAccountMessage("Service unavailable")) === JSON.stringify({ error: "Service unavailable" }));

console.log(failed === 0 ? "PASS accounts-vault" : `FAIL accounts-vault (${failed})`);
process.exit(failed === 0 ? 0 : 1);
