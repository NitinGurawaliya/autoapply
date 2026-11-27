// K18 (docs/hirist/TASKS.md#k18): what a user connects Hirist with is a mobile number or an email, kept sealed like the session.
// npx tsx scripts/hirist-login-id-test.ts   Own throwaway user key; its blobs are removed at the end.
import { seal } from "../src/lib/sealed";
import { storage } from "../src/lib/storage";
import { deleteLoginNumber, isLoginId, loginNumber, loginNumberKey, maskNumber, saveLoginNumber } from "../src/modules/sources";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

(async () => {
  const userId = `hirist-id-test-${Date.now()}`;
  try {
    check("Hirist takes a mobile number or an email, Naukri only a mobile number", isLoginId("hirist", "9876543210") && isLoginId("hirist", "asha@example.test") && isLoginId("naukri", "9876543210") && !isLoginId("naukri", "asha@example.test"));
    check("a malformed id is refused (short number, no domain, spaces, over-long)", !isLoginId("hirist", "98765") && !isLoginId("hirist", "asha@") && !isLoginId("hirist", "as ha@example.test") && !isLoginId("hirist", `${"a".repeat(250)}@example.test`));
    check("an email is saved and read back, once sealed", (await saveLoginNumber(userId, "hirist", "asha@example.test")) && (await loginNumber(userId, "hirist")) === "asha@example.test");
    const stored = await storage.get(loginNumberKey(userId, "hirist"));
    check("the stored blob does not hold the email in the clear", !!stored && !Buffer.from(stored.bytes).toString("latin1").includes("asha@example.test"));
    check("Naukri keeps refusing an email", !(await saveLoginNumber(userId, "naukri", "asha@example.test")) && (await loginNumber(userId, "naukri")) === null);
    await saveLoginNumber(userId, "hirist", "9876543210");
    check("a mobile number replaces it", (await loginNumber(userId, "hirist")) === "9876543210");
    // Saved before K18: { mobile }.
    const key = loginNumberKey(userId, "naukri");
    await storage.put(key, seal(new TextEncoder().encode(JSON.stringify({ mobile: "9123456780" })), key), "application/octet-stream", userId);
    check("a number saved before K18 as { mobile } is still read", (await loginNumber(userId, "naukri")) === "9123456780");
    check("masks keep only enough to tell which one", maskNumber("9876543210") === "+91 ••••• •3210" && maskNumber("asha@example.test") === "a•••@example.test", `${maskNumber("9876543210")} ${maskNumber("asha@example.test")}`);
    await deleteLoginNumber(userId, "hirist");
    check("Disconnect deletes it", (await loginNumber(userId, "hirist")) === null);
  } finally {
    await deleteLoginNumber(userId, "hirist").catch(() => undefined);
    await deleteLoginNumber(userId, "naukri").catch(() => undefined);
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
  }
  console.log(failed === 0 ? "PASS hirist-login-id-test" : `FAIL hirist-login-id-test (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
