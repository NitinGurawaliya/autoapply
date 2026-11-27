import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Phase Y, Y2: the one place the WhatsApp module touches the database. The rest of the module takes a `Store`, so the
 * rules (a code claimed once, a duplicate wamid stored once, a test profile refused) are tested offline against an
 * in-memory one (scripts/whatsapp-test.ts) and run here against Postgres.
 */

export type MessageRow = {
  wamid: string;
  userId: string | null;
  direction: "in" | "out";
  kind: string;
  applicationId?: string | null;
};

export type CodeRow = { code: string; userId: string; expiresAt: Date; usedAt: Date | null };

export type LinkRow = {
  userId: string;
  phone: string;
  linkedAt: Date;
  optedOutAt: Date | null;
  pausedUntil: Date | null;
  timezone: string;
  morningAt: string;
  dropsPerDay: number;
  lastInboundAt: Date | null;
};

export interface Store {
  /** Stores one message; false when its wamid is already stored (a second delivery of the same inbound). */
  insertMessage(row: MessageRow): Promise<boolean>;
  applyStatus(wamid: string, status: string, error: string | null): Promise<void>;
  /** Messages from numbers nobody linked, kept 24 hours. */
  pruneStrangerMessages(now: Date): Promise<number>;

  saveCode(row: { code: string; userId: string; expiresAt: Date }): Promise<void>;
  findCode(code: string): Promise<CodeRow | null>;
  /** One step: marks the code used only if it is still unused and unexpired; true for exactly one caller. */
  consumeCode(code: string, now: Date): Promise<boolean>;
  /** Codes the user asked for and never used, and every expired code. */
  deleteStaleCodes(userId: string, now: Date): Promise<void>;

  findLinkByPhone(phone: string): Promise<LinkRow | null>;
  findLinkByUser(userId: string): Promise<LinkRow | null>;
  /** null when there is no such user. */
  userIsTest(userId: string): Promise<boolean | null>;
  /** Binds the number to the user, replacing the user's earlier link; the window opens now. */
  upsertLink(userId: string, phone: string, now: Date): Promise<void>;
  deleteLink(userId: string): Promise<void>;
  touchInbound(userId: string, now: Date): Promise<void>;
  touchOutbound(userId: string, now: Date): Promise<void>;
}

const linkSelect = { userId: true, phone: true, linkedAt: true, optedOutAt: true, pausedUntil: true, timezone: true, morningAt: true, dropsPerDay: true, lastInboundAt: true } as const;

export const prismaStore: Store = {
  async insertMessage(row) {
    try {
      await db.whatsAppMessage.create({ data: { wamid: row.wamid, userId: row.userId, direction: row.direction, kind: row.kind, applicationId: row.applicationId ?? null } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  },
  async applyStatus(wamid, status, error) {
    await db.whatsAppMessage.updateMany({ where: { wamid, direction: "out" }, data: { status, error } });
  },
  async pruneStrangerMessages(now) {
    const result = await db.whatsAppMessage.deleteMany({ where: { userId: null, createdAt: { lt: new Date(now.getTime() - 24 * 3600_000) } } });
    return result.count;
  },

  async saveCode(row) {
    await db.whatsAppLinkCode.create({ data: row });
  },
  async findCode(code) {
    return db.whatsAppLinkCode.findUnique({ where: { code } });
  },
  async consumeCode(code, now) {
    const result = await db.whatsAppLinkCode.updateMany({ where: { code, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    return result.count === 1;
  },
  async deleteStaleCodes(userId, now) {
    await db.whatsAppLinkCode.deleteMany({ where: { OR: [{ userId, usedAt: null }, { expiresAt: { lt: new Date(now.getTime() - 3600_000) } }] } });
  },

  async findLinkByPhone(phone) {
    return db.whatsAppLink.findUnique({ where: { phone }, select: linkSelect });
  },
  async findLinkByUser(userId) {
    return db.whatsAppLink.findUnique({ where: { userId }, select: linkSelect });
  },
  async userIsTest(userId) {
    const profile = await db.profile.findUnique({ where: { userId }, select: { isTest: true } });
    if (profile) return profile.isTest;
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    return user ? false : null;
  },
  async upsertLink(userId, phone, now) {
    const fresh = { phone, linkedAt: now, optedOutAt: null, pausedUntil: null, lastInboundAt: now, ignored: 0, state: Prisma.DbNull, plan: Prisma.DbNull };
    await db.whatsAppLink.upsert({ where: { userId }, create: { userId, ...fresh }, update: fresh });
  },
  async deleteLink(userId) {
    await db.whatsAppLink.deleteMany({ where: { userId } });
  },
  async touchInbound(userId, now) {
    await db.whatsAppLink.updateMany({ where: { userId }, data: { lastInboundAt: now, ignored: 0 } });
  },
  async touchOutbound(userId, now) {
    await db.whatsAppLink.updateMany({ where: { userId }, data: { lastOutboundAt: now } });
  },
};
