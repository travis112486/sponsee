import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "./auth.js";
import { db } from "@sponsee/db";

export async function createContext({ req }: FetchCreateContextFnOptions) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  // Resolve creatorId from the user's owner membership
  let creatorId: string | null = null;
  if (session?.user?.id) {
    const membership = await db.query.memberships.findFirst({
      where: (m, { eq, and }) =>
        and(eq(m.userId, session.user.id), eq(m.role, "owner")),
    });
    if (membership) {
      creatorId = membership.creatorId;
    }
  }

  return {
    session,
    creatorId,
    db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
