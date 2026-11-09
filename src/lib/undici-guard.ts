/**
 * Node 22's built-in fetch (undici) can throw an AssertionError from its HTTP parser when a server ends a TLS response
 * early (`Parser.finish`, 9 Nov 2026, Node 22.23.2, mid-ingest): it is thrown outside any promise, so no try/catch around
 * `fetch` sees it, and the process dies with every read and application it was running. This handler swallows that
 * one error (the request it belonged to times out and is retried or recorded as failed) and lets every other uncaught
 * error end the process as before.
 */
export function guardUndiciParserAssertions(log: (line: string) => void = (line) => console.error(line)) {
  process.on("uncaughtException", (error: Error & { code?: string }) => {
    if (error?.code === "ERR_ASSERTION" && /undici/.test(error.stack ?? "")) {
      log(`fetch: a response ended early (undici parser assertion); that request is abandoned`);
      return;
    }
    console.error(error);
    process.exit(1);
  });
}
