import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bookmark, Copy, HelpCircle, Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  benchmarkDeliverableTypes,
  impliedCpvh,
  platforms as allPlatforms,
  type BenchmarkDeliverableType,
  type Platform,
} from "@sponsee/shared";
import { trpc } from "@/trpc";
import { cn } from "@/lib/utils";
import { BenchmarkBand, bandPlacement } from "@/components/BenchmarkBand";
import QueryError from "@/components/QueryError";
import { Skeleton } from "@/components/Skeleton";

/**
 * Rate Calculator (SPO-53).
 *
 * All pricing comes from `calculator.compute` (shared WS3 logic, benchmark
 * config loaded from the DB) — this screen adds no pricing math of its own, so
 * it can never disagree with the CPVH widget on the deal form.
 */

const CCV_MIN = 50;
const CCV_MAX = 5000;
const HOURS_MIN = 0.5;
const HOURS_MAX = 8;

const deliverableLabels: Record<BenchmarkDeliverableType, string> = {
  "ad-read": "Ad read",
  segment: "Sponsored segment",
  vod: "Dedicated VOD",
};

const platformLabels: Record<Platform, string> = {
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  tiktok: "TikTok",
};

interface Scenario {
  id: string;
  name: string;
  priceCents: number;
  ccv: number;
  hours: number;
  deliverableType: BenchmarkDeliverableType;
}

