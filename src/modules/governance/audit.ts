import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function writeEvent(
  applicationId: string,
  type: string,
  message: string,
  rule?: string,
  data?: Prisma.InputJsonValue,
) {
  return db.applicationEvent.create({
    data: {
      applicationId,
      type,
      message,
      rule: rule ?? null,
      data: data ?? undefined,
    },
  });
}
