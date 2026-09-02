import { describe, it, expect } from "vitest";
import {
  constantTimeEquals,
  evaluateFrontDoor,
  FRONT_DOOR_HEADER,
  frontDoorEnforced,
  frontDoorSecret,
  frontDoorVerified,
  isFrontDoorExempt,
} from "./front-door.js";

const SECRET = "a-front-door-secret-that-is-not-short";
const env = { FRONT_DOOR_SECRET: SECRET } as const;

function headers(extra: Record<string, string> = {}) {
  return new Headers(extra);
}

describe("front-door exemptions", () => {
  // Acceptance: assert the list by *literal path*, not by iterating the
  // middleware's own exempt array — a test derived from the array passes when
  // the list shrinks. These paths are written out so a shrinking list fails.
  it("exempts health for Render's own checker, by literal method+path", () => {
    expect(isFrontDoorExempt("GET", "/health")).toBe(true);
  });

  it("exempts the email webhooks by literal path", () => {
    expect(isFrontDoorExempt("POST", "/api/webhooks/email/resend")).toBe(true);
    expect(isFrontDoorExempt("POST", "/api/webhooks/email/postmark")).toBe(true);
  });

  it("exempts the Stripe webhook by literal path", () => {
    expect(isFrontDoorExempt("POST", "/api/webhooks/stripe")).toBe(true);
  });

  it("does not exempt health under a non-GET method", () => {
    expect(isFrontDoorExempt("POST", "/health")).toBe(false);
  });

  it("does not exempt anything outside health and webhooks", () => {
    expect(isFrontDoorExempt("GET", "/api/trpc/deals.list")).toBe(false);
    expect(isFrontDoorExempt("POST", "/api/auth/sign-in/magic-link")).toBe(false);
    expect(isFrontDoorExempt("POST", "/api/waitlist")).toBe(false);
    expect(isFrontDoorExempt("GET", "/api/webhooks")).toBe(false);
    expect(isFrontDoorExempt("GET", "/health/extra")).toBe(false);
  });
});

describe("evaluateFrontDoor", () => {
  it("passes exempt paths without a secret or header", () => {
    expect(evaluateFrontDoor("GET", "/health", headers())).toEqual({ kind: "exempt" });
    expect(
      evaluateFrontDoor("POST", "/api/webhooks/stripe", headers()),
    ).toEqual({ kind: "exempt" });
  });

  it("fails open when FRONT_DOOR_SECRET is unset", () => {
    expect(evaluateFrontDoor("POST", "/api/auth/sign-in/social", headers())).toEqual({
      kind: "secret-unset",
    });
  });

  it("observes rather than rejects when enforcement is off", () => {
    expect(
      evaluateFrontDoor("POST", "/api/auth/sign-in/social", headers(), env),
    ).toEqual({ kind: "observe", present: false, valid: false });

    expect(
      evaluateFrontDoor(
        "POST",
        "/api/auth/sign-in/social",
        headers({ [FRONT_DOOR_HEADER]: SECRET }),
        env,
      ),
    ).toEqual({ kind: "observe", present: true, valid: true });

    expect(
      evaluateFrontDoor(
        "POST",
        "/api/auth/sign-in/social",
        headers({ [FRONT_DOOR_HEADER]: "wrong-secret" }),
        env,
      ),
    ).toEqual({ kind: "observe", present: true, valid: false });
  });

  it("rejects a missing or wrong header when enforcement is on", () => {
    const enforced = { ...env, FRONT_DOOR_ENFORCE: "true" } as const;

    expect(
      evaluateFrontDoor("POST", "/api/trpc/deals.list", headers(), enforced),
    ).toEqual({ kind: "reject" });

    expect(
      evaluateFrontDoor(
        "POST",
        "/api/trpc/deals.list",
        headers({ [FRONT_DOOR_HEADER]: "wrong-secret" }),
        enforced,
      ),
    ).toEqual({ kind: "reject" });
  });

  it("passes a valid header when enforcement is on", () => {
    const enforced = { ...env, FRONT_DOOR_ENFORCE: "true" } as const;

    expect(
      evaluateFrontDoor(
        "POST",
        "/api/trpc/deals.list",
        headers({ [FRONT_DOOR_HEADER]: SECRET }),
        enforced,
      ),
    ).toEqual({ kind: "pass" });
  });

  it("never rejects an exempt path even when enforcement is on", () => {
    const enforced = { ...env, FRONT_DOOR_ENFORCE: "true" } as const;
    expect(
      evaluateFrontDoor("GET", "/health", headers(), enforced),
    ).toEqual({ kind: "exempt" });
  });
});

describe("frontDoorVerified", () => {
  it("is false when the secret is unset", () => {
    expect(frontDoorVerified(headers({ [FRONT_DOOR_HEADER]: SECRET }))).toBe(false);
  });

  it("is false when the header is absent", () => {
    expect(frontDoorVerified(headers(), env)).toBe(false);
  });

  it("is false when the header is wrong", () => {
    expect(
      frontDoorVerified(headers({ [FRONT_DOOR_HEADER]: "wrong" }), env),
    ).toBe(false);
  });

  it("is true only for the exact secret", () => {
    expect(frontDoorVerified(headers({ [FRONT_DOOR_HEADER]: SECRET }), env)).toBe(true);
  });
});

describe("constantTimeEquals", () => {
  it("distinguishes equal and unequal without leaking length", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("short", "a-much-longer-string")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
  });
});

describe("frontDoorSecret / frontDoorEnforced", () => {
  it("reads the env vars", () => {
    expect(frontDoorSecret({})).toBe("");
    expect(frontDoorSecret({ FRONT_DOOR_SECRET: "x" })).toBe("x");
    expect(frontDoorEnforced({})).toBe(false);
    expect(frontDoorEnforced({ FRONT_DOOR_ENFORCE: "true" })).toBe(true);
    expect(frontDoorEnforced({ FRONT_DOOR_ENFORCE: "1" })).toBe(false);
  });
});
