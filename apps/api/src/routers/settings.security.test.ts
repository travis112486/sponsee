import { describe, it, expect, beforeAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { db } from "@sponsee/db";
import * as schema from "@sponsee/db/schema";
import { settingsRouter } from "./settings.js";
import { initPgliteSchema } from "../test-utils/pglite-setup.js";
import { SCHEMA_SQL } from "../test-utils/schema-sql.js";

// SPO-88 LOW-4. `z.string().url()` accepts any scheme, so avatarUrl and
// paypalLink would store `javascript:` and `data:` payloads. Nothing renders
// them today (QA verified: no dangerouslySetInnerHTML, never used as href/src),
// so this is hardening — the allowlist has to exist before a profile page
// links them, not after.

let creatorId = "";

function caller() {
  return settingsRouter.createCaller({
    session: { user: { id: `user-${creatorId}`, email: "t@example.com", name: "T" } },
    creatorId,
    db,
  });
}

const isBadRequest = (err: TRPCError) => err.code === "BAD_REQUEST";

beforeAll(async () => {
  await initPgliteSchema(SCHEMA_SQL);
  const [creator] = await db
    .insert(schema.creators)
    .values({ displayName: "Test Creator" })
    .returning();
  creatorId = creator.id;
});

describe("avatarUrl scheme allowlist", () => {
  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>"])(
    "rejects %s",
    async (avatarUrl) => {
      await expect(caller().updateProfile({ avatarUrl })).rejects.toSatisfy(isBadRequest);
    }
  );

  it("rejects a plaintext http URL", async () => {
    await expect(
      caller().updateProfile({ avatarUrl: "http://cdn.example.com/a.png" })
    ).rejects.toSatisfy(isBadRequest);
  });

  it("accepts an https URL", async () => {
    const result = await caller().updateProfile({
      avatarUrl: "https://cdn.example.com/a.png",
    });

    expect(result.avatarUrl).toBe("https://cdn.example.com/a.png");
  });

  it("still accepts null to clear the field", async () => {
    const result = await caller().updateProfile({ avatarUrl: null });

    expect(result.avatarUrl).toBeNull();
  });

  it("does not persist a rejected value", async () => {
    await caller().updateProfile({ avatarUrl: "https://cdn.example.com/keep.png" });
    await caller()
      .updateProfile({ avatarUrl: "javascript:alert(1)" })
      .catch(() => {});

    const [creator] = await db.select().from(schema.creators);
    expect(creator.avatarUrl).toBe("https://cdn.example.com/keep.png");
  });
});

describe("paypalLink scheme allowlist", () => {
  it("rejects a javascript: URL", async () => {
    await expect(
      caller().updateRails({ paypalLink: "javascript:alert(1)" })
    ).rejects.toSatisfy(isBadRequest);
  });

  it("rejects a plaintext http URL", async () => {
    await expect(
      caller().updateRails({ paypalLink: "http://paypal.me/creator" })
    ).rejects.toSatisfy(isBadRequest);
  });

  it("accepts an https URL", async () => {
    const result = await caller().updateRails({
      paypalLink: "https://paypal.me/creator",
    });

    expect(result.paypalLink).toBe("https://paypal.me/creator");
  });

  it("leaves the non-URL rails fields alone", async () => {
    const result = await caller().updateRails({
      wiseText: "wise handle",
      bankText: "acct 123",
    });

    expect(result.wiseText).toBe("wise handle");
    expect(result.bankText).toBe("acct 123");
  });
});
