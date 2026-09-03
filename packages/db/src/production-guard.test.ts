import { describe, expect, it } from "vitest";

import {
  PRODUCTION_ENDPOINT_IDS,
  assertNotProductionDatabase,
  isProductionDatabaseUrl,
} from "./production-guard.js";

const PROD_ID = PRODUCTION_ENDPOINT_IDS[0];
const PROD_DIRECT = `postgresql://u:p@${PROD_ID}.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require`;
const PROD_POOLED = `postgresql://u:p@${PROD_ID}-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require`;
// The persistent dev branch created in SPO-382.
const DEV = "postgresql://u:p@ep-patient-shape-ayd83nu3.c-5.us-east-2.aws.neon.tech/neondb";

describe("isProductionDatabaseUrl", () => {
  it("matches the direct production endpoint", () => {
    expect(isProductionDatabaseUrl(PROD_DIRECT, {})).toBe(true);
  });

  // The whole point of matching on the endpoint id rather than the hostname:
  // the pooled and direct strings are the same branch and both must be caught.
  it("matches the pooled production endpoint", () => {
    expect(isProductionDatabaseUrl(PROD_POOLED, {})).toBe(true);
  });

  it("does not match the dev branch", () => {
    expect(isProductionDatabaseUrl(DEV, {})).toBe(false);
  });

  it("does not match a local Postgres or CI service container", () => {
    expect(isProductionDatabaseUrl("postgresql://localhost:5432/sponsee", {})).toBe(
      false,
    );
    expect(
      isProductionDatabaseUrl("postgres://sponsee:sponsee@localhost:5432/sponsee", {}),
    ).toBe(false);
  });

  it("treats an absent or unparseable url as not-production", () => {
    expect(isProductionDatabaseUrl(undefined, {})).toBe(false);
    expect(isProductionDatabaseUrl("", {})).toBe(false);
    expect(isProductionDatabaseUrl("   ", {})).toBe(false);
    expect(isProductionDatabaseUrl("not a url", {})).toBe(false);
  });

  it("honours SPONSEE_PRODUCTION_DB_HOSTS for a rotated endpoint", () => {
    const rotated = "postgresql://u:p@ep-new-prod-123-pooler.c-5.aws.neon.tech/neondb";
    expect(isProductionDatabaseUrl(rotated, {})).toBe(false);
    expect(
      isProductionDatabaseUrl(rotated, {
        SPONSEE_PRODUCTION_DB_HOSTS: "ep-new-prod-123",
      }),
    ).toBe(true);
    // A full hostname is accepted too, not just the bare id.
    expect(
      isProductionDatabaseUrl(rotated, {
        SPONSEE_PRODUCTION_DB_HOSTS: "ep-new-prod-123-pooler.c-5.aws.neon.tech",
      }),
    ).toBe(true);
  });
});

describe("assertNotProductionDatabase", () => {
  it("throws on production and names the tool that was blocked", () => {
    expect(() => assertNotProductionDatabase(PROD_DIRECT, "drizzle-kit", {})).toThrow(
      /drizzle-kit is pointed at the PRODUCTION database/,
    );
  });

  it("points the caller at the dev branch rather than just refusing", () => {
    expect(() => assertNotProductionDatabase(PROD_POOLED, "db:seed", {})).toThrow(
      /dev' branch/,
    );
  });

  it("allows the dev branch, localhost, and an unset url", () => {
    expect(() => assertNotProductionDatabase(DEV, "drizzle-kit", {})).not.toThrow();
    expect(() =>
      assertNotProductionDatabase("postgresql://localhost:5432/sponsee", "x", {}),
    ).not.toThrow();
    expect(() => assertNotProductionDatabase(undefined, "x", {})).not.toThrow();
  });

  it("yields to an explicit ALLOW_PRODUCTION_DB opt-out", () => {
    expect(() =>
      assertNotProductionDatabase(PROD_DIRECT, "drizzle-kit", {
        ALLOW_PRODUCTION_DB: "1",
      }),
    ).not.toThrow();
  });
});
