import { describe, it, expect } from "vitest";
import { resolvePublicAddress, UnsafeHostError, type LookupFn } from "./ssrf-guard.js";

function fakeLookup(records: Array<{ address: string; family: number }>): LookupFn {
  return async () => records;
}

describe("resolvePublicAddress", () => {
  it("returns the address for a public IPv4 host", async () => {
    const result = await resolvePublicAddress(
      "example.com",
      fakeLookup([{ address: "93.184.216.34", family: 4 }])
    );
    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("returns the address for a public IPv6 host", async () => {
    const result = await resolvePublicAddress(
      "example.com",
      fakeLookup([{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }])
    );
    expect(result.family).toBe(6);
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["cloud metadata / link-local", "169.254.169.254"],
    ["RFC1918 10/8", "10.1.2.3"],
    ["RFC1918 172.16/12", "172.16.5.5"],
    ["RFC1918 192.168/16", "192.168.1.1"],
    ["CGNAT", "100.64.0.1"],
    ["this-network", "0.0.0.0"],
    ["multicast", "224.0.0.1"],
    ["reserved / broadcast", "255.255.255.255"],
    ["TEST-NET-1", "192.0.2.1"],
  ])("rejects an IPv4 %s address (%s)", async (_label, address) => {
    await expect(resolvePublicAddress("evil.example", fakeLookup([{ address, family: 4 }]))).rejects.toThrow(
      UnsafeHostError
    );
  });

  it.each([
    ["loopback", "::1"],
    ["unique local", "fc00::1"],
    ["link-local", "fe80::1"],
    ["multicast", "ff02::1"],
    ["IPv4-mapped", "::ffff:127.0.0.1"],
  ])("rejects an IPv6 %s address (%s)", async (_label, address) => {
    await expect(resolvePublicAddress("evil.example", fakeLookup([{ address, family: 6 }]))).rejects.toThrow(
      UnsafeHostError
    );
  });

  it("rejects if ANY resolved address is private, even when others are public", async () => {
    await expect(
      resolvePublicAddress(
        "mixed.example",
        fakeLookup([
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ])
      )
    ).rejects.toThrow(UnsafeHostError);
  });

  it("rejects when DNS resolution fails", async () => {
    const failingLookup: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(resolvePublicAddress("nowhere.invalid", failingLookup)).rejects.toThrow(UnsafeHostError);
  });

  it("rejects when DNS returns no records", async () => {
    await expect(resolvePublicAddress("empty.example", fakeLookup([]))).rejects.toThrow(UnsafeHostError);
  });
});
