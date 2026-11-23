import { db } from "@/lib/db";
import { EMPLOYER_ACCOUNTS_KEY as EMPLOYER_ACCOUNTS_KEY_LOCAL, employerAccountsAllowed as employerAccountsAllowedLocal } from "./permission";
import { decrypt, encrypt, generatePassword, vaultReady } from "./vault";

export { generatePassword, passwordFitsRule, vaultReady } from "./vault";
export { EMPLOYER_ACCOUNTS_KEY, EMPLOYER_ACCOUNTS_QUESTION, employerAccountsAllowed } from "./permission";

/** The user's standing permission to make employer accounts: Yes, No, or not answered yet (null). */
export async function employerAccountsPermission(userId: string) {
  const row = await db.answer.findFirst({ where: { userId, key: EMPLOYER_ACCOUNTS_KEY_LOCAL }, orderBy: { updatedAt: "desc" }, select: { answer: true } });
  return employerAccountsAllowedLocal(row?.answer);
}

export type AccountSystem = "workday" | "darwinbox" | "successfactors";
export type AccountState = "creating" | "needs_verification" | "active" | "exists_elsewhere" | "failed";

/**
 * Phase U, U1: the user's application password, made on first need and kept encrypted (docs/accounts/TDD.md 3.1, owner
 * 23 Nov: one per user, made by the agent, shown in Account). Returns the plain password for one use; never log it.
 */
export async function applicationPassword(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { applicationSecret: true } });
  if (!user) throw new Error("user not found");
  if (user.applicationSecret) return decrypt(user.applicationSecret);
  const password = generatePassword();
  // Only the first writer wins, so two runs at once never leave two different passwords in play.
  const written = await db.user.updateMany({ where: { id: userId, applicationSecret: null }, data: { applicationSecret: encrypt(password), applicationSecretAt: new Date() } });
  if (written.count === 1) return password;
  const again = await db.user.findUnique({ where: { id: userId }, select: { applicationSecret: true } });
  return decrypt(again!.applicationSecret!);
}

/** Whether the user has an application password yet (no decryption). */
export async function hasApplicationPassword(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { applicationSecret: true, applicationSecretAt: true } });
  return { set: Boolean(user?.applicationSecret), at: user?.applicationSecretAt ?? null };
}

export type EmployerAccountView = { id: string; system: string; employer: string; state: string; email: string; createdAt: Date; verifiedAt: Date | null; lastUsedAt: Date | null; error: string | null };

/** The user's employer accounts, without secrets, newest first (Account screen). */
export async function listAccounts(userId: string): Promise<EmployerAccountView[]> {
  return db.employerAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, system: true, employer: true, state: true, email: true, createdAt: true, verifiedAt: true, lastUsedAt: true, error: true },
  });
}

/** The Account screen's rows: no secrets, the age in whole days. */
export async function accountRows(userId: string) {
  const now = Date.now();
  return (await listAccounts(userId)).map((row) => ({ id: row.id, system: row.system, employer: row.employer, state: row.state, createdDays: Math.floor((now - row.createdAt.getTime()) / 86_400_000) }));
}

/** The account for one employer, with its password decrypted for this one use (null when none). */
export async function accountFor(userId: string, system: AccountSystem, employer: string) {
  const row = await db.employerAccount.findUnique({ where: { userId_system_employer: { userId, system, employer } } });
  if (!row) return null;
  return { ...row, state: row.state as AccountState, password: row.secret ? decrypt(row.secret) : null };
}

/** Records a new account in `creating` before the employer's Create Account is pressed; returns the password to use. */
export async function startAccount(userId: string, system: AccountSystem, employer: string, email: string) {
  const password = await applicationPassword(userId);
  await db.employerAccount.upsert({
    where: { userId_system_employer: { userId, system, employer } },
    create: { userId, system, employer, email, secret: encrypt(password), state: "creating" },
    update: { email, secret: encrypt(password), state: "creating", error: null },
  });
  return password;
}

/** Moves an account to a new state (and stamps verification and use). */
export async function setAccountState(userId: string, system: AccountSystem, employer: string, state: AccountState, error?: string) {
  const now = new Date();
  await db.employerAccount.updateMany({
    where: { userId, system, employer },
    data: { state, error: error ?? null, ...(state === "active" ? { verifiedAt: now, lastUsedAt: now } : {}) },
  });
}

/** For an account we know nothing of yet (the user had one before us): a row with no password, so Account shows it. */
export async function noteExistingAccount(userId: string, system: AccountSystem, employer: string, email: string) {
  await db.employerAccount.upsert({
    where: { userId_system_employer: { userId, system, employer } },
    create: { userId, system, employer, email, secret: null, state: "exists_elsewhere" },
    update: { state: "exists_elsewhere" },
  });
}

/** Account screen: the user's application password, decrypted for them alone. */
export async function revealApplicationPassword(userId: string) {
  if (!vaultReady()) return null;
  return applicationPassword(userId);
}
