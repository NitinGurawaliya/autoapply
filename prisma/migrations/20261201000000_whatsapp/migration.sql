-- Phase W, W2 (docs/whatsapp/TDD.md 4.3): SwipeApply on WhatsApp. Additive only: three new tables, nothing existing changes.
-- Written by hand and applied with `prisma migrate deploy` only (never `migrate dev` or a shadow of the real database).
CREATE TABLE "WhatsAppLink" (
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optedOutAt" TIMESTAMP(3),
    "pausedUntil" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "morningAt" TEXT NOT NULL DEFAULT '08:30',
    "dropsPerDay" INTEGER NOT NULL DEFAULT 2,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "plan" JSONB,
    "state" JSONB,
    "ignored" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WhatsAppLink_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "userId" TEXT,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "applicationId" TEXT,
    "status" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppLinkCode" (
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppLinkCode_pkey" PRIMARY KEY ("code")
);

CREATE UNIQUE INDEX "WhatsAppLink_phone_key" ON "WhatsAppLink"("phone");
CREATE UNIQUE INDEX "WhatsAppMessage_wamid_key" ON "WhatsAppMessage"("wamid");
CREATE INDEX "WhatsAppMessage_userId_createdAt_idx" ON "WhatsAppMessage"("userId", "createdAt");
CREATE INDEX "WhatsAppMessage_createdAt_idx" ON "WhatsAppMessage"("createdAt");
CREATE INDEX "WhatsAppLinkCode_userId_idx" ON "WhatsAppLinkCode"("userId");

ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
