import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "./auth.js";
import { db } from "@sponsee/db";

const STUB_SESSION = {
  user: {
    id: "stub-user-1",
    name: "Pixel Panda",
    email: "pixel@sponsee.app",
    image: "/pixelpanda-avatar.png",
  },
  session: {
    id: "stub-session-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: "stub-user-1",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  },
};

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
  } else {
    // Dev bypass: when there's no real session (local stub auth), resolve from
    // the stub user membership if it exists.
    const membership = await db.query.memberships.findFirst({
      where: (m, { eq }) => eq(m.userId, "stub-user-1"),
    });
    if (membership) {
      creatorId = membership.creatorId;
    }
  }

  return {
    session: session ?? STUB_SESSION,
    creatorId,
    db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
