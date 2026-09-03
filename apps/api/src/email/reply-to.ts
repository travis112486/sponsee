import { eq, and } from "drizzle-orm";
import { db } from "@sponsee/db";
import { memberships, user } from "@sponsee/db/schema";

/**
 * Resolve the address a brand's reply to a creator-authored email — a chase
 * step or an invoice send — should land in.
 *
 * `creators` has no email column — the address lives on the Better Auth
 * `user` row reached through the creator's owner membership. A
 * user-triggered send can read it off the session; a background job (chase
 * ticks, invoice sends) has no session, so it has to be looked up. "Owner" is
 * the same role the request context uses to resolve a creator, and the
 * earliest one wins so two callers over the same creator can never disagree
 * on the reply address.
 *
 * Returns null when no owner email exists. Callers decide how to react:
 * chase-tick logs a warning and falls back to the from address (a chase is
 * machine-authored); invoice.send refuses the send outright (an invoice is
 * the creator's own document, and a brand reply must reach a human — see
 * SPO-363).
 */
export async function resolveCreatorReplyToEmail(creatorId: string): Promise<string | null> {
  const [owner] = await db
    .select({ email: user.email })
    .from(memberships)
    .innerJoin(user, eq(memberships.userId, user.id))
    .where(and(eq(memberships.creatorId, creatorId), eq(memberships.role, "owner")))
    .orderBy(memberships.createdAt, memberships.userId)
    .limit(1);

  return owner?.email || null;
}
