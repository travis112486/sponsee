import { eq } from "drizzle-orm";
import { db } from "@sponsee/db";
import { account } from "@sponsee/db/schema";
import type { ConnectedAuth } from "./types.js";

/**
 * Resolve a fresh broadcaster token for a connected creator_platforms row.
 *
 * `connectedAccountId` points at a Better Auth `account` row; Better Auth's
 * getAccessToken refreshes it through the provider when expired. Returns null
 * when the link is gone or the refresh is rejected (token revoked on the
 * platform side) — callers surface that as "reconnect", not a transient error.
 */
export async function getConnectedAuth(connectedAccountId: string): Promise<ConnectedAuth | null> {
  const [row] = await db.select().from(account).where(eq(account.id, connectedAccountId));
  if (!row) return null;

  // Imported lazily: auth.ts constructs the Better Auth instance (SMTP
  // transport, rate limiters) at module load, which router/job unit tests
  // that reach this file through the sync path must not pay for.
  const { auth } = await import("../auth.js");
  try {
    const tokens = await auth.api.getAccessToken({
      body: { accountId: row.id, userId: row.userId },
    });
    if (!tokens.accessToken) return null;
    return { accessToken: tokens.accessToken, providerAccountId: row.accountId };
  } catch (err) {
    console.warn(
      `[platform-sync] token refresh failed for ${row.providerId} account: ${(err as Error).message}`
    );
    return null;
  }
}
