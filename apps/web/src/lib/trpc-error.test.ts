import { describe, it, expect, vi } from "vitest";
import {
  applyServerFieldErrors,
  serverErrorMessage,
  serverZodError,
  type ServerErrorLike,
} from "./trpc-error";

function errorWith(fieldErrors: Record<string, string[]>, formErrors: string[] = []): ServerErrorLike {
  return {
    message: "Avatar URL: Must be an https:// URL",
    data: { zodError: { formErrors, fieldErrors } },
  };
}

describe("serverZodError", () => {
  it("returns the flattened error when the server sent one", () => {
    expect(serverZodError(errorWith({ avatarUrl: ["bad"] }))).toEqual({
      formErrors: [],
      fieldErrors: { avatarUrl: ["bad"] },
    });
  });

  it("returns null for non-validation errors", () => {
    expect(serverZodError({ message: "No creator workspace", data: { zodError: null } })).toBeNull();
    expect(serverZodError({ message: "boom" })).toBeNull();
    expect(serverZodError({} as ServerErrorLike)).toBeNull();
  });
});

describe("serverErrorMessage", () => {
  it("prefers the server message", () => {
    expect(serverErrorMessage({ message: "Avatar URL: bad" }, "Failed")).toBe("Avatar URL: bad");
  });

  it("falls back when the message is empty or missing", () => {
    expect(serverErrorMessage({ message: "" }, "Failed")).toBe("Failed");
    expect(serverErrorMessage({}, "Failed")).toBe("Failed");
  });
});

describe("applyServerFieldErrors", () => {
  it("sets each mappable field error on the form", () => {
    const setError = vi.fn();
    const result = applyServerFieldErrors(
      errorWith({ avatarUrl: ["Must be an https:// URL"] }),
      setError,
      ["avatarUrl", "displayName"]
    );

    expect(result).toEqual({ applied: 1, unmapped: false });
    expect(setError).toHaveBeenCalledWith(
      "avatarUrl",
      { type: "server", message: "Must be an https:// URL" },
      { shouldFocus: true }
    );
  });

  it("joins multiple messages for one field", () => {
    const setError = vi.fn();
    applyServerFieldErrors(errorWith({ displayName: ["Required", "Too short"] }), setError, [
      "displayName",
    ]);

    expect(setError).toHaveBeenCalledWith(
      "displayName",
      { type: "server", message: "Required, Too short" },
      { shouldFocus: true }
    );
  });

  it("focuses only the first field it sets", () => {
    const setError = vi.fn();
    const result = applyServerFieldErrors(
      errorWith({ displayName: ["Required"], avatarUrl: ["Bad URL"] }),
      setError,
      ["displayName", "avatarUrl"]
    );

    expect(result.applied).toBe(2);
    expect(setError.mock.calls[0][2]).toEqual({ shouldFocus: true });
    expect(setError.mock.calls[1][2]).toEqual({ shouldFocus: false });
  });

  it("reports fields the form cannot render as unmapped", () => {
    const setError = vi.fn();
    const result = applyServerFieldErrors(errorWith({ timezone: ["Unknown timezone"] }), setError, [
      "displayName",
    ]);

    expect(result).toEqual({ applied: 0, unmapped: true });
    expect(setError).not.toHaveBeenCalled();
  });

  it("treats form-level errors as unmapped even when a field was set", () => {
    const setError = vi.fn();
    const result = applyServerFieldErrors(
      errorWith({ displayName: ["Required"] }, ["Expected object, received string"]),
      setError,
      ["displayName"]
    );

    expect(result).toEqual({ applied: 1, unmapped: true });
  });

  it("skips fields with an empty message list", () => {
    const setError = vi.fn();
    const result = applyServerFieldErrors(errorWith({ displayName: [] }), setError, ["displayName"]);

    expect(result).toEqual({ applied: 0, unmapped: false });
    expect(setError).not.toHaveBeenCalled();
  });

  it("reports a non-validation error as unmapped so the caller still toasts", () => {
    const setError = vi.fn();
    const result = applyServerFieldErrors({ message: "No creator workspace" }, setError, [
      "displayName",
    ]);

    expect(result).toEqual({ applied: 0, unmapped: true });
    expect(setError).not.toHaveBeenCalled();
  });
});
