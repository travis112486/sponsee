import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Deliberate tripwire against uncommitted-design regression (SPO-71), not a style spec.
// It asserts literal class strings, so any legitimate restyle (reordering utilities,
// tweaking a pixel value, extracting a shared class) will red this file even when the
// rendered UI is correct — the fix in that case is to update the string here, not to
// treat a failure as a signal something is broken. Follow-up: migrate these to
// assertions about rendered output (e.g. render the component and assert computed
// styles / DOM shape) so a restyle can't silently make the assertion meaningless.
function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("SPO-71 visual parity safeguards", () => {
  it("keeps the approved Login surface and editorial heading", () => {
    const login = source("./auth/LoginPage.tsx");

    expect(login).toContain("max-w-[420px] rounded-2xl border border-hairline bg-surface");
    expect(login).toContain('font-serif text-[27px] leading-tight');
    expect(login).toContain("bg-surface-subtle p-5 text-center");
  });

  it("keeps Settings grouped in a bounded surface with responsive tabs", () => {
    const settings = source("./SettingsPage.tsx");

    expect(settings).toContain('font-serif text-[22px] tracking-[-0.01em]');
    expect(settings).toContain("overflow-x-auto border-b border-hairline");
    expect(settings).toContain("flex shrink-0 items-center");
    expect(settings).toContain("rounded-xl border border-hairline bg-surface p-5 shadow-warm");
  });

  it("keeps Pipeline deal cards stable and allows two-line titles", () => {
    const pipeline = source("./Pipeline.tsx");

    expect(pipeline).toContain("group relative min-h-[118px] rounded-lg");
    expect(pipeline).toContain("mt-0.5 line-clamp-2 text-[13px] font-medium leading-[18px]");
  });

  it("keeps Dashboard KPI cards visually prioritized", () => {
    const dashboard = source("./Dashboard.tsx");

    expect(dashboard).toContain("min-h-[112px] rounded-xl");
    expect(dashboard).toContain("p-4 text-left shadow-warm transition-all");
    expect(dashboard).toContain('mt-2 font-serif text-[22px] leading-none');
  });

  it("keeps Payments money totals and chase details in the approved hierarchy", () => {
    const payments = source("./Payments.tsx");

    expect(payments).toContain("rounded-xl border border-hairline bg-surface p-4 shadow-warm");
    expect(payments).toContain('mt-2 font-serif text-[20px] leading-none');
    expect(payments).toContain("mx-4 mb-4 rounded-lg border border-hairline bg-surface-subtle p-4");
    expect(payments).toContain("mt-3 space-y-1.5");
  });

  it("uses the editorial page-title treatment on every Calendar state", () => {
    const calendar = source("./CalendarPage.tsx");

    expect(calendar.match(/font-serif text-\[19px\] text-ink/g)).toHaveLength(4);
  });
});
