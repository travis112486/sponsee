import { describe, it, expect } from "vitest";
import { activityKinds } from "@sponsee/shared";
import { describeActivity } from "./activity-label";

describe("describeActivity", () => {
  it("names contract events from their action instead of chase copy", () => {
    expect(describeActivity("creator", { action: "attached" }, "contract")).toBe("Contract attached");
    expect(describeActivity("creator", { action: "updated" }, "contract")).toBe("Contract updated");
    expect(describeActivity("creator", { action: "removed" }, "contract")).toBe("Contract removed");
  });

  it("names a contract status change from the destination status", () => {
    expect(
      describeActivity("creator", { action: "status_change", from: "draft", to: "sent" }, "contract")
    ).toBe("Contract sent");
    expect(
      describeActivity("creator", { action: "status_change", from: "sent", to: "signed" }, "contract")
    ).toBe("Contract signed");
  });

  it("names deal stage changes by the destination stage", () => {
    expect(
      describeActivity("system", { from: "negotiating", to: "contract_sent", trigger: "contract_status" }, "stage_change")
    ).toBe("Deal moved to Contract Sent");
  });

  it("names platform syncs by platform", () => {
    expect(describeActivity("system", { platform: "twitch", handle: "pixelpanda" }, "platform_sync")).toBe(
      "Twitch stats synced"
    );
    expect(describeActivity("system", { platform: "youtube", handle: "pixelpanda" }, "platform_sync")).toBe(
      "YouTube stats synced"
    );
  });

  it("keeps the existing chase and proof copy intact", () => {
    expect(describeActivity("system", { status: "sent", step: 1 }, "chase_sent")).toBe("Chase step 1 sent");
    expect(describeActivity("creator", { action: "proof_added", proofKind: "vod" }, "deliverable")).toBe(
      "Evidence added (VOD)"
    );
    expect(describeActivity("creator", { action: "pause", reason: "manual" }, "chase_sent")).toBe(
      "Chase paused (manual)"
    );
  });

  it("names the remaining six kinds by their own noun, never chase copy (SPO-345)", () => {
    expect(describeActivity("creator", {}, "invoice")).toBe("Invoice updated");
    expect(describeActivity("system", {}, "invoice")).toBe("Invoice activity");
    expect(describeActivity("creator", {}, "payment")).toBe("Payment updated");
    expect(describeActivity("creator", {}, "inquiry")).toBe("Inquiry updated");
    expect(describeActivity("creator", {}, "note")).toBe("Note updated");
    expect(describeActivity("creator", {}, "deliverable")).toBe("Deliverable updated");
    expect(describeActivity("system", {}, "deliverable")).toBe("Deliverable activity");
  });

  it("keeps 'Chase …' copy exclusive to the chase_sent kind (SPO-345)", () => {
    expect(describeActivity("creator", {}, "chase_sent")).toBe("Chase updated");
    expect(describeActivity("system", {}, "chase_sent")).toBe("Chase activity");
  });

  it("never renders chase copy for any non-chase kind, whatever the actor (SPO-345)", () => {
    for (const kind of activityKinds) {
      if (kind === "chase_sent") continue;
      for (const actor of ["creator", "system"] as const) {
        expect(describeActivity(actor, {}, kind)).not.toMatch(/chase/i);
      }
    }
  });
});
