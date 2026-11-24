import { db } from "@/lib/db";
import { accountFor, EMPLOYER_ACCOUNTS_KEY, EMPLOYER_ACCOUNTS_QUESTION, employerAccountsPermission, noteExistingAccount, setAccountState, startAccount, vaultReady, type AccountSystem } from "@/modules/accounts";
import { AccountError, AccountVerificationError, NeedsAnswerError, type PrepareContext } from "./adapter";

/**
 * Phase V, V2 (docs/accounts/TDD.md 4.4, 4.5): the account step every account board shares. The board supplies the
 * page actions (`AccountPage`); this decides sign in or create, records the account's state, and turns the employer's
 * answer into the run's outcome. A password is typed only on the employer's own page and never written to an event.
 */
export type AccountOutcome =
  /** Past the account step: the form's first page is showing. */
  | "in"
  /** The employer asks the user to verify their email first. */
  | "verify"
  /** The email already has an account there (made by the user before us). */
  | "exists"
  /** The employer refused the password (its rules, or a wrong one). */
  | "refused"
  /** Anything else: the employer's words. */
  | { error: string };

export type AccountPage = {
  /** Already signed in (a saved browser session): the form is showing. */
  signedIn(): Promise<boolean>;
  signIn(email: string, password: string): Promise<AccountOutcome>;
  /** Creates the account; `consent` ticks the employer's required privacy/terms box. */
  create(email: string, password: string, consent: boolean): Promise<AccountOutcome>;
};

const CONSENT_KEY = "accept_acknowledgements";

async function consentGiven(userId: string) {
  const row = await db.answer.findFirst({ where: { userId, key: CONSENT_KEY }, orderBy: { updatedAt: "desc" }, select: { answer: true } });
  if (!row) return null;
  return /^y(es)?$/i.test(row.answer.trim());
}

export async function runAccountStep(ctx: PrepareContext, system: AccountSystem, employer: string, page: AccountPage) {
  // Workday's internal company names carry a number first ("330779353 CoreLogic Solutions"): not shown to the user.
  const company = ctx.company.replace(/^\d+\s+/, "");
  ctx = { ...ctx, company };
  const label = `${company}'s ${system === "workday" ? "Workday" : system} account`;
  if (await page.signedIn()) {
    await setAccountState(ctx.userId, system, employer, "active");
    await ctx.log("account_signin", `Already signed in to ${label}`);
    return;
  }
  if (!vaultReady()) throw new AccountError(`Employer accounts are not set up on this server (no ACCOUNTS_KEY). Nothing was sent.`);
  if (!ctx.email) throw new AccountError("No email on your SwipeApply account to create the employer account with. Nothing was sent.");

  const existing = await accountFor(ctx.userId, system, employer);
  if (existing?.state === "exists_elsewhere" || (existing && !existing.password)) {
    throw new AccountError(`You already had a ${label.replace(`${ctx.company}'s `, "")} at ${ctx.company} with ${ctx.email}, made before SwipeApply. Sign in there yourself, or reset its password; nothing was sent.`);
  }

  if (existing?.password) {
    const outcome = await page.signIn(existing.email, existing.password);
    if (outcome === "in") {
      await setAccountState(ctx.userId, system, employer, "active");
      await ctx.log("account_signin", `Signed in to ${label}`);
      return;
    }
    if (outcome === "verify") {
      await setAccountState(ctx.userId, system, employer, "needs_verification");
      await ctx.log("account_verify_asked", `${ctx.company} asks you to verify your email before signing in`);
      throw new AccountVerificationError(ctx.company, existing.email);
    }
    // A row still "creating" or "needs_verification" whose sign-in is refused may never have been made (a run stopped
    // mid-create, or the employer's answer was misread): try creating it; "exists" from that is then the real answer.
    if (existing.state !== "creating" && existing.state !== "needs_verification") {
      const why = outcome === "refused" ? "refused the saved password" : outcome === "exists" ? "says the account exists but refused it" : outcome.error;
      await setAccountState(ctx.userId, system, employer, "failed", why);
      await ctx.log("account_failed", `${label}: ${why}`);
      throw new AccountError(`${label} ${why}. Open its sign-in page and use "Forgot password", then retry. Nothing was sent.`);
    }
  }

  // No account yet: made only under the user's standing permission to make employer accounts, asked once (the needs-you
  // card, or Account). Nothing was sent; the user's answer runs the application again.
  const allowed = await employerAccountsPermission(ctx.userId);
  if (allowed === null) throw new NeedsAnswerError({ key: EMPLOYER_ACCOUNTS_KEY, label: EMPLOYER_ACCOUNTS_QUESTION, type: "select", options: ["Yes", "No"], required: true });
  if (!allowed) throw new AccountError(`${company} needs an employer account, and you chose not to let your agent make them. Turn it on in Account to apply here. Nothing was sent.`);

  // The employer's required privacy/terms box is ticked only under the user's standing permission.
  const consent = await consentGiven(ctx.userId);
  if (consent === null) {
    throw new NeedsAnswerError({ key: CONSENT_KEY, label: `${ctx.company}'s account form has a required privacy notice to accept. May your agent accept required privacy notices and terms for you?`, type: "select", options: ["Yes", "No"], required: true });
  }
  if (!consent) throw new AccountError(`${ctx.company}'s account form needs its privacy notice accepted, and you chose to accept those yourself. Nothing was sent.`);

  const password = await startAccount(ctx.userId, system, employer, ctx.email);
  const outcome = await page.create(ctx.email, password, true);
  if (outcome === "in") {
    await setAccountState(ctx.userId, system, employer, "active");
    await ctx.log("account_created", `Created ${label} with ${ctx.email}; its password is in Account`);
    return;
  }
  if (outcome === "verify") {
    await setAccountState(ctx.userId, system, employer, "needs_verification");
    await ctx.log("account_created", `Created ${label} with ${ctx.email}; ${ctx.company} sent a verification email`);
    throw new AccountVerificationError(ctx.company, ctx.email);
  }
  if (outcome === "exists") {
    await noteExistingAccount(ctx.userId, system, employer, ctx.email);
    await ctx.log("account_failed", `${label}: ${ctx.email} already has an account there`);
    throw new AccountError(`You already have a ${system === "workday" ? "Workday" : system} account at ${ctx.company} with ${ctx.email}. Sign in there yourself, or reset its password; nothing was sent.`);
  }
  const why = outcome === "refused" ? "refused the password" : outcome.error;
  // No answer at all says nothing about whether the account was made (24 Nov, Zebra: the form "did not answer", the row
  // went to failed, and every later run stopped at a refused sign-in without ever creating it): the row stays
  // "creating", so the next run signs in and, refused, creates it; the employer's own "exists" then settles it.
  const unknown = typeof outcome === "object" && /did not answer/i.test(outcome.error);
  await setAccountState(ctx.userId, system, employer, unknown ? "creating" : "failed", why);
  await ctx.log("account_failed", `${label}: ${why}`);
  throw new AccountError(`${ctx.company}'s account form ${why}. Nothing was sent.`);
}
