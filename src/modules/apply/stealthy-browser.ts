// Shim (17 Nov): browser.ts imports ./stealthy-browser, the implementation lives in ./real-browser.
export { openStealthyBrowser } from "./real-browser";
