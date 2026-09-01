import { describe, it, expect, beforeAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { settingsRouter } from "./settings.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-246. `creators.timezone` was `z.string().max(64)` — any string. Since
// SPO-239 it decides which calendar month a paid invoice is counted in, so a
// typo ("Eastern", "GMT-5") silently reverted the creator to UTC months, and an
// abbreviation ("EST") passed Intl and then never observed daylight time.

let creatorId = "";

function caller() {
  return settingsRouter.createCaller({
    session: { user: { id: `user-${creatorId}`, email: "t@example.com", name: "T" } },
    creatorId,
    db,
  });
}

const isBadRequest = (err: TRPCError) => err.code === "BAD_REQUEST";

async function storedTimezone() {
  const [row] = await db
    .select({ timezone: schema.creators.timezone })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));
  return row.timezone;
}

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
  const [creator] = await db
    .insert(schema.creators)
    .values({ displayName: "Test Creator" })
    .returning();
  creatorId = creator.id;
});

describe("updateProfile timezone validation", () => {
  it.each([
    "Eastern",
    "Pacific Time",
    "GMT-5",
    "UTC-5",
    "America/New York",
    "",
  ])("rejects %j instead of persisting it", async (timezone) => {
    await expect(caller().updateProfile({ timezone })).rejects.toSatisfy(isBadRequest);
  });

  it.each(["EST", "MST", "HST", "EST5EDT", "PST8PDT", "GMT", "Etc/GMT+5"])(
    "rejects the fixed-offset alias %j",
    async (timezone) => {
      await expect(caller().updateProfile({ timezone })).rejects.toSatisfy(isBadRequest);
    }
  );

  it("names the offending field so the form can show it inline", async () => {
    // ProfilePanel maps `zodError.fieldErrors.timezone` under the input; an
    // issue with no path would only ever surface as a generic toast.
    const err = await caller()
      .updateProfile({ timezone: "Eastern" })
      .then(
        () => null,
        (e: TRPCError) => e
      );

    expect(err).not.toBeNull();
    expect(err!.cause).toBeInstanceOf(ZodError);
    const fieldErrors = (err!.cause as ZodError).flatten().fieldErrors;
    expect(fieldErrors.timezone?.[0]).toMatch(/region\/city/);
  });

  it("leaves the stored value untouched when the write is rejected", async () => {
    await caller().updateProfile({ timezone: "America/Los_Angeles" });
    await expect(caller().updateProfile({ timezone: "EST" })).rejects.toSatisfy(isBadRequest);

    expect(await storedTimezone()).toBe("America/Los_Angeles");
  });

  it.each(["America/New_York", "Europe/London", "Australia/Sydney", "UTC"])(
    "accepts the region/city zone %j",
    async (timezone) => {
      const result = await caller().updateProfile({ timezone });
      expect(result.timezone).toBe(timezone);
    }
  );

  it("trims a stray space rather than persisting an unusable value", async () => {
    const result = await caller().updateProfile({ timezone: "  Europe/London " });

    expect(result.timezone).toBe("Europe/London");
    expect(await storedTimezone()).toBe("Europe/London");
  });

  it("still accepts an update that omits timezone entirely", async () => {
    await caller().updateProfile({ timezone: "America/Denver" });
    const result = await caller().updateProfile({ displayName: "Renamed" });

    expect(result.displayName).toBe("Renamed");
    expect(result.timezone).toBe("America/Denver");
  });
});

describe("rows written before this validation existed", () => {
  it("keeps rendering — the read path does not 500 on an unusable value", async () => {
    await db
      .update(schema.creators)
      .set({ timezone: "Eastern" })
      .where(eq(schema.creators.id, creatorId));

    const profile = await caller().getProfile();
    expect(profile?.timezone).toBe("Eastern");
  });
});
