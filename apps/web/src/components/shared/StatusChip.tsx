/* eslint-disable react-refresh/only-export-components */
import { cva, type VariantProps } from "class-variance-authority";
import {
  contractStatusLabels,
  stageLabels,
  type ContractStatus,
  type DealStage,
  type DeliverableStatus,
  type InvoiceStatus,
} from "@sponsee/shared";

import { cn } from "@/lib/utils";

/**
 * Status pill (SPO-193).
 *
 * The mockup used one flat union of eleven kebab-case strings (`'contract-sent'`,
 * `'paid'`, `'done'`, …). That does not survive contact with the real schema: we
 * have four *separate* status enums that collide on `paid`, `draft` and `done`,
 * and they use snake_case. So the chip is keyed by `kind` + the matching shared
 * union instead, and each map is a `Record<Union, …>` — adding a status to
 * `@sponsee/shared` reds this file rather than silently rendering an unstyled pill.
 */
const chip = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-5 transition-colors duration-150",
  {
    variants: {
      tone: {
        neutral: "bg-ink/[.06] text-ink-2",
        accent: "bg-pine-tint text-pine",
        amber: "bg-amber-tint text-amber",
        danger: "bg-brick-tint text-brick",
        outline: "border border-ink/40 bg-transparent text-ink",
        quiet: "border border-hairline bg-surface-subtle text-ink-2",
        ink: "bg-ink-2 text-paper",
        pine: "bg-pine text-white",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

export type ChipTone = NonNullable<VariantProps<typeof chip>["tone"]>;

const dealTones: Record<DealStage, ChipTone> = {
  inbound: "neutral",
  negotiating: "amber",
  contract_sent: "outline",
  live: "accent",
  delivered: "ink",
  paid: "pine",
};

const invoiceTones: Record<InvoiceStatus, ChipTone> = {
  draft: "quiet",
  open: "neutral",
  paid: "pine",
  void: "quiet",
};

const invoiceLabels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Open",
  paid: "Paid",
  void: "Void",
};

const deliverableTones: Record<DeliverableStatus, ChipTone> = {
  not_started: "quiet",
  scheduled: "neutral",
  in_progress: "amber",
  done: "accent",
  missed: "danger",
  rescheduled: "amber",
};

const deliverableLabels: Record<DeliverableStatus, string> = {
  not_started: "Not started",
  scheduled: "Scheduled",
  in_progress: "In progress",
  done: "Done",
  missed: "Missed",
  rescheduled: "Rescheduled",
};

const contractTones: Record<ContractStatus, ChipTone> = {
  draft: "quiet",
  sent: "neutral",
  viewed: "amber",
  signed: "accent",
};

type KindProps =
  | { kind: "deal"; status: DealStage }
  | { kind: "invoice"; status: InvoiceStatus }
  | { kind: "deliverable"; status: DeliverableStatus }
  | { kind: "contract"; status: ContractStatus };

type StatusChipProps = (
  /** `label` is optional here — it overrides the domain copy for the status. */
  | (KindProps & { label?: string })
  /**
   * Escape hatch for derived states that are not a column value — "Overdue",
   * "Due in 3d", "Stale". Callers must supply their own tone and copy.
   *
   * `label` is *required* on this arm, not merely documented as such: there is
   * no status to derive copy from, so an omitted label would render a coloured
   * pill with no text — invisible to a screen reader and broken on screen.
   */
  | { kind?: undefined; status?: undefined; tone: ChipTone; label: string }
) & {
  className?: string;
};

/**
 * The single place a label is decided, so the returned `string` is honestly
 * non-empty: every `kind` has a domain map to fall back to, and the tone-only
 * arm types `label` as required.
 */
function resolve(props: StatusChipProps): { tone: ChipTone; label: string } {
  switch (props.kind) {
    case "deal":
      return {
        tone: dealTones[props.status],
        label: props.label ?? stageLabels[props.status],
      };
    case "invoice":
      return {
        tone: invoiceTones[props.status],
        label: props.label ?? invoiceLabels[props.status],
      };
    case "deliverable":
      return {
        tone: deliverableTones[props.status],
        label: props.label ?? deliverableLabels[props.status],
      };
    case "contract":
      return {
        tone: contractTones[props.status],
        label: props.label ?? contractStatusLabels[props.status],
      };
    default:
      return { tone: props.tone, label: props.label };
  }
}

export function StatusChip(props: StatusChipProps) {
  const { tone, label } = resolve(props);
  const isLiveDeal = props.kind === "deal" && props.status === "live";

  return (
    <span className={cn(chip({ tone }), props.className)}>
      {isLiveDeal && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pine" />
        </span>
      )}
      {label}
    </span>
  );
}

export { chip as statusChipVariants, invoiceLabels, deliverableLabels };
export default StatusChip;
