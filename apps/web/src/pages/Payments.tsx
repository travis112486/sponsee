import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@sponsee/api/routers";
import { trpc } from "@/trpc";
import { cn } from "@/lib/utils";
import { serverErrorMessage } from "@/lib/trpc-error";
import { toast } from "sonner";
import {
  Plus,
  FileText,
  Clock,
  CheckCircle2,
  Ban,
  ChevronRight,
  Mail,
  Pause,
  Play,
  AlertTriangle,
  Send,
  Edit3,
} from "lucide-react";
import QueryError from "@/components/QueryError";
import StatusChip from "@/components/shared/StatusChip";

type LatestDelivery = inferRouterOutputs<AppRouter>["invoice"]["latestDeliveries"][number];

type DeliveryDisplayState = "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed";

// Every branch here is live: `invoice.send` writes queued -> sent (or -> failed
// on a provider throw), and SPO-364's webhook correlation writes delivered /
// openedAt / bounced onto invoice_deliveries (see webhooks.ts).
function deliveryDisplayState(delivery: LatestDelivery): DeliveryDisplayState {
  if (delivery.status === "bounced") return "bounced";
  if (delivery.status === "failed") return "failed";
  if (delivery.openedAt) return "opened";
  if (delivery.deliveredAt || delivery.status === "delivered") return "delivered";
  if (delivery.status === "queued") return "queued";
  return "sent";
}

const deliveryChipConfig: Record<
  DeliveryDisplayState,
  { label: string; tone: "amber" | "accent" | "pine" | "danger" }
> = {
  queued: { label: "Sending", tone: "amber" },
  sent: { label: "Sent", tone: "amber" },
  delivered: { label: "Delivered", tone: "accent" },
  opened: { label: "Opened", tone: "pine" },
  bounced: { label: "Bounced", tone: "danger" },
  failed: { label: "Send failed", tone: "danger" },
};

/**
 * Why Resume is gated on "a send actually left", not on `delivered`.
 *
 * The epic's bug is chasing an invoice the brand never received, so the gate
 * has to cover the never-sent case — that is the one this UI can definitely
 * see. `delivered` is a strictly stronger signal but it only ever arrives via
 * a provider webhook (webhooks.ts): if that endpoint is unregistered, or the
 * provider drops the event, no `delivered` row is ever written and gating on
 * it would strand Resume permanently with no self-service way out. So a
 * successful `sent` clears the gate and the panel says delivery is still
 * unconfirmed, rather than locking the creator out of their own chase.
 *
 * Pause is never gated — see InvoiceChasePanel.
 */
