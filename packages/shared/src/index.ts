import { renderMergeTokens, validateMergeTokens, hasMergeTokens } from "./merge-tokens.js";

export * from "./merge-tokens.js";
export * from "./calculator.js";
export * from "./benchmark.js";
export * from "./subscription.js";
export * from "./timezone.js";
export * from "./brand-domain.js";

// Re-export for convenience
export { renderMergeTokens, validateMergeTokens, hasMergeTokens };

// ── Domain constants (shared across web + API) ───────────────────────────────

export const platforms = ["twitch", "youtube", "kick", "tiktok"] as const;
export type Platform = (typeof platforms)[number];

export const platformLabels: Record<Platform, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  tiktok: "TikTok",
};

export const dealStages = [
  "inbound",
  "negotiating",
  "contract_sent",
  "live",
  "delivered",
  "paid",
] as const;
export type DealStage = (typeof dealStages)[number];

export const stageOrder: Record<DealStage, number> = {
  inbound: 0,
  negotiating: 1,
  contract_sent: 2,
  live: 3,
  delivered: 4,
  paid: 5,
};

export const stageLabels: Record<DealStage, string> = {
  inbound: "Inbound",
  negotiating: "Negotiating",
  contract_sent: "Contract Sent",
  live: "Live",
  delivered: "Delivered",
  paid: "Paid",
};

export const dealTypes = ["flat", "bounty", "hybrid"] as const;
export type DealType = (typeof dealTypes)[number];

export const invoiceStatuses = ["draft", "open", "paid", "void"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const deliverableStatuses = [
  "not_started",
  "scheduled",
  "in_progress",
  "done",
  "missed",
  "rescheduled",
] as const;
export type DeliverableStatus = (typeof deliverableStatuses)[number];

export const contractStatuses = ["draft", "sent", "viewed", "signed"] as const;
export type ContractStatus = (typeof contractStatuses)[number];

export const contractStatusLabels: Record<ContractStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  signed: "Signed",
};

export const paymentTerms = ["net_15", "net_30", "net_45"] as const;
export type PaymentTerms = (typeof paymentTerms)[number];

export const paymentTermsDays: Record<PaymentTerms, number> = {
  net_15: 15,
  net_30: 30,
  net_45: 45,
};

export const chaseSteps = [1, 2, 3] as const;
export type ChaseStep = (typeof chaseSteps)[number];

export const defaultChaseOffsets: Record<ChaseStep, number> = {
  1: 3,
  2: 14,
  3: 30,
};

export const defaultChaseTemplates: Array<{
  step: ChaseStep;
  name: string;
  subject: string;
  body: string;
}> = [
  {
    step: 1,
    name: "Friendly reminder",
    subject: "Quick reminder: {invoice} for {deal_title} is due",
    body: `Hi {brand_contact},\n\nJust a friendly reminder that invoice {invoice} for {deal_title} ($\{amount}) is now {days_late} days overdue.\n\nPlease let me know if you need anything from my side.\n\nBest,\n{creator_name}`,
  },
  {
    step: 2,
    name: "Second notice",
    subject: "Second notice: {invoice} — {amount} due",
    body: `Hi {brand_contact},\n\nFollowing up on invoice {invoice} for {deal_title} ($\{amount}), which is now {days_late} days overdue.\n\nIf there's an issue with the invoice or payment process, please reach out and I'll resolve it right away.\n\nBest,\n{creator_name}`,
  },
  {
    step: 3,
    name: "Final notice",
    subject: "Final notice: {invoice} — {amount} — {days_late} days overdue",
    body: `Hi {brand_contact},\n\nThis is a final notice regarding invoice {invoice} for {deal_title} ($\{amount}), which is now {days_late} days overdue.\n\nPlease remit payment within the next 48 hours to avoid further escalation.\n\nBest,\n{creator_name}`,
  },
];

// Proof kinds. "file" is the drag-in-a-screenshot path (SPO-157); the rest are
// links/notes that stay as URLs (VODs, clips, chat logs, overlays) rather than
// re-hosted files.
export const proofKinds = ["vod", "clip", "chat", "overlay", "link", "file"] as const;
export type ProofKind = (typeof proofKinds)[number];

export const proofKindLabels: Record<ProofKind, string> = {
  vod: "VOD",
  clip: "Clip",
  chat: "Chat log",
  overlay: "Overlay",
  link: "Link",
  file: "File",
};

// Activity entity kinds. Single source for the TypeScript vocabulary — the
// web icon map keys off this union and the API parity test
// (activity-kinds.parity.test.ts) holds it against the DDL enum
// `activityKindEnum` in @sponsee/db, mirroring SPO-120's subscription-status
// split: this package owns the vocabulary, the db schema owns the DDL, and
// only the parity test keeps the two from drifting.
export const activityKinds = [
  "invoice",
  "contract",
  "deliverable",
  "payment",
  "inquiry",
  "stage_change",
  "chase_sent",
  "note",
  "platform_sync",
  "invoice_sent",
] as const;
export type ActivityKind = (typeof activityKinds)[number];

// Plan tiers (PRD names)
export const planTiers = ["starter", "creator", "pro"] as const;
export type PlanTier = (typeof planTiers)[number];

export const planPricesCents: Record<PlanTier, number> = {
  starter: 1900,
  creator: 2900,
  pro: 3900,
};

export const planDealSlots: Record<PlanTier, number> = {
  starter: 5,
  creator: 10,
  pro: 25,
};

export const planLabels: Record<PlanTier, string> = {
  starter: "Starter",
  creator: "Creator",
  pro: "Pro",
};
