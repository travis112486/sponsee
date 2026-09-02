import { describe, it, expect } from "vitest";
import { activityKindEnum } from "@sponsee/db/schema";
import { activityKinds } from "@sponsee/shared";

/**
 * SPO-333. The Dashboard activity icon map used to key off its own keys
 * (`type ActivityKind = keyof typeof activityIcon`), so it was trivially total
 * against itself and adding a tenth `activity_kind` to the DB enum reds
 * nothing — the feed fell through `?? FileText` to the generic icon. The map
 * now keys off the shared `ActivityKind` union via
 * `satisfies Record<ActivityKind, LucideIcon>`, which is real totality only if
 * that union stays in step with the DDL enum.
 *
 * This test is the same contract as subscription-status.parity.test.ts: the
 * TypeScript vocabulary lives in `@sponsee/shared`, the DDL lives in
 * `@sponsee/db`, `packages/shared` stays free of a `packages/db` dependency, and
 * this test — the only package that depends on both — holds the two together.
 */
describe("activity kind parity", () => {
  it("carries the same kinds in @sponsee/shared and the drizzle enum", () => {
    // Sorted, because the enum's declaration order is DDL-significant while
    // the shared list's order means nothing. Reordering one should not red
    // this test; adding or dropping a value must.
    expect([...activityKinds].sort()).toEqual([...activityKindEnum.enumValues].sort());
  });

  it("declares no duplicate kinds on either side", () => {
    expect(new Set(activityKinds).size).toBe(activityKinds.length);
    expect(new Set(activityKindEnum.enumValues).size).toBe(
      activityKindEnum.enumValues.length
    );
  });
});