function chaseLockReason(
  deliveryState: DeliveryDisplayState | null
): string | null {
  if (deliveryState === null)
    return 'Chase is locked — this invoice has not been sent to the brand yet. Use "Send invoice" above first, so reminders have something to follow up on.';
  if (deliveryState === "queued")
    return "Chase is locked — this invoice's send has not left the queue yet. Refresh in a moment.";
  if (deliveryState === "bounced")
    return "Chase is locked — this invoice's email bounced, so reminders would go nowhere until it's resent to a working address.";
  if (deliveryState === "failed")
    return "Chase is locked — the last send failed before it reached the brand, so reminders would go nowhere until it's resent.";
  return null;
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function daysDiff(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

const statusConfig: Record<
  string,
  { label: string; icon: React.ElementType; color: string }
> = {
  draft: { label: "Draft", icon: FileText, color: "bg-ink-3/10 text-ink-3" },
  open: { label: "Open", icon: Clock, color: "bg-amber-tint text-amber" },
  paid: { label: "Paid", icon: CheckCircle2, color: "bg-pine-tint text-pine" },
  void: { label: "Void", icon: Ban, color: "bg-ink-3/10 text-ink-3" },
};

export default function Payments() {
  const utils = trpc.useUtils();
  const { data: invoices, isLoading, isError, refetch } = trpc.invoice.list.useQuery();
  const { data: deliveries, isError: deliveriesError } = trpc.invoice.latestDeliveries.useQuery();
  const { data: awaitingReview } = trpc.chase.awaitingReview.useQuery();
  const deliveryByInvoice = useMemo(() => {
    const map = new Map<string, LatestDelivery>();
    for (const d of deliveries ?? []) map.set(d.invoiceId, d);
    return map;
  }, [deliveries]);
  const markPaid = trpc.invoice.markPaid.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      toast("Invoice marked as paid");
    },
  });
  const sendInvoice = trpc.invoice.send.useMutation({
    onSuccess: () => {
      utils.invoice.list.invalidate();
      utils.invoice.latestDeliveries.invalidate();
      toast("Invoice sent");
    },
    onError: (err) =>
      toast.error(serverErrorMessage(err, "Couldn't send this invoice. Please try again.")),
  });
  const approveChase = trpc.chase.approve.useMutation({
    onSuccess: () => {
      utils.chase.awaitingReview.invalidate();
      utils.invoice.list.invalidate();
      toast("Chase email sent");
    },
    onError: (err) =>
      toast.error(serverErrorMessage(err, "Failed to send chase email. Please try again.")),
  });
  const editAndSendChase = trpc.chase.editAndSend.useMutation({
    onSuccess: () => {
      utils.chase.awaitingReview.invalidate();
      utils.invoice.list.invalidate();
      toast("Chase email sent");
    },
    onError: (err) =>
      toast.error(serverErrorMessage(err, "Failed to send chase email. Please try again.")),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return <QueryError message="Couldn't load your invoices." onRetry={() => refetch()} />;
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-[19px] text-ink">Payments</h2>
          <p className="text-[13px] text-ink-3">
            {invoices?.length ?? 0} invoices
          </p>
        </div>
        <button
          onClick={() => toast("Create invoice from a deal on the Pipeline page")}
          className="flex h-8 items-center gap-1.5 rounded-lg bg-pine px-3 text-[13px] font-medium text-white transition-colors hover:bg-pine-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New invoice
        </button>
      </div>

      {/* Awaiting review queue */}
      {awaitingReview && awaitingReview.length > 0 && (
        <div className="rounded-xl border border-amber/30 bg-amber-tint/30 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber" />
            <h3 className="text-[13px] font-semibold text-amber">
              Awaiting review — {awaitingReview.length} chase{awaitingReview.length === 1 ? "" : "s"}
            </h3>
          </div>
          <div className="mt-2 space-y-2">
            {awaitingReview.map(({ event, invoice, recipientEmail }) => (
              <div
                key={event.id}
                className="rounded-lg border border-hairline bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-ink">
                      {invoice.title || `Invoice #${invoice.number}`} — Step {event.step}
                    </p>
                    {recipientEmail ? (
                      <p className="text-[11px] text-ink-3">
                        To: {recipientEmail}
                      </p>
                    ) : (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-brick">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        No recipient email — add a primary contact to this deal
                        before sending.
                      </p>
                    )}
                    {editingEventId === event.id ? (
                      <div className="mt-2 space-y-2">
                        <input
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="h-8 w-full rounded border border-hairline px-2 text-[12px] text-ink outline-none focus:border-pine"
                        />
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={3}
                          className="w-full rounded border border-hairline px-2 py-1 text-[12px] text-ink outline-none focus:border-pine"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              editAndSendChase.mutate({
                                chaseEventId: event.id,
                                subject: editSubject,
                                body: editBody,
                              })
                            }
                            disabled={editAndSendChase.isPending || !recipientEmail}
                            className="flex h-7 items-center gap-1 rounded-md bg-pine px-2 text-[11px] font-medium text-white hover:bg-pine-hover disabled:opacity-50"
                          >
                            <Send className="h-3 w-3" />
                            Send
                          </button>
                          <button
                            onClick={() => {
                              setEditingEventId(null);
                              setEditSubject("");
                              setEditBody("");
                            }}
                            className="h-7 rounded-md border border-hairline px-2 text-[11px] text-ink-3 hover:bg-surface-subtle"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 truncate text-[11px] text-ink-2">
                        {event.subjectSnapshot}
                      </p>
                    )}
                  </div>
                  {editingEventId !== event.id && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => {
                          setEditingEventId(event.id);
                          setEditSubject(event.subjectSnapshot || "");
                          setEditBody(event.bodySnapshot || "");
                        }}
                        className="flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-[11px] text-ink-3 transition-colors hover:bg-surface-subtle"
                      >
                        <Edit3 className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        onClick={() => approveChase.mutate({ chaseEventId: event.id })}
                        disabled={approveChase.isPending || !recipientEmail}
                        className="flex h-7 items-center gap-1 rounded-md bg-pine px-2 text-[11px] font-medium text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Total outstanding"
          value={formatCents(
            invoices
              ?.filter((i) => i.status === "open")
              .reduce((sum, i) => sum + i.amountCents, 0) ?? 0
          )}
          accent="text-amber"
        />
        <StatCard
          label="Overdue"
          value={String(
            invoices?.filter(
              (i) => i.status === "open" && i.dueAt && new Date(i.dueAt) < now
            ).length ?? 0
          )}
          accent="text-brick"
        />
        <StatCard
          label="Paid (YTD)"
          value={formatCents(
            invoices
              ?.filter((i) => i.status === "paid")
              .reduce((sum, i) => sum + i.amountCents, 0) ?? 0
          )}
          accent="text-pine"
        />
      </div>

      {/* Invoice list */}
      <div className="rounded-xl border border-hairline bg-surface">
        {deliveriesError && (
          <div className="flex items-center gap-1.5 border-b border-hairline bg-brick-tint/40 px-4 py-2 text-[11px] font-medium text-brick">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Couldn't load delivery status. Send/resend still works — refresh to see chips.
          </div>
        )}
        <div className="grid grid-cols-12 gap-3 border-b border-hairline px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-ink-3">
          <div className="col-span-3">Invoice</div>
          <div className="col-span-2">Amount</div>
          <div className="col-span-2">Due</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-3">Actions</div>
        </div>

        {invoices && invoices.length > 0 ? (
          invoices.map((inv) => {
            const dueDate = inv.dueAt ? new Date(inv.dueAt) : null;
            const isOverdue =
              inv.status === "open" && dueDate && dueDate < now;
            const daysOverdue = isOverdue && dueDate ? daysDiff(dueDate, now) : 0;
            const status = statusConfig[inv.status] ?? statusConfig.draft;
            const StatusIcon = status.icon;
            const delivery = deliveryByInvoice.get(inv.id);
            const deliveryState = delivery ? deliveryDisplayState(delivery) : null;
            const deliveryChip = deliveryState ? deliveryChipConfig[deliveryState] : null;
            // Fails open: an errored deliveries query makes "no delivery row"
            // indistinguishable from "never sent", so we don't know the state
            // and must not lock a control on a guess.
            const chaseLock = deliveriesError ? null : chaseLockReason(deliveryState);
            const canSend = inv.status === "draft" || inv.status === "open";

            return (
              <div
                key={inv.id}
                className="border-b border-hairline last:border-b-0"
              >
                <div className="grid grid-cols-12 items-center gap-3 px-4 py-3">
                  <div className="col-span-3">
                    <p className="text-[13px] font-medium text-ink">
                      {inv.title || `Invoice #${inv.number}`}
                    </p>
                    <p className="text-[11px] text-ink-3">
                      Issued {new Date(inv.issuedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[13px] font-semibold text-ink">
                      {formatCents(inv.amountCents)}
                    </p>
                  </div>
                  <div className="col-span-2">
                    {dueDate ? (
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            "text-[12px]",
                            isOverdue ? "text-brick font-medium" : "text-ink-2"
                          )}
                        >
                          {dueDate.toLocaleDateString()}
                        </span>
                        {isOverdue && (
                          <span className="rounded bg-brick-tint px-1 py-0.5 text-[10px] font-semibold text-brick">
                            {daysOverdue}d late
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-3">—</span>
                    )}
                  </div>
                  <div className="col-span-2 flex flex-col items-start gap-1">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        status.color
                      )}
                    >
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </span>
                    {deliveryChip && (
                      <StatusChip tone={deliveryChip.tone} label={deliveryChip.label} />
                    )}
                  </div>
                  <div className="col-span-3 flex flex-wrap items-center gap-2">
                    {inv.status === "open" && (
                      <button
                        onClick={() =>
                          markPaid.mutate({ id: inv.id })
                        }
                        className="flex h-7 items-center gap-1 rounded-md border border-pine/30 bg-pine-tint px-2 text-[11px] font-medium text-pine transition-colors hover:bg-pine/10"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Mark paid
                      </button>
                    )}
                    {canSend && (
                      <button
                        onClick={() => {
                          const confirmMessage = delivery
                            ? `Resend this invoice to ${delivery.toEmail}? This puts another email in their inbox.`
                            : "Send this invoice? This puts an email in the brand's inbox.";
                          if (!confirm(confirmMessage)) return;
                          sendInvoice.mutate({ id: inv.id });
                        }}
                        disabled={sendInvoice.isPending}
                        className="flex h-7 items-center gap-1 rounded-md bg-pine px-2 text-[11px] font-medium text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
                      >
                        <Send className="h-3 w-3" />
                        {delivery ? "Resend" : "Send invoice"}
                      </button>
                    )}
                    <button
                      onClick={() =>
                        setExpandedId(expandedId === inv.id ? null : inv.id)
                      }
                      className="flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-[11px] text-ink-2 transition-colors hover:bg-surface-subtle"
                    >
                      {expandedId === inv.id ? "Less" : "More"}
                      <ChevronRight
                        className={cn(
                          "h-3 w-3 transition-transform",
                          expandedId === inv.id && "rotate-90"
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Full-width so the reason sentence has room instead of
                    wrapping hard inside the 2/12 Status column. */}
                {(deliveryState === "bounced" || deliveryState === "failed") && (
                  <p className="flex items-start gap-1 px-4 pb-3 text-[11px] font-medium text-brick">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {deliveryState === "bounced" && delivery
                      ? `Undelivered to ${delivery.toEmail} — confirm the address and resend.`
                      : "The send failed before it reached the brand — resend to try again."}
                  </p>
                )}

                {/* Expanded chase info */}
                {expandedId === inv.id && inv.status === "open" && (
                  <InvoiceChasePanel invoiceId={inv.id} chaseLock={chaseLock} />
                )}
              </div>
            );
          })
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-ink-3">No invoices yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-4 shadow-warm">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
        {label}
      </p>
      <p className={cn("mt-2 font-serif text-[20px] leading-none", accent)}>{value}</p>
    </div>
  );
}

function InvoiceChasePanel({
  invoiceId,
  chaseLock,
}: {
  invoiceId: string;
  /** Non-null when Resume must be gated; the string is the visible reason. */
  chaseLock: string | null;
}) {
  const { data: state } = trpc.chase.state.useQuery({ invoiceId });
  const { data: events } = trpc.chase.events.useQuery({ invoiceId });
  const pause = trpc.chase.pause.useMutation({
    onSuccess: () => {
      utils.chase.state.invalidate({ invoiceId });
    },
  });
  const resume = trpc.chase.resume.useMutation({
    onSuccess: () => {
      utils.chase.state.invalidate({ invoiceId });
    },
  });
  const utils = trpc.useUtils();

  return (
    <div className="mx-4 mb-4 rounded-lg border border-hairline bg-surface-subtle p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-ink-3" />
          <span className="text-[13px] font-semibold text-ink">
            Chase sequence
          </span>
          {state && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                state.mode === "armed" && "bg-pine-tint text-pine",
                state.mode === "paused" && "bg-amber-tint text-amber",
                state.mode === "completed" && "bg-ink-3/10 text-ink-3"
              )}
            >
              {state.mode}
            </span>
          )}
        </div>
        {state?.mode === "armed" && (
          <button
            onClick={() => pause.mutate({ invoiceId, reason: "Manual pause" })}
            className="flex h-6 items-center gap-1 rounded border border-hairline px-1.5 text-[11px] text-ink-3 hover:bg-surface"
          >
            <Pause className="h-3 w-3" />
            Pause
          </button>
        )}
        {state?.mode === "paused" && (
          <button
            onClick={() => resume.mutate({ invoiceId })}
            disabled={chaseLock !== null}
            aria-disabled={chaseLock !== null}
            className="flex h-6 items-center gap-1 rounded border border-hairline px-1.5 text-[11px] text-pine hover:bg-pine-tint disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Play className="h-3 w-3" />
            Resume
          </button>
        )}
      </div>

      {/* Pause is always available — it only ever de-escalates, and this panel
          is the product's only pause surface, so gating it could trap a
          creator in a running chase. Resume is the one control that can arm
          reminders nowhere would go, so it's the only thing gated here.

          Rendered whenever the lock applies, not only when the chase is
          paused: an armed chase on a never-sent invoice is exactly the state
          the creator most needs told about, and a static line beats a
          hover-only reveal (WCAG 2.4.7). */}
      {chaseLock && (
        <p className="mt-2 flex items-start gap-1 text-[11px] font-medium text-amber">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {chaseLock}
        </p>
      )}

      {events && events.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-center justify-between rounded-md border border-hairline bg-surface px-2.5 py-2"
            >
              <div>
                <p className="text-[11px] font-medium text-ink">
                  Step {ev.step}: {ev.subjectSnapshot || "Chase email"}
                </p>
                <p className="text-[10px] text-ink-3">
                  {ev.toEmail} · {ev.status}
                </p>
              </div>
              <span className="text-[10px] text-ink-3">
                {new Date(ev.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-3">
          No chase emails sent yet. Next step will trigger automatically when
          overdue.
        </p>
      )}
    </div>
  );
}
