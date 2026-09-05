/**
 * High-fidelity recreations of the real dashboard for the landing page.
 *
 * These are the product screenshots — built in HTML/CSS instead of images so
 * they stay pixel-true to the token set, render crisply at every DPI, and
 * pre-render as real crawlable text (SPO-209). Every recipe here (card shell,
 * eyebrow, stat figure, status chip) is copied from the shipped dashboard so
 * the landing page shows the product people actually get.
 */

const platformDot: Record<string, string> = {
  twitch: "bg-twitch",
  youtube: "bg-youtube",
  kick: "bg-kick",
  tiktok: "bg-tiktok",
};

export function BrowserFrame({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-warm-lg">
      <div className="flex items-center gap-2 border-b border-hairline bg-surface-subtle px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink/15" />
          <span className="h-2 w-2 rounded-full bg-ink/15" />
          <span className="h-2 w-2 rounded-full bg-ink/15" />
        </div>
        {label && (
          <span className="ml-2 rounded-md bg-surface px-2 py-0.5 text-[11px] tracking-normal text-ink-3 border border-hairline">
            {label}
          </span>
        )}
      </div>
      <div className="p-3 md:p-4">{children}</div>
    </div>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "accent" | "amber" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  const tones = {
    accent: "bg-pine-tint text-pine",
    amber: "bg-amber-tint text-amber",
    danger: "bg-brick-tint text-brick",
    neutral: "bg-ink/[.06] text-ink-2",
  };
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function StatMini({
  label,
  figure,
  chip,
  chipTone,
  context,
}: {
  label: string;
  figure: string;
  chip?: string;
  chipTone?: "accent" | "amber" | "danger" | "neutral";
  context: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-hairline bg-surface p-3 shadow-warm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {label}
      </span>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="tnum text-[19px] font-semibold tracking-[-0.02em] text-ink">
          {figure}
        </span>
        {chip && <Chip tone={chipTone ?? "neutral"}>{chip}</Chip>}
      </div>
      <span className="mt-1 text-[10px] leading-4 text-ink-3">{context}</span>
    </div>
  );
}

function DealCard({
  brand,
  amount,
  platform,
  meta,
  metaTone = "neutral",
  compact = false,
}: {
  brand: string;
  amount: string;
  platform: keyof typeof platformDot;
  meta?: string;
  metaTone?: "accent" | "amber" | "danger" | "neutral";
  /** Dot + value only — for boards whose columns are too narrow for any name. */
  compact?: boolean;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-2.5 shadow-warm">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${platformDot[platform]}`} />
          {!compact && (
            <span className="truncate text-[11px] font-medium text-ink">{brand}</span>
          )}
        </span>
        <span className="tnum shrink-0 text-[11px] font-semibold text-ink">{amount}</span>
      </div>
      {meta && (
        <div className="mt-1.5">
          <Chip tone={metaTone}>{meta}</Chip>
        </div>
      )}
    </div>
  );
}

/** The hero shot: stat row + pipeline board, the dashboard's opening view. */
export function HeroDashboard() {
  return (
    <BrowserFrame label="app.sponsee.app/dashboard">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          <StatMini
            label="Pipeline value"
            figure="$9,200"
            chip="+18%"
            chipTone="accent"
            context="7 open deals"
          />
          <StatMini
            label="Outstanding"
            figure="$3,150"
            chip="2 overdue"
            chipTone="amber"
            context="chase running on both"
          />
          <StatMini
            label="Paid this month"
            figure="$4,820"
            chip="+12%"
            chipTone="accent"
            context="vs. August"
          />
        </div>
        <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
          {(
            [
              {
                stage: "Inbound",
                total: "$1,450",
                deals: [
                  { brand: "Quillfrost", amount: "$650", platform: "twitch", meta: "new" },
                  { brand: "CometEnergy", amount: "$800", platform: "kick" },
                ],
              },
              {
                stage: "Negotiating",
                total: "$3,200",
                deals: [
                  { brand: "Basalt VPN", amount: "$2,400", platform: "twitch", meta: "6d in stage", metaTone: "amber" },
                  { brand: "MealCrate", amount: "$800", platform: "youtube" },
                ],
              },
              {
                stage: "Contract Sent",
                total: "$1,900",
                deals: [
                  { brand: "Gridgear", amount: "$1,900", platform: "youtube", meta: "signed?", metaTone: "neutral" },
                ],
              },
              {
                stage: "Live",
                total: "$2,650",
                deals: [
                  { brand: "Emberfizz", amount: "$1,450", platform: "twitch", meta: "live", metaTone: "accent" },
                  { brand: "DriftEnergy", amount: "$1,200", platform: "tiktok" },
                ],
              },
            ] as const
          ).map((col) => (
            <div key={col.stage} className="rounded-lg border border-hairline bg-surface-subtle p-2">
              <div className="flex items-baseline justify-between gap-1 px-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  {col.stage}
                </span>
                <span className="tnum text-[10px] text-ink-3">{col.total}</span>
              </div>
              <div className="mt-1.5 space-y-1.5">
                {col.deals.map((d) => (
                  <DealCard key={d.brand} {...d} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

/**
 * Pillar 1 — the six-stage pipeline board.
 *
 * Six columns leave ~60px of card width, too narrow for any brand name, so
 * cards here are deliberately dot + value only (SPO-403) — never a name
 * crushed to one letter. Stage labels get the full column width on their own
 * line, with count · total beneath ("every column shows count and total
 * value"). "Contract" stands in for "Contract Sent" to fit.
 */
export function PipelineBoard() {
  const cols = [
    { stage: "Inbound", count: "2", total: "$1,450", deals: [{ brand: "CometEnergy", amount: "$800", platform: "kick" as const }] },
    { stage: "Negotiating", count: "2", total: "$3,200", deals: [{ brand: "Basalt VPN", amount: "$2,400", platform: "twitch" as const, meta: "6d", metaTone: "amber" as const }] },
    { stage: "Contract", count: "1", total: "$1,900", deals: [{ brand: "Gridgear", amount: "$1,900", platform: "youtube" as const }] },
    { stage: "Live", count: "2", total: "$2,650", deals: [{ brand: "Emberfizz", amount: "$1,450", platform: "twitch" as const, meta: "live", metaTone: "accent" as const }] },
    { stage: "Delivered", count: "1", total: "$850", deals: [{ brand: "MealCrate", amount: "$850", platform: "youtube" as const }] },
    { stage: "Paid", count: "3", total: "$4,820", deals: [{ brand: "DriftEnergy", amount: "$1,200", platform: "tiktok" as const, meta: "paid", metaTone: "accent" as const }] },
  ];
  return (
    <BrowserFrame label="app.sponsee.app/pipeline">
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {cols.map((col) => (
          <div key={col.stage} className="rounded-lg border border-hairline bg-surface-subtle p-2">
            <div className="px-0.5">
              <div className="truncate text-[9px] font-semibold uppercase tracking-[0.04em] text-ink-3">
                {col.stage}
              </div>
              <div className="tnum mt-0.5 whitespace-nowrap text-[9px] text-ink-3">
                {col.count} · {col.total}
              </div>
            </div>
            <div className="mt-1.5 space-y-1.5">
              {col.deals.map((d) => (
                <DealCard key={d.brand} {...d} compact />
              ))}
            </div>
          </div>
        ))}
      </div>
    </BrowserFrame>
  );
}

/** Pillar 2 — the CPVH rate calculator. */
export function CalculatorMock() {
  return (
    <BrowserFrame label="app.sponsee.app/calculator">
      <div className="grid gap-3 md:grid-cols-5">
        <div className="space-y-2.5 md:col-span-2">
          {[
            { label: "Avg. concurrent viewers", value: "1,200" },
            { label: "Sponsored hours", value: "3" },
            { label: "Deliverables", value: "Ad reads ×2 · overlay" },
          ].map((f) => (
            <div key={f.label}>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                {f.label}
              </span>
              <div className="tnum mt-1 rounded-lg border border-hairline bg-surface px-3 py-2 text-[12px] font-medium text-ink">
                {f.value}
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-hairline bg-surface-subtle p-3 md:col-span-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            Your rate range
          </span>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { band: "Floor", amount: "$2,160", hot: false },
              { band: "Mid", amount: "$3,600", hot: true },
              { band: "High", amount: "$5,400", hot: false },
            ].map((t) => (
              <div
                key={t.band}
                className={`rounded-lg border p-2.5 text-center ${
                  t.hot ? "border-pine bg-pine-tint" : "border-hairline bg-surface"
                }`}
              >
                <div className={`text-[10px] font-medium ${t.hot ? "text-pine" : "text-ink-3"}`}>
                  {t.band}
                </div>
                <div className={`tnum text-[15px] font-semibold ${t.hot ? "text-pine" : "text-ink"}`}>
                  {t.amount}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <div className="relative h-1.5 rounded-full bg-hairline">
              {/* Track is $0–$2.00/vh: band $0.60–$1.50 → 30%–75%, marker at the $1.00 mid → 50% */}
              <div className="absolute left-[30%] right-[25%] h-1.5 rounded-full bg-pine/30" />
              <div className="absolute left-[50%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-pine shadow-warm" />
            </div>
            <p className="tnum mt-2 text-[10px] text-ink-3">
              Benchmark: $0.60–$1.50 per viewer-hour for live sponsorships
            </p>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/** Pillar 3 — payments aging + the chase ladder. */
export function PaymentsMock() {
  return (
    <BrowserFrame label="app.sponsee.app/payments">
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
          {[
            // Buckets total $3,150 — the hero dashboard's Outstanding figure,
            // with its "2 overdue" split across the two aged buckets.
            { bucket: "Current", amount: "$1,200", tone: "text-ink" },
            { bucket: "1–30 days", amount: "$1,350", tone: "text-amber" },
            { bucket: "31–60 days", amount: "$600", tone: "text-brick" },
            { bucket: "60+ days", amount: "$0", tone: "text-ink-3" },
          ].map((b) => (
            <div key={b.bucket} className="rounded-lg border border-hairline bg-surface-subtle p-2.5 text-center">
              <div className="text-[10px] font-medium text-ink-3">{b.bucket}</div>
              <div className={`tnum mt-0.5 text-[14px] font-semibold ${b.tone}`}>{b.amount}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-hairline bg-surface p-3 shadow-warm">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-twitch" />
              <span className="text-[11px] font-medium text-ink">Basalt VPN · INV-014</span>
            </span>
            <Chip tone="amber">12 days overdue</Chip>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-pine" />
              <span className="h-2 w-2 rounded-full bg-pine" />
              <span className="h-2 w-2 rounded-full border border-hairline bg-surface-subtle" />
            </div>
            <span className="text-[11px] text-ink-2">Reminder 2 of 3 — friendly nudge sent, professional reminder queued</span>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg bg-surface-subtle px-2.5 py-2">
            <span className="text-[11px] text-ink-2">“Following up on invoice INV-014…”</span>
            <span className="inline-flex h-6 items-center rounded-md bg-pine px-2.5 text-[10px] font-semibold text-white">
              Approve &amp; send
            </span>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
