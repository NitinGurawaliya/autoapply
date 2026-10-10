import { PrismaAdapter } from "@auth/prisma-adapter";
import type { PrismaClient } from "@prisma/client";
import { cache } from "react";
import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** Whether onboarding saved a profile; the proxy routes on it without a query of its own. */
      hasProfile: boolean;
    } & DefaultSession["user"];
  }
}

type SessionRow = {
  sessionId: string;
  sessionToken: string;
  userId: string;
  expires: Date;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  hasProfile: boolean;
};

// The adapter types a plain client; ours only leaves Job.terms out of reads, which the adapter never touches.
const adapter = PrismaAdapter(db as unknown as PrismaClient);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: {
    ...adapter,
    // Every request reads its session once; the same query also says whether the user has a profile, so neither
    // the proxy nor the page needs another round trip for the user or the profile (~250 ms each from India).
    // One SQL join: Prisma's include would be three round trips (session, then user, then profile).
    async getSessionAndUser(sessionToken) {
      const rows = await db.$queryRaw<SessionRow[]>`
        SELECT s."id" AS "sessionId", s."sessionToken", s."userId", s."expires",
               u."email", u."emailVerified", u."name", u."image",
               EXISTS (SELECT 1 FROM "Profile" p WHERE p."userId" = u."id") AS "hasProfile"
        FROM "Session" s JOIN "User" u ON u."id" = s."userId"
        WHERE s."sessionToken" = ${sessionToken}`;
      const row = rows[0];
      if (!row) return null;
      return {
        session: { id: row.sessionId, sessionToken: row.sessionToken, userId: row.userId, expires: row.expires },
        user: { id: row.userId, email: row.email, emailVerified: row.emailVerified, name: row.name, image: row.image, hasProfile: row.hasProfile },
      };
    },
  },
  providers: [Google],
  trustHost: true,
  session: { strategy: "database" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.hasProfile = Boolean((user as { hasProfile?: boolean }).hasProfile);
      return session;
    },
  },
});

// Once per request: the layout and the page both ask. Pages need only the id, email and name, which the session
// read already returned, so this is no extra query.
export const getCurrentUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email ?? "", name: session.user.name ?? null };
});
