import type { ConsoleMessage, Page, Request, Response } from "playwright";

// Diagnostics for the Ashby handoff Submit step (21 Oct: they showed a person's Submit sending
// ApiSubmitSingleApplicationFormAction, and a worker's Submit stopped by reCAPTCHA before sending anything). On only with
// ASHBY_DIAGNOSTICS=1. It reads what the page and the network already
// show and changes nothing: no browser setting, timing or input. Output is log lines of allowlisted codes, fixed
// categories, counts, booleans and our own route names: never a request or response body, a server or console message,
// personal data, cookies, tokens, form values or resume contents.

export function ashbyDiagnosticsOn() {
  return process.env.ASHBY_DIAGNOSTICS === "1";
}

/** Strips anything that could identify the applicant or a session: emails, phone-like numbers, long tokens, query strings. */
export function redact(text: string, max = 200) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "<number>")
    // JSON web tokens (dot-separated, each part may be short), then any long unbroken token.
    .replace(/eyJ[\w-]*\.[\w-]+(\.[\w-]+)?/g, "<token>")
    .replace(/[A-Za-z0-9_-]{24,}/g, "<token>")
    .replace(/\?[^\s"']*/g, "?<query>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A fixed category for any free text (a server message, a console line, an alert): the text itself is never logged. */
export function categorize(text: string) {
  if (/re-?captcha|captcha|challenge/i.test(text)) return "captcha";
  if (/spam|abuse|suspicious|bot\b/i.test(text)) return "spam";
  if (/missing|required|empty/i.test(text)) return "missing_field";
  if (/rate.?limit|too many|throttl/i.test(text)) return "rate_limit";
  if (/unauthori[sz]ed|forbidden|auth|token|csrf/i.test(text)) return "auth";
  if (/invalid|validation|not valid|must be|format/i.test(text)) return "validation";
  if (/network|failed to fetch|timeout|net::/i.test(text)) return "network";
  return "other";
}

// GraphQL error codes worth seeing verbatim; anything else is logged as "other".
const KNOWN_CODES = new Set([
  "BAD_USER_INPUT",
  "GRAPHQL_VALIDATION_FAILED",
  "GRAPHQL_PARSE_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INTERNAL_SERVER_ERROR",
  "PERSISTED_QUERY_NOT_FOUND",
  "RATE_LIMITED",
  "TOO_MANY_REQUESTS",
  "NOT_FOUND",
]);
export const allowlistedCode = (code: unknown) => (typeof code === "string" && KNOWN_CODES.has(code) ? code : "other");

/** Error codes and categories from a GraphQL answer: never its messages or data, which can echo the applicant's details. */
export function graphqlErrorSummary(body: string) {
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ message?: unknown; extensions?: { code?: unknown } }>; data?: Record<string, unknown> };
    const errors = (parsed.errors ?? []).map((error) => `${allowlistedCode(error.extensions?.code)}/${categorize(String(error.message ?? ""))}`);
    // Ashby can answer 200 with the failure inside data (an "errors" or "messages" list on the operation's result).
    const nested = Object.values(parsed.data ?? {}).flatMap((result) => {
      const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
      const list = [record.errors, record.messages].find(Array.isArray) as unknown[] | undefined;
      return (list ?? []).map((item) => `nested/${categorize(typeof item === "string" ? item : JSON.stringify(item))}`);
    });
    // The operation's result field names come from Ashby's schema, not from the applicant.
    const dataKeys = Object.keys(parsed.data ?? {}).filter((key) => /^\w{1,60}$/.test(key)).join(",");
    return { errors: [...errors, ...nested], dataKeys };
  } catch {
    return { errors: [] as string[], dataKeys: "" };
  }
}

