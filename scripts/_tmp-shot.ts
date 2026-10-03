import { writeFile } from "node:fs/promises";
import { storage } from "../src/lib/storage";
import { db } from "../src/lib/db";
async function main() {
  const f = await storage.get("screenshots/cmurggzdj005hv9c463ysy93s/1.png");
  await writeFile(process.argv[2], f!.bytes);
  await db.$disconnect();
}
main();
