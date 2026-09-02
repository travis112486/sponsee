import {
  contractStatusLabels,
  platformLabels,
  proofKindLabels,
  stageLabels,
  type ContractStatus,
  type DealStage,
  type Platform,
  type ProofKind,
} from "@sponsee/shared";

export type ActivityPayload = {
  step?: number;
  status?: string;
  action?: string;
  reason?: string;
  proofKind?: string;
  from?: string;
  to?: string;
  trigger?: string;
  platform?: string;
  handle?: string;
};

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

// Shared by the Dashboard activity feed and the Topbar notification bell so the
// two surfaces can never describe the same event differently (SPO-153).
export function describeActivity(actor: string, payload: unknown, kind?: string): string {
  const p = (payload ?? {}) as ActivityPayload;

  // Contract, stage and platform events share no fields with a chase event, so
  // they have to be named from `kind` — a payload-only switch mislabeled every
  // one of them "Chase updated" / "Chase activity" (SPO-334).
  if (kind === "contract") {
    if (p.action === "status_change") {
      const to = p.to ? contractStatusLabels[p.to as ContractStatus] ?? p.to : "";
      return to ? `Contract ${lowerFirst(to)}` : "Contract status changed";
    }
    if (p.action === "attached") return "Contract attached";
    if (p.action === "updated") return "Contract updated";
    if (p.action === "removed") return "Contract removed";
    return actor === "system" ? "Contract activity" : "Contract updated";
  }

  if (kind === "stage_change") {
    const to = p.to ? stageLabels[p.to as DealStage] ?? p.to : "";
    return to ? `Deal moved to ${to}` : "Deal stage changed";
  }

  if (kind === "platform_sync") {
    const platform = p.platform ? platformLabels[p.platform as Platform] ?? p.platform : "";
    return platform ? `${platform} stats synced` : "Platform stats synced";
  }

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