// GraphQL operation names are Ashby's identifiers; anything that is not a plain identifier is not logged.
const operationOf = (request: Request) => {
  const name = request.postData()?.match(/"operationName"\s*:\s*"(\w{1,80})"/)?.[1];
  return name ?? "-";
};
// The path without ids: /<company>/<uuid>/application becomes /<company>/<id>/application.
const pathOf = (url: string) => redact(new URL(url).pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>"), 120);
const netCode = (text: string | undefined) => text?.match(/net::ERR_[A-Z_]+/)?.[0] ?? (text ? categorize(text) : "-");

export type AshbyDiagnostics = {
  /** A named moment of the run (form opened, filled, Submit pressed), as milliseconds since the diagnostics started. */
  mark(stage: string): void;
  /** The state of the page at the outcome, then detaches every listener. */
  finish(outcome: string): Promise<void>;
};

const noop: AshbyDiagnostics = { mark: () => undefined, finish: async () => undefined };

/** Starts watching this page's window. Returns a no-op unless ASHBY_DIAGNOSTICS=1. */
export function watchAshby(page: Page, tag: string): AshbyDiagnostics {
  if (!ashbyDiagnosticsOn()) return noop;
  const started = Date.now();
  const log = (line: string) => console.log(`ashby-diag ${tag} +${Date.now() - started}ms ${line}`);
  const context = page.context();

  const onRequest = (request: Request) => {
    if (request.method() !== "POST" || !/ashbyhq\.com/i.test(request.url())) return;
    log(`request POST ${pathOf(request.url())} op=${operationOf(request)}`);
  };
  const onResponse = (response: Response) => {
    const request = response.request();
    if (request.method() !== "POST" || !/ashbyhq\.com/i.test(response.url())) return;
    const head = `response POST ${pathOf(response.url())} op=${operationOf(request)} status=${response.status()}`;
    response.text().then(
      (body) => {
        const { errors, dataKeys } = graphqlErrorSummary(body);
        log(`${head} data=[${dataKeys}] errors=[${errors.join(",")}]`);
      },
      () => log(`${head} body=unreadable`),
    );
  };
  const onFailed = (request: Request) => {
    log(`requestfailed ${request.method()} ${new URL(request.url()).host} ${netCode(request.failure()?.errorText)}`);
  };
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    const source = message.location().url ? new URL(message.location().url).host : "-";
    log(`console.${message.type()} category=${categorize(message.text())} source=${source}`);
  };
  const onPageError = (error: Error) => log(`pageerror ${error.name} category=${categorize(error.message)}`);

  context.on("request", onRequest);
  context.on("response", onResponse);
  context.on("requestfailed", onFailed);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  log("watching");

  return {
    mark: (stage) => log(`mark ${stage}`),
    finish: async (outcome) => {
      try {
        const live = page.isClosed() ? context.pages().filter((open) => !open.isClosed()).at(-1) : page;
        if (!live) {
          log(`outcome=${outcome} window=gone`);
          return;
        }
        // Booleans and counts only; alert texts are reduced to categories in Node, never logged.
        const state = (await live
          .evaluate(`(() => {
            // Shown means sized AND not hidden by its own or a parent's style: reCAPTCHA keeps a 150px challenge frame in the
            // page from load with visibility:hidden and an opacity:0 parent (21 Oct dry run), which is not a challenge.
            const visible = (el) => {
              const r = el.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0) return false;
              for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
                const s = getComputedStyle(node);
                if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
              }
              return true;
            };
            const frames = Array.from(document.querySelectorAll('iframe[src*="recaptcha"], iframe[title*="recaptcha" i]'));
            const button = document.querySelector('button.ashby-application-form-submit-button, button[type=submit]');
            return {
              recaptchaFrames: frames.length,
              challengeVisible: frames.some((f) => /bframe/.test(f.src || "") && visible(f) && f.getBoundingClientRect().height > 120),
              buttonFound: !!button,
              buttonDisabled: button ? button.disabled || button.getAttribute("aria-disabled") === "true" : null,
              buttonBusy: button ? button.getAttribute("aria-busy") === "true" || !!button.querySelector('[class*="spinner" i], [class*="loading" i]') : null,
              alerts: Array.from(document.querySelectorAll('[role="alert"], [class*="_error"]')).map((el) => (el.textContent || "").trim()).filter(Boolean).slice(0, 10),
              path: location.pathname,
            };
          })()`)
          .catch(() => null)) as { recaptchaFrames: number; challengeVisible: boolean; buttonFound: boolean; buttonDisabled: boolean | null; buttonBusy: boolean | null; alerts: string[]; path: string } | null;
        if (!state) {
          log(`outcome=${outcome} state=unreadable`);
          return;
        }
        const alertCounts = new Map<string, number>();
        for (const alert of state.alerts) alertCounts.set(categorize(alert), (alertCounts.get(categorize(alert)) ?? 0) + 1);
        log(
          `outcome=${outcome} recaptchaFrames=${state.recaptchaFrames} challengeVisible=${state.challengeVisible} buttonFound=${state.buttonFound} buttonDisabled=${state.buttonDisabled} buttonBusy=${state.buttonBusy} path=${pathOf(`https://x${state.path}`)} alerts=[${[...alertCounts].map(([category, count]) => `${category}:${count}`).join(",")}]`,
        );
      } finally {
        context.off("request", onRequest);
        context.off("response", onResponse);
        context.off("requestfailed", onFailed);
        page.off("console", onConsole);
        page.off("pageerror", onPageError);
      }
    },
  };
}
