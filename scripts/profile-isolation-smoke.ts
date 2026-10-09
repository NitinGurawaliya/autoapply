// Browser profiles are per user: cookies from one user never reach another, the same user keeps theirs,
// and two runs of one user still run side by side. Uses a throwaway local page, no real sites.
// npx tsx scripts/profile-isolation-smoke.ts
import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { openBrowser, PROFILE_ROOT } from "../src/modules/apply/browser";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function main() {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>blank</title><p>blank</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  const userA = `iso-test-a-${Date.now()}`;
  const userB = `iso-test-b-${Date.now()}`;

  try {
    // User A sets a cookie and a localStorage value.
    const a1 = await openBrowser(origin, userA);
    await a1.context.addCookies([{ name: "secret", value: "from-user-a", url: origin, expires: Math.floor(Date.now() / 1000) + 3600 }]);
    await a1.page.evaluate(() => localStorage.setItem("secret", "from-user-a"));
    const dirA = a1.profileDir;
    await a1.close();

    // User B must see neither.
    const b = await openBrowser(origin, userB);
    const bCookies = await b.context.cookies(origin);
    const bStorage = await b.page.evaluate(() => localStorage.getItem("secret"));
    check("another user does not see the cookie", !bCookies.some((c) => c.name === "secret"));
    check("another user does not see localStorage", bStorage === null);
    check("profile folders are separate", b.profileDir !== dirA && b.profileDir.includes(userB) && dirA.includes(userA), b.profileDir.replace(/\\/g, "/"));
    await b.close();

    // User A comes back and still has theirs.
    const a2 = await openBrowser(origin, userA);
    const aCookies = await a2.context.cookies(origin);
    const aStorage = await a2.page.evaluate(() => localStorage.getItem("secret"));
    check("the same user keeps their cookie", aCookies.some((c) => c.name === "secret" && c.value === "from-user-a"));
    check("the same user keeps their localStorage", aStorage === "from-user-a");
    await a2.close();

    // Two runs of one user at the same time use two slots.
    const [r1, r2] = await Promise.all([openBrowser(origin, userA), openBrowser(origin, userA)]);
    check("two runs of one user run in parallel", r1.profileDir !== r2.profileDir, `${r1.profileDir.split(/[\\/]/).pop()} and ${r2.profileDir.split(/[\\/]/).pop()}`);
    await Promise.all([r1.close(), r2.close()]);

    // An owner name cannot escape its folder.
    const sneaky = await openBrowser(origin, `../../${userB}`);
    const root = PROFILE_ROOT.replace(/^\.\//, "");
    check("owner names cannot escape the profile root", sneaky.profileDir.replace(/\\/g, "/").startsWith(`${root}/`) && !sneaky.profileDir.includes(".."), sneaky.profileDir.replace(/\\/g, "/"));
    await sneaky.close();
  } catch (error) {
    failed += 1;
    console.log("FAIL", error instanceof Error ? error.message.split("\n")[0] : error);
  } finally {
    server.close();
    for (const user of [userA, userB, `______${userB}`]) await rm(`${PROFILE_ROOT}/${user}`, { recursive: true, force: true }).catch(() => undefined);
  }
  console.log(failed === 0 ? "PASS profile isolation" : `FAIL profile isolation (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