/** Shape persisted in `calculator_profiles.inputs` (jsonb). */
interface SavedProfile {
  ccv?: number;
  hours?: number;
  deliverableType?: BenchmarkDeliverableType;
  platforms?: Platform[];
  scenarios?: Scenario[];
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatHours(hours: number) {
  return hours % 1 === 0 ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function isDeliverableType(value: unknown): value is BenchmarkDeliverableType {
  return (
    typeof value === "string" &&
    (benchmarkDeliverableTypes as readonly string[]).includes(value)
  );
}

function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (allPlatforms as readonly string[]).includes(value);
}

/** Clamp a possibly-untrusted persisted number back into the control's range. */
function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

interface ResolvedProfile {
  ccv: number;
  hours: number;
  deliverableType: BenchmarkDeliverableType;
  platforms: Platform[];
  scenarios: Scenario[];
}

/**
 * Normalise the persisted jsonb blob into usable inputs. Anything missing,
 * malformed or out of range falls back to the control's default rather than
 * being fed to the pricing endpoint.
 */
function parseProfile(raw: unknown): ResolvedProfile {
  const saved = (raw ?? {}) as SavedProfile;
  return {
    ccv: clamp(saved.ccv, CCV_MIN, CCV_MAX, 500),
    hours: clamp(saved.hours, HOURS_MIN, HOURS_MAX, 2),
    deliverableType: isDeliverableType(saved.deliverableType)
      ? saved.deliverableType
      : "ad-read",
    platforms: Array.isArray(saved.platforms) ? saved.platforms.filter(isPlatform) : [],
    scenarios: Array.isArray(saved.scenarios) ? saved.scenarios : [],
  };
}

/* ------------------------------- CPVH explainer ------------------------------ */

function CpvhModal({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog on open and hand it back to the invoking button
  // when it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Escape closes; Tab is trapped inside the dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const panels = [
    {
      n: "1",
      title: "Viewer-hours = CCV × hours",
      body: "One concurrent viewer watching one sponsored hour is one viewer-hour — the unit sponsors actually buy.",
    },
    {
      n: "2",
      title: "A rate band, not a single price",
      body: "Sponsee keeps a versioned CPVH benchmark. Floor is the walk-away number, midpoint is the fair ask, agency is what brand-agency buyers pay.",
    },
    {
      n: "3",
      title: "Price = viewer-hours × rate",
      body: "Multiply expected viewer-hours by a rate in the band, then adjust for the deliverable type. Aim for the midpoint unless the buyer is agency-run.",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[12vh]"
      style={{ backgroundColor: "rgba(27,24,21,.4)" }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cpvh-modal-title"
        className="w-full max-w-[560px] rounded-[10px] border border-hairline bg-surface p-6 shadow-warm-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="cpvh-modal-title"
            className="text-[18px] font-semibold tracking-[-0.02em] text-ink"
          >
            How CPVH works
          </h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-3 transition-colors hover:bg-surface-subtle hover:text-ink"
          >
            <Plus className="h-4 w-4 rotate-45" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {panels.map((p) => (
            <div
              key={p.n}
              className="flex gap-3 rounded-[10px] border border-hairline bg-surface-subtle p-4"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pine font-mono text-[12px] font-semibold text-white">
                {p.n}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-ink">{p.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-5 text-ink-2">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- control group ------------------------------- */

function ControlGroup({
  label,
  readout,
  children,
}: {
  label: string;
  readout?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-hairline pb-5 last:border-0 last:pb-0">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {label}
        </span>
        {readout && (
          <span className="font-mono text-[12px] font-medium text-ink">{readout}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------ page ----------------------------------- */

export default function Calculator() {
  const [quoteOverride, setQuoteOverride] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const profileQuery = trpc.calculator.profile.get.useQuery();
  const platformsQuery = trpc.settings.getPlatforms.useQuery();
  const dealsQuery = trpc.deals.list.useQuery();
  const saveProfile = trpc.calculator.profile.save.useMutation();

  // Inputs are *derived* from the saved profile rather than synced into state by
  // an effect: each control falls back to the persisted value until the creator
  // edits it in this session.
  const saved = useMemo(
    () => parseProfile(profileQuery.data?.inputs),
    [profileQuery.data]
  );
  const [draft, setDraft] = useState<Partial<ResolvedProfile>>({});

  const ccv = draft.ccv ?? saved.ccv;
  const hours = draft.hours ?? saved.hours;
  const deliverableType = draft.deliverableType ?? saved.deliverableType;
  const selectedPlatforms = draft.platforms ?? saved.platforms;
  const scenarios = draft.scenarios ?? saved.scenarios;

  const setCcv = (value: number) => setDraft((d) => ({ ...d, ccv: value }));
  const setHours = (value: number) => setDraft((d) => ({ ...d, hours: value }));

  const durationMinutes = Math.round(hours * 60);
  const viewerHours = Math.round((ccv * durationMinutes) / 60);

  const computeQuery = trpc.calculator.compute.useQuery({
    ccv: Math.round(ccv),
    durationMinutes,
    deliverableType,
    platforms: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
  });

  const benchmark = computeQuery.data;
  const quoteCents = quoteOverride ?? benchmark?.mid ?? 0;
  const quoteCpvh = impliedCpvh(quoteCents, ccv, durationMinutes);

  // Quick-set CCV chips built from the creator's real connected platforms —
  // no mock audience numbers.
  const quickSets = useMemo(() => {
    const rows = (platformsQuery.data ?? []).filter(
      (p): p is typeof p & { ccv: number } => typeof p.ccv === "number" && p.ccv > 0
    );
    const sets = rows.map((p) => ({
      label: `${platformLabels[p.platform as Platform] ?? p.platform} ${p.ccv.toLocaleString("en-US")}`,
      value: p.ccv,
    }));
    if (rows.length > 1) {
      const combined = rows.reduce((sum, p) => sum + p.ccv, 0);
      sets.push({
        label: `All platforms ${combined.toLocaleString("en-US")}`,
        value: combined,
      });
    }
    return sets.filter((s) => s.value >= CCV_MIN && s.value <= CCV_MAX);
  }, [platformsQuery.data]);

  function persist(next: Partial<SavedProfile>) {
    saveProfile.mutate({
      inputs: {
        ccv,
        hours,
        deliverableType,
        platforms: selectedPlatforms,
        scenarios,
        ...next,
      } as Record<string, unknown>,
    });
  }

  function togglePlatform(platform: Platform) {
    const next = selectedPlatforms.includes(platform)
      ? selectedPlatforms.filter((p) => p !== platform)
      : [...selectedPlatforms, platform];
    setDraft((d) => ({ ...d, platforms: next }));
  }

  const quoteText = benchmark
    ? `${deliverableLabels[deliverableType]} (${formatHours(hours)}) — ${formatCents(
        quoteCents
      )} flat · CPVH $${quoteCpvh.toFixed(2)} · ${viewerHours.toLocaleString("en-US")} viewer-hours`
    : "";

  async function handleUseQuote() {
    try {
      await navigator.clipboard.writeText(quoteText);
      toast.success("Copied to clipboard — paste it into your rate card");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  function handleSaveScenario() {
    const scenario: Scenario = {
      id: `${Date.now()}-${scenarios.length}`,
      name: `${deliverableLabels[deliverableType]} · ${ccv.toLocaleString("en-US")} CCV · ${formatHours(hours)}`,
      priceCents: quoteCents,
      ccv,
      hours,
      deliverableType,
    };
    const next = [...scenarios, scenario];
    setDraft((d) => ({ ...d, scenarios: next }));
    persist({ scenarios: next });
    toast.success("Scenario saved");
  }

  function handleDeleteScenario(id: string) {
    const next = scenarios.filter((s) => s.id !== id);
    setDraft((d) => ({ ...d, scenarios: next }));
    persist({ scenarios: next });
  }

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Rate Calculator
          </h2>
          <p className="mt-1 text-[13px] text-ink-2">
            Price sponsored airtime from your real audience numbers, using the same CPVH
            benchmark the deal form uses.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-2 transition-all duration-[120ms] hover:bg-surface-subtle hover:text-ink active:scale-[0.97]"
        >
          <HelpCircle className="h-4 w-4" /> How CPVH works
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Inputs */}
        <div className="rounded-[10px] border border-hairline bg-surface p-6 shadow-warm lg:col-span-5">
          <div className="space-y-5">
            <ControlGroup
              label="Average concurrent viewers (CCV)"
              readout={ccv.toLocaleString("en-US")}
            >
              <input
                type="range"
                min={CCV_MIN}
                max={CCV_MAX}
                step={10}
                value={ccv}
                onChange={(e) => setCcv(Number(e.target.value))}
                onBlur={() => persist({})}
                aria-label="Average concurrent viewers"
                aria-valuetext={`${ccv.toLocaleString("en-US")} concurrent viewers`}
                className="w-full accent-pine"
              />
              {platformsQuery.isLoading ? (
                <Skeleton className="mt-3 h-6 w-2/3" />
              ) : quickSets.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {quickSets.map((q) => (
                    <button
                      key={q.label}
                      onClick={() => {
                        setCcv(q.value);
                        persist({ ccv: q.value });
                      }}
                      aria-pressed={ccv === q.value}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150",
                        ccv === q.value
                          ? "border-pine bg-pine-tint text-pine"
                          : "border-hairline bg-surface-subtle text-ink-2 hover:text-ink"
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[11.5px] leading-4 text-ink-3">
                  Add your channels in Settings to get one-tap CCV presets from your real
                  audience.
                </p>
              )}
            </ControlGroup>

            <ControlGroup
              label="Sponsored hours"
              readout={`${formatHours(hours)} of sponsored airtime`}
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center rounded-lg border border-hairline">
                  <button
                    onClick={() => setHours(Math.max(HOURS_MIN, hours - 0.5))}
                    className="flex h-7 w-7 items-center justify-center text-ink-2 transition-colors hover:text-ink"
                    aria-label="Decrease sponsored hours"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-10 text-center font-mono text-[12px] font-medium text-ink">
                    {formatHours(hours)}
                  </span>
                  <button
                    onClick={() => setHours(Math.min(HOURS_MAX, hours + 0.5))}
                    className="flex h-7 w-7 items-center justify-center text-ink-2 transition-colors hover:text-ink"
                    aria-label="Increase sponsored hours"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  type="range"
                  min={HOURS_MIN}
                  max={HOURS_MAX}
                  step={0.5}
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                  onBlur={() => persist({})}
                  aria-label="Sponsored hours"
                  aria-valuetext={`${formatHours(hours)} of sponsored airtime`}
                  className="flex-1 accent-pine"
                />
              </div>
            </ControlGroup>

            <ControlGroup label="Platforms in this activation">
              <div className="flex flex-wrap gap-2">
                {allPlatforms.map((platform) => (
                  <label
                    key={platform}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                      selectedPlatforms.includes(platform)
                        ? "border-pine bg-pine-tint text-pine"
                        : "border-hairline bg-surface-subtle text-ink-2 hover:text-ink"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(platform)}
                      onChange={() => togglePlatform(platform)}
                      onBlur={() => persist({})}
                      className="h-3.5 w-3.5 accent-pine"
                    />
                    {platformLabels[platform]}
                  </label>
                ))}
              </div>
              <p className="mt-2.5 text-[11.5px] leading-4 text-ink-3">
                Platform mix adjusts the benchmark rate. Leave all unchecked to price against
                the unadjusted band.
              </p>
            </ControlGroup>

            <ControlGroup label="Deliverable type">
              <fieldset>
                <legend className="sr-only">Deliverable type</legend>
                <div className="flex rounded-lg border border-hairline bg-surface-subtle p-0.5">
                  {benchmarkDeliverableTypes.map((t) => (
                    <label
                      key={t}
                      className={cn(
                        "flex flex-1 cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-center text-[12px] font-medium transition-all duration-150",
                        deliverableType === t
                          ? "bg-pine text-white shadow-warm"
                          : "text-ink-2 hover:text-ink"
                      )}
                    >
                      <input
                        type="radio"
                        name="deliverable-type"
                        value={t}
                        checked={deliverableType === t}
                        onChange={() => {
                          setDraft((d) => ({ ...d, deliverableType: t }));
                          persist({ deliverableType: t });
                        }}
                        className="sr-only"
                      />
                      {deliverableLabels[t]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </ControlGroup>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-6 lg:col-span-7">
          {computeQuery.isError ? (
            <div className="rounded-[10px] border border-hairline bg-surface p-6 shadow-warm">
              <QueryError
                message="Couldn't load benchmark pricing."
                onRetry={() => computeQuery.refetch()}
              />
            </div>
          ) : computeQuery.isLoading || !benchmark ? (
            <div className="rounded-[10px] bg-ink p-6 shadow-warm-md">
              <Skeleton className="h-3 w-48 bg-white/15" />
              <Skeleton className="mt-3 h-12 w-56 bg-white/15" />
              <Skeleton className="mt-3 h-3 w-64 bg-white/15" />
            </div>
          ) : (
            <div className="rounded-[10px] bg-ink p-6 text-white shadow-warm-md">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">
                Recommended price for this activation
              </p>
              <p
                role="status"
                aria-live="polite"
                className="mt-2 text-[48px] font-semibold leading-none text-white"
              >
                {formatCents(quoteCents)}
              </p>
              <p className="mt-2 text-[12.5px] text-white/60">
                CPVH ${quoteCpvh.toFixed(2)} · {viewerHours.toLocaleString("en-US")}{" "}
                viewer-hours ({ccv.toLocaleString("en-US")} CCV × {formatHours(hours)})
              </p>

              <div className="mt-5 grid grid-cols-3 divide-x divide-white/15 border-y border-white/15">
                {[
                  { label: "Floor", value: benchmark.floor },
                  { label: "Midpoint", value: benchmark.mid },
                  { label: "Agency high", value: benchmark.agency },
                ].map((col) => (
                  <div key={col.label} className="px-4 py-3 first:pl-0">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/50">
                      {col.label}
                    </p>
                    <p className="mt-1 font-mono text-[15px] font-medium text-white">
                      {formatCents(col.value)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <label
                  htmlFor="quote-amount"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60"
                >
                  Your quote
                </label>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/30 px-2.5 py-1.5">
                    <span className="text-[13px] text-white/60">$</span>
                    <input
                      id="quote-amount"
                      type="number"
                      min={0}
                      step={10}
                      value={Math.round(quoteCents / 100)}
                      onChange={(e) =>
                        setQuoteOverride(Math.max(0, Number(e.target.value)) * 100)
                      }
                      className="w-24 bg-transparent font-mono text-[13px] text-white outline-none"
                    />
                  </div>
                  {quoteOverride !== null && (
                    <button
                      onClick={() => setQuoteOverride(null)}
                      className="text-[12px] font-medium text-white/70 underline underline-offset-2 hover:text-white"
                    >
                      Reset to midpoint
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleUseQuote}
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-pine px-3.5 text-[13px] font-medium text-white transition-all duration-[120ms] hover:bg-pine-hover active:scale-[0.97]"
                >
                  <Copy className="h-3.5 w-3.5" /> Use as my quote
                </button>
                <button
                  onClick={handleSaveScenario}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-white/30 px-3.5 text-[13px] font-medium text-white transition-all duration-[120ms] hover:bg-white/10 active:scale-[0.97]"
                >
                  <Bookmark className="h-3.5 w-3.5" /> Save scenario
                </button>
              </div>

              {scenarios.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {scenarios.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80"
                    >
                      <span>
                        {s.name} · <span className="font-mono">{formatCents(s.priceCents)}</span>
                      </span>
                      <button
                        onClick={() => handleDeleteScenario(s.id)}
                        aria-label={`Delete scenario ${s.name}`}
                        className="text-white/60 transition-colors hover:text-white"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Where the quote sits vs the band */}
          {benchmark && (
            <div className="rounded-[10px] border border-hairline bg-surface p-6 shadow-warm">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                Where your quote sits vs the market
              </p>
              <BenchmarkBand
                benchmark={benchmark}
                dealValueCents={quoteCents}
                label="Your quote vs benchmark"
              />
            </div>
          )}

          {/* Past deals against this band */}
          <div className="rounded-[10px] border border-hairline bg-surface p-6 shadow-warm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              Your deals vs this band
            </p>
            <p className="mt-1 text-[12px] text-ink-3">
              How each existing deal's value compares to the band you just priced. Sponsee
              doesn't record per-deal viewer-hours, so this compares deal value, not each
              deal's own effective CPVH.
            </p>
            <PastDeals
              deals={dealsQuery.data}
              isLoading={dealsQuery.isLoading}
              isError={dealsQuery.isError}
              onRetry={() => dealsQuery.refetch()}
              benchmark={benchmark}
            />
          </div>
        </div>
      </div>

      {modalOpen && <CpvhModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}

/* ---------------------------------- past deals -------------------------------- */

type DealRow = {
  id: string;
  title: string;
  valueCents: number;
  brand?: { name: string } | null;
};

function PastDeals({
  deals,
  isLoading,
  isError,
  onRetry,
  benchmark,
}: {
  deals: DealRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  benchmark: { floor: number; mid: number; agency: number } | undefined;
}) {
  if (isError) {
    return <QueryError message="Couldn't load your deals." onRetry={onRetry} />;
  }

  if (isLoading) {
    return (
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  const rows = (deals ?? []).filter((d) => d.valueCents > 0);

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-[13px] text-ink-3">
        No priced deals yet — once you add deals with a value, they'll show up here against
        the benchmark.
      </p>
    );
  }

  return (
    <table className="mt-4 w-full">
      <caption className="sr-only">
        Your deals compared against the benchmark band for the activation you just priced
      </caption>
      <thead>
        <tr className="border-b border-hairline text-left">
          {["Deal", "Value", "vs band"].map((h) => (
            <th
              key={h}
              scope="col"
              className="pb-2 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-3 last:pr-0"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((deal) => {
          const placement = benchmark ? bandPlacement(deal.valueCents, benchmark) : null;
          return (
            <tr key={deal.id} className="border-b border-hairline last:border-0">
              <td className="py-2.5 pr-3 text-[13px] font-medium text-ink">
                {deal.brand?.name ? `${deal.brand.name} — ` : ""}
                {deal.title}
              </td>
              <td className="py-2.5 pr-3 font-mono text-[12.5px] text-ink">
                {formatCents(deal.valueCents)}
              </td>
              <td className="py-2.5">
                {placement ? (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10.5px] font-semibold leading-4 text-white",
                      placement.color
                    )}
                  >
                    {placement.label}
                  </span>
                ) : (
                  <span className="text-[12px] text-ink-3">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
