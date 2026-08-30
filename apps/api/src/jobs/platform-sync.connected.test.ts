import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { syncPlatformRow } from "./platform-sync.js";
import { getConnectedAuth } from "../platforms/connected.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-109: rows with a connected OAuth account sync with the broadcaster's
// token — the path that unlocks true Twitch subscriber counts. Token
// resolution (Better Auth refresh) is mocked; the Helix calls are stubbed.

vi.mock("../platforms/connected.js", () => ({
  getConnectedAuth: vi.fn(),
}));

const mockedGetConnectedAuth = vi.mocked(getConnectedAuth);

let creatorId = "";

function mockHelix(subTotal: number) {
  const fn = vi
    .fn()
    .mockImplementation((url: string | URL) => {
      const u = String(url);
      let json: unknown;
      if (u.includes("/helix/users")) {
        json = {
          data: [
            {
              id: "141981764",
              login: "somestreamer",
              display_name: "SomeStreamer",
              profile_image_url: "https://static-cdn.jtvnw.net/avatar.png",
            },
          ],
        };
      } else if (u.includes("/helix/channels/followers")) {
        json = { total: 5421 };
      } else if (u.includes("/helix/subscriptions")) {
        json = { total: subTotal, data: [] };
      } else {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(json), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
  const [creator] = await db
    .insert(schema.creators)
    .values({ displayName: "Sync Creator" })
    .returning();
  creatorId = creator.id;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mockedGetConnectedAuth.mockReset();
});

describe("syncPlatformRow (connected)", () => {
  it("uses the broadcaster token, stores the true sub count, and resolves the handle", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "csecret");
    mockedGetConnectedAuth.mockResolvedValue({
      accessToken: "user-token",
      providerAccountId: "141981764",
    });
    mockHelix(208);

    const [row] = await db
      .insert(schema.creatorPlatforms)
      .values({ creatorId, platform: "twitch", connectedAccountId: "acct-1" })
      .returning();

    const { row: updated, outcome } = await syncPlatformRow(row);

    expect(outcome).toBe("synced");
    expect(mockedGetConnectedAuth).toHaveBeenCalledWith("acct-1");
    expect(updated.subscriberCount).toBe(208);
    expect(updated.followers).toBe(5421);
    // Connected syncs resolve the handle from the OAuth identity — no typed handle needed
    expect(updated.handle).toBe("somestreamer");
    expect(updated.syncStatus).toBe("ok");

    const events = await db
      .select()
      .from(schema.activityEvents)
      .where(eq(schema.activityEvents.entityId, row.id));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("platform_sync");
  });

  it("records a reconnect-worthy error when the token can no longer be resolved", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "csecret");
    mockedGetConnectedAuth.mockResolvedValue(null); // revoked / unlinked

    const [row] = await db
      .select()
      .from(schema.creatorPlatforms)
      .where(eq(schema.creatorPlatforms.creatorId, creatorId));

    const { row: updated, outcome } = await syncPlatformRow(row);

    expect(outcome).toBe("error");
    expect(updated.syncStatus).toBe("error");
    expect(updated.syncError).toContain("reconnect");
    // Last-known values survive a failed sync
    expect(updated.subscriberCount).toBe(208);
  });

  it("skips connected rows when app credentials are not provisioned", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "");
    const [row] = await db
      .select()
      .from(schema.creatorPlatforms)
      .where(eq(schema.creatorPlatforms.creatorId, creatorId));

    const { outcome } = await syncPlatformRow(row);
    expect(outcome).toBe("skipped");
    expect(mockedGetConnectedAuth).not.toHaveBeenCalled();
  });
});
