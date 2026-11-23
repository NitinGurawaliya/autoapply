/**
 * Phase U (docs/accounts/TDD.md 4.3, 5): the user's standing permission for the agent to make employer accounts for
 * them (Workday and the like), asked once: on the needs-you card the first time one is needed, or set in Account.
 * Without it no employer account is made; accounts made before stay, and signing in to them is not affected.
 * No database here, so the Account screen's client code can import it.
 */
export const EMPLOYER_ACCOUNTS_KEY = "create_employer_accounts";
export const EMPLOYER_ACCOUNTS_QUESTION =
  "Some employers (Workday and the like) need an account before you can apply. May your agent make one for you on each such employer's own site, with your email and the password shown in Account?";

/** Yes, No, or not answered yet (null). */
export function employerAccountsAllowed(answer: string | null | undefined): boolean | null {
  if (!answer?.trim()) return null;
  return /^y(es)?$/i.test(answer.trim());
}
