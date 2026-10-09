/**
 * The mock Greenhouse form exists for test profiles and automated tests. It takes anonymous input, so it is off in
 * production unless ENABLE_MOCK_FORM=1 (set it on a staging deploy that runs the end-to-end test).
 */
export function mockFormEnabled() {
  if (process.env.ENABLE_MOCK_FORM === "1") return true;
  return process.env.NODE_ENV !== "production";
}
