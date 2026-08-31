import { proofKindLabels, type ProofKind } from "@sponsee/shared";

export type ActivityPayload = {
  step?: number;
  status?: string;
  action?: string;
  reason?: string;
  proofKind?: string;
};

// Shared by the Dashboard activity feed and the Topbar notification bell so the
// two surfaces can never describe the same event differently (SPO-153).
export function describeActivity(actor: string, payload: unknown): string {
  const p = (payload ?? {}) as ActivityPayload;
  const step = p.step !== undefined ? `step ${p.step}` : "chase";

  const proofKind = p.proofKind ? proofKindLabels[p.proofKind as ProofKind] ?? p.proofKind : "";
  if (p.action === "proof_added") return `Evidence added${proofKind ? ` (${proofKind})` : ""}`;
  if (p.action === "proof_removed") return `Evidence removed${proofKind ? ` (${proofKind})` : ""}`;

  if (p.action === "pause") return `Chase paused${p.reason ? ` (${p.reason})` : ""}`;
  if (p.action === "resume") return "Chase resumed";
  if (p.action === "approve") return `Chase ${step} approved and sent`;
  if (p.action === "edit_and_send") return `Chase ${step} edited and sent`;

  switch (p.status) {
    case "awaiting_review":
      return `Chase ${step} ready for review`;
    case "sent":
      return `Chase ${step} sent`;
    case "bounced":
      return `Chase ${step} bounced`;
    case "failed":
      return `Chase ${step} failed to send`;
    case "complained":
      return `Spam complaint on chase ${step}`;
    default:
      return actor === "system" ? "Chase activity" : "Chase updated";
  }
}
