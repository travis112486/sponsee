import {
  contractStatusLabels,
  platformLabels,
  proofKindLabels,
  stageLabels,
  type ActivityKind,
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

// A non-chase activity whose specific action we don't recognise yet still names
// its own noun — never "Chase" (SPO-334, SPO-345).
function genericLabel(noun: string, actor: string): string {
  return actor === "system" ? `${noun} activity` : `${noun} updated`;
}

type ActivityDescriber = (actor: string, p: ActivityPayload) => string;

// Shared by the Dashboard activity feed and the Topbar notification bell so the
// two surfaces can never describe the same event differently (SPO-153).
//
// One deliberate label per `activity_kind`, total against the shared
// `ActivityKind` union (which activity-kinds.parity.test.ts holds against the
// DB enum) — the label path's mirror of the icon map's
// `satisfies Record<ActivityKind, LucideIcon>`. Adding a tenth kind reds this
// map at compile time instead of silently falling through to chase copy, and
// "Chase …" copy can only be produced by the `chase_sent` arm (SPO-345).
const describeByKind = {
  contract: (actor, p) => {
    if (p.action === "status_change") {
      const to = p.to ? contractStatusLabels[p.to as ContractStatus] ?? p.to : "";
      return to ? `Contract ${lowerFirst(to)}` : "Contract status changed";
    }
    if (p.action === "attached") return "Contract attached";
    if (p.action === "updated") return "Contract updated";
    if (p.action === "removed") return "Contract removed";
    return genericLabel("Contract", actor);
  },

  stage_change: (_actor, p) => {
    const to = p.to ? stageLabels[p.to as DealStage] ?? p.to : "";
    return to ? `Deal moved to ${to}` : "Deal stage changed";
  },

  platform_sync: (_actor, p) => {
    const platform = p.platform ? platformLabels[p.platform as Platform] ?? p.platform : "";
    return platform ? `${platform} stats synced` : "Platform stats synced";
  },

  chase_sent: (actor, p) => {
    const step = p.step !== undefined ? `step ${p.step}` : "chase";
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
  },

  deliverable: (actor, p) => {
    const proofKind = p.proofKind ? proofKindLabels[p.proofKind as ProofKind] ?? p.proofKind : "";
    if (p.action === "proof_added") return `Evidence added${proofKind ? ` (${proofKind})` : ""}`;
    if (p.action === "proof_removed") return `Evidence removed${proofKind ? ` (${proofKind})` : ""}`;
    return genericLabel("Deliverable", actor);
  },

  invoice: (actor) => genericLabel("Invoice", actor),
  payment: (actor) => genericLabel("Payment", actor),
  inquiry: (actor) => genericLabel("Inquiry", actor),
  note: (actor) => genericLabel("Note", actor),
} satisfies Record<ActivityKind, ActivityDescriber>;

// Runtime-only safety net for a kind that reaches the client before this build
// has shipped — it is not the totality guard (the `satisfies` above is).
function describeUnknownKind(actor: string): string {
  return actor === "system" ? "Activity" : "Activity updated";
}

export function describeActivity(actor: string, payload: unknown, kind: ActivityKind): string {
  const p = (payload ?? {}) as ActivityPayload;
  const describe = describeByKind[kind] ?? describeUnknownKind;
  return describe(actor, p);
}
