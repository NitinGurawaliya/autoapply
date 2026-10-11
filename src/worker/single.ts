import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE_ROOT } from "@/modules/apply/browser";

const LOCK = join(PROFILE_ROOT, ".worker.pid");

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Two workers on one machine share the same browser profile folders and knock each other's browsers over.
 * The second one refuses to start. Workers on other machines have their own folders, so they are unaffected.
 */
export function claimWorkerLock() {
  mkdirSync(PROFILE_ROOT, { recursive: true });
  // In a container one container is one worker; a lock file kept on a volume from the previous container could name a
  // process id that is something else in this one and block the start (Dockerfile.worker sets this).
  if (process.env.WORKER_SINGLE_LOCK === "off") return;
  try {
    const other = Number(readFileSync(LOCK, "utf8").trim());
    if (other && other !== process.pid && alive(other)) {
      throw new Error(`Another worker (process ${other}) is already running on this machine. Stop it first.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Another worker")) throw error;
  }
  writeFileSync(LOCK, String(process.pid));
  const release = () => {
    try {
      if (Number(readFileSync(LOCK, "utf8")) === process.pid) rmSync(LOCK);
    } catch {
      /* already gone */
    }
  };
  process.on("exit", release);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));
}
