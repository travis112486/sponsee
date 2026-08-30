import { describe, it, expect, beforeAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { settingsRouter } from "./settings.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-109: OAuth connect wiring. Better Auth's linkSocial writes the `account`
// row; these prove the tRPC side — completePlatformConnect stitching that row
// into creator_platforms.connectedAccountId (never another user's row), and
// disconnect/delete removing the stored tokens with the link.
//
// No Twitch/Kick credentials are configured under the test runner, so the
// immediate sync inside completePlatformConnect resolves to outcome "skipped"
// without touching the network.

let creatorId = "";
let otherCreatorId = "";
const userId = "user-connect-test";
const otherUserId = "user-connect-other";

function caller(overrides?: { userId?: string; creatorId?: string }) {
  return settingsRouter.createCaller({
    session: {
      user: { id: overrides?.userId ?? userId, email: "c@example.com", name: "C" },
    },
    creatorId: overrides?.creatorId ?? creatorId,
    db,
  });
}

async function insertAccount(opts: {
  id: string;
  providerId: string;
  userId: string;
  accountId?: string;
}) {
  await db.insert(schema.account).values({
    id: opts.id,
    issuer: "default",
    accountId: opts.accountId ?? `platform-uid-${opts.id}`,
    providerId: opts.providerId,
    userId: opts.userId,
    accessToken: "token",
    refreshToken: "refresh",
    scope: "channel:read:subscriptions",
  });
}

beforeAll(async () => {
  // Deterministic "skipped" sync outcome even if a dev environment carries
  // real platform credentials.
  vi.stubEnv("TWITCH_CLIENT_ID", "");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "");
  vi.stubEnv("KICK_CLIENT_ID", "");
  vi.stubEnv("KICK_CLIENT_SECRET", "");

  await initPgliteSchema(SCHEMA_SQL);
  const [creator] = await db
    .insert(schema.creators)
    .values({ displayName: "Connect Creator" })
    .returning();
  creatorId = creator.id;
  const [other] = await db
    .insert(schema.creators)
    .values({ displayName: "Other Creator" })
    .returning();
  otherCreatorId = other.id;

  await db.insert(schema.user).values([
    { id: userId, name: "C", email: "c@example.com" },
    { id: otherUserId, name: "O", email: "o@example.com" },
  ]);
});

describe("completePlatformConnect", () => {
  it("links the user's account row into creator_platforms and reports the sync outcome", async () => {
    await insertAccount({ id: "acct-twitch-1", providerId: "twitch", userId });

    const result = await caller().completePlatformConnect({ platform: "twitch" });

    // No Twitch credentials under the test runner → link lands, sync skips
    expect(result.outcome).toBe("skipped");
    expect(result.row.connectedAccountId).toBe("acct-twitch-1");
    expect(result.row.platform).toBe("twitch");
    expect(result.row.creatorId).toBe(creatorId);
  });

  it("upserts into an existing platform row without clobbering manual fields", async () => {
    await caller().upsertPlatform({ platform: "kick", ccv: 850, handle: "manualkicker" });
    await insertAccount({ id: "acct-kick-1", providerId: "kick", userId });

    const result = await caller().completePlatformConnect({ platform: "kick" });

    expect(result.row.connectedAccountId).toBe("acct-kick-1");
    expect(result.row.ccv).toBe(850);
    expect(result.row.handle).toBe("manualkicker");
  });

  it("prefers the most recently linked account for the provider", async () => {
    await db
      .update(schema.account)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .where(eq(schema.account.id, "acct-twitch-1"));
    await db.insert(schema.account).values({
      id: "acct-twitch-old",
      issuer: "default",
      accountId: "platform-uid-old",
      providerId: "twitch",
      userId,
      updatedAt: new Date(Date.now() - 60_000),
    });

    const result = await caller().completePlatformConnect({ platform: "twitch" });
    expect(result.row.connectedAccountId).toBe("acct-twitch-1");
  });

  it("deletes superseded links for the provider so stale refresh tokens don't linger", async () => {
    // Connect account A, then account B: A's row must not survive with a
    // live refresh token unreachable from the UI.
    await insertAccount({ id: "acct-kick-old", providerId: "kick", userId: otherUserId });
    await db
      .update(schema.account)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.account.id, "acct-kick-old"));
    await insertAccount({ id: "acct-kick-new", providerId: "kick", userId: otherUserId });

    const result = await caller({
      userId: otherUserId,
      creatorId: otherCreatorId,
    }).completePlatformConnect({ platform: "kick" });

    expect(result.row.connectedAccountId).toBe("acct-kick-new");
    const remaining = await db
      .select()
      .from(schema.account)
      .where(
        and(eq(schema.account.userId, otherUserId), eq(schema.account.providerId, "kick"))
      );
    expect(remaining.map((r) => r.id)).toEqual(["acct-kick-new"]);
  });

  it("never links another user's account", async () => {
    await insertAccount({ id: "acct-other-user", providerId: "twitch", userId: otherUserId });

    // A caller whose session user has no linked twitch account of their own
    await expect(
      caller({ userId: "user-without-links", creatorId: otherCreatorId }).completePlatformConnect({
        platform: "twitch",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("disconnectPlatform", () => {
  it("clears the link, deletes the tokens, and keeps last-known stats", async () => {
    // Simulate a prior successful connected sync
    const [row] = await db
      .update(schema.creatorPlatforms)
      .set({ subscriberCount: 208 })
      .where(eq(schema.creatorPlatforms.connectedAccountId, "acct-twitch-1"))
      .returning();

    const updated = await caller().disconnectPlatform({ id: row.id });

    expect(updated.connectedAccountId).toBeNull();
    expect(updated.subscriberCount).toBe(208);
    const accounts = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.id, "acct-twitch-1"));
    expect(accounts).toHaveLength(0);
  });

  it("rejects rows that are not connected", async () => {
    const [row] = await db
      .select()
      .from(schema.creatorPlatforms)
      .where(eq(schema.creatorPlatforms.creatorId, creatorId));
    await expect(caller().disconnectPlatform({ id: row.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("is tenant-scoped", async () => {
    const [kickRow] = await db
      .select()
      .from(schema.creatorPlatforms)
      .where(eq(schema.creatorPlatforms.connectedAccountId, "acct-kick-1"));
    await expect(
      caller({ creatorId: otherCreatorId }).disconnectPlatform({ id: kickRow.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deletePlatform", () => {
  it("removes the stored OAuth tokens along with a connected row", async () => {
    const [kickRow] = await db
      .select()
      .from(schema.creatorPlatforms)
      .where(eq(schema.creatorPlatforms.connectedAccountId, "acct-kick-1"));

    await caller().deletePlatform({ id: kickRow.id });

    const accounts = await db
      .select()
      .from(schema.account)
      .where(eq(schema.account.id, "acct-kick-1"));
    expect(accounts).toHaveLength(0);
  });
});
