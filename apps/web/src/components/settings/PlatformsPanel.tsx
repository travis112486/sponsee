import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/trpc";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { Link2, Loader2, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import { platforms, platformLabels, type Platform } from "@sponsee/shared";
import QueryError from "@/components/QueryError";
import { applyServerFieldErrors, serverErrorMessage } from "@/lib/trpc-error";

const platformSchema = z.object({
  platform: z.enum(platforms),
  ccv: z.coerce.number().int().min(0).optional(),
  followers: z.coerce.number().int().min(0).optional(),
  scheduleLabel: z.string().max(255).optional(),
  handle: z.string().max(255).optional(),
});

// Platforms with a public stats API (TikTok Live stays manual entry)
const SYNCABLE: ReadonlySet<string> = new Set(["twitch", "kick", "youtube"]);

// Platforms where a one-time OAuth connect unlocks broadcaster-gated data
// (true Twitch subscriber counts; Kick fallback if app-token counts are gated)
const CONNECTABLE = ["twitch", "kick"] as const;
type ConnectablePlatform = (typeof CONNECTABLE)[number];

type PlatformForm = z.infer<typeof platformSchema>;

/** Fields whose errors this form renders inline; the rest fall back to a toast. */
const INLINE_ERROR_FIELDS = ["platform"] as const;

export default function PlatformsPanel() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.settings.getPlatforms.useQuery();
  // Hides Connect buttons for providers without credentials provisioned, where
  // clicking could only fail with an opaque PROVIDER_NOT_FOUND.
  const { data: connectProviders } = trpc.settings.getConnectProviders.useQuery();
  const upsert = trpc.settings.upsertPlatform.useMutation({
    onSuccess: () => {
      toast.success("Platform saved");
      utils.settings.getPlatforms.invalidate();
      setEditingId(null);
      resetForm();
    },
    onError: (err) => {
      const { applied, unmapped } = applyServerFieldErrors(err, setError, INLINE_ERROR_FIELDS);
      if (applied === 0 || unmapped) {
        toast.error(serverErrorMessage(err, "Failed to save platform"));
      }
    },
  });
  const remove = trpc.settings.deletePlatform.useMutation({
    onSuccess: () => {
      toast.success("Platform removed");
      utils.settings.getPlatforms.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to remove platform"),
  });
  const sync = trpc.settings.syncPlatform.useMutation({
    onSuccess: ({ row, outcome }) => {
      if (outcome === "synced") {
        toast.success("Stats synced");
      } else if (outcome === "skipped") {
        // Nothing was attempted (e.g. credentials not provisioned yet) —
        // don't tell the creator a sync failed when none ran.
        toast.info("Platform sync isn't available yet — your stats are unchanged");
      } else {
        toast.error(row.syncError || "Sync failed — stats unchanged");
      }
      utils.settings.getPlatforms.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to sync"),
  });

  // The provider's original error text, stashed before a recovery-mode
  // completePlatformConnect fires so the mutation-level onError can replay it.
  const recoveryErrorToast = useRef<(() => void) | null>(null);
  const completeConnect = trpc.settings.completePlatformConnect.useMutation({
    onSuccess: ({ row, outcome }, variables) => {
      const label = platformLabels[variables.platform];
      if (outcome === "synced") {
        toast.success(`${label} connected — subscriber count synced`);
      } else if (outcome === "skipped") {
        toast.success(`${label} connected — stats will sync with the next daily run`);
      } else {
        toast.warning(
          `${label} connected, but the first sync failed: ${row.syncError || "unknown error"}`
        );
      }
      utils.settings.getPlatforms.invalidate();
    },
    // Mutation-level, not mutate()-level: TanStack Query drops mutate()
    // callbacks when the component unmounts before the mutation settles, which
    // would swallow the failure toast if the creator navigates off /settings
    // mid-flight (SPO-142).
    onError: (err, variables) => {
      if (variables.recovery) {
        // Recovery didn't find a fresh link — the connect really failed, so
        // show the provider's original error, not a generic one.
        recoveryErrorToast.current?.();
      } else {
        toast.error(serverErrorMessage(err, "Failed to finish connecting"));
      }
    },
  });
  const disconnect = trpc.settings.disconnectPlatform.useMutation({
    onSuccess: () => {
      toast.success("Platform disconnected");
      utils.settings.getPlatforms.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to disconnect"),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<ConnectablePlatform | null>(null);

  // Finish the OAuth round-trip: Better Auth redirected back with
  // ?connected=<platform> (or ?connect_error=<platform>&error=...). The ref
  // guards StrictMode's double-invoked effects from firing the mutation twice.
  const [searchParams, setSearchParams] = useSearchParams();
  const handledConnectReturn = useRef(false);
  useEffect(() => {
    if (handledConnectReturn.current) return;
    const connected = searchParams.get("connected");
    const connectError = searchParams.get("connect_error");
    if (!connected && !connectError) return;
    handledConnectReturn.current = true;

    if (connected === "twitch" || connected === "kick") {
      completeConnect.mutate({ platform: connected });
    } else if (connectError) {
      const detail = searchParams.get("error");
      const connectErrorToast = () =>
        toast.error(
          `Couldn't connect ${platformLabels[connectError as Platform] ?? connectError}${detail ? `: ${detail.replace(/_/g, " ")}` : ""}`
        );
      if ((connectError === "twitch" || connectError === "kick") && detail?.startsWith("state")) {
        // A replayed OAuth callback (proxy retry, browser prefetch) burns the
        // one-time state and redirects here with state_mismatch even though
        // the first hit already linked the account. The server knows whether
        // the link landed — ask it (in recovery mode, so only a fresh link
        // counts) before believing the error.
        recoveryErrorToast.current = connectErrorToast;
        completeConnect.mutate({ platform: connectError, recovery: true });
      } else {
        connectErrorToast();
      }
    }
    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("connect_error");
    next.delete("error");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startConnect = async (platform: ConnectablePlatform) => {
    setConnecting(platform);
    const callbackBase = `${window.location.origin}/settings`;
    const { data, error } = await authClient.linkSocial({
      provider: platform,
      callbackURL: `${callbackBase}?connected=${platform}`,
      errorCallbackURL: `${callbackBase}?connect_error=${platform}`,
    });
    if (error) {
      setConnecting(null);
      toast.error(error.message || `Couldn't start the ${platformLabels[platform]} connect flow`);
    } else if (data?.url) {
      window.location.assign(data.url);
    }
  };

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PlatformForm>({
    resolver: zodResolver(platformSchema),
    defaultValues: {
      platform: "twitch",
      ccv: undefined,
      followers: undefined,
      scheduleLabel: "",
      handle: "",
    },
  });

  const resetForm = () => {
    reset({ platform: "twitch", ccv: undefined, followers: undefined, scheduleLabel: "", handle: "" });
    setEditingId(null);
  };

  const startEdit = (p: {
    id: string;
    platform: string;
    ccv: number | null;
    followers: number | null;
    scheduleLabel: string | null;
    handle: string | null;
  }) => {
    setEditingId(p.id);
    reset({
      platform: p.platform as Platform,
      ccv: p.ccv ?? undefined,
      followers: p.followers ?? undefined,
      scheduleLabel: p.scheduleLabel ?? "",
      handle: p.handle ?? "",
    });
  };

  const onSubmit = (form: PlatformForm) => {
    const input: {
      id?: string;
      platform: Platform;
      ccv: number | null;
      followers: number | null;
      scheduleLabel: string | null;
      handle: string | null;
    } = {
      platform: form.platform,
      ccv: form.ccv ?? null,
      followers: form.followers ?? null,
      scheduleLabel: form.scheduleLabel || null,
      handle: form.handle?.trim() || null,
    };
    if (editingId) {
      input.id = editingId;
    }
    upsert.mutate(input);
  };

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ink-3" />
      </div>
    );
  }

  if (isError) {
    return (
      <QueryError
        message="Couldn't load your platforms."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Connect accounts (SPO-109): one-time OAuth unlocks broadcaster-gated stats */}
      <div className="rounded-lg border border-hairline bg-surface-subtle p-4">
        <h4 className="text-[13.5px] font-semibold text-ink">Connect accounts</h4>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Twitch doesn't publish subscriber counts — connect once and we'll pull your true subs
          (and keep your avatar and followers fresh) automatically.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {CONNECTABLE.map((platform) => {
            const row = data?.find((p) => p.platform === platform);
            const isConnected = Boolean(row?.connectedAccountId);
            // An existing connection stays visible (so Disconnect still works)
            // even if the provider's credentials disappear later.
            if (!isConnected && !connectProviders?.[platform]) return null;
            const isPending =
              connecting === platform ||
              (completeConnect.isPending && completeConnect.variables?.platform === platform);
            return (
              <div key={platform} className="flex items-center gap-2">
                {isConnected && row ? (
                  <>
                    <span className="flex items-center gap-1.5 rounded-full bg-pine/10 px-3 py-1 text-[12.5px] font-medium text-pine">
                      <Link2 className="h-3.5 w-3.5" />
                      {platformLabels[platform]} connected
                      {row.handle ? ` · @${row.handle}` : ""}
                    </span>
                    <button
                      onClick={() => disconnect.mutate({ id: row.id })}
                      disabled={disconnect.isPending && disconnect.variables?.id === row.id}
                      className="flex items-center gap-1 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-brick disabled:opacity-50"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => startConnect(platform)}
                    disabled={isPending}
                    className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-surface px-4 text-[13px] font-semibold text-ink transition-colors hover:border-pine hover:text-pine disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    Connect {platformLabels[platform]}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Existing platforms list */}
      <div className="space-y-3">
        {data?.length === 0 && (
          <p className="text-[13px] text-ink-3">No platforms added yet.</p>
        )}
        {data?.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-lg border border-hairline bg-surface px-4 py-3"
          >
            <div className="flex items-center gap-4">
              {p.avatarUrl && (
                <img
                  src={p.avatarUrl}
                  alt=""
                  className="h-8 w-8 rounded-full border border-hairline object-cover"
                />
              )}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-4">
                  <span className="text-[13.5px] font-semibold capitalize text-ink">{p.platform}</span>
                  {p.handle && <span className="text-[12.5px] text-ink-3">@{p.handle}</span>}
                  {p.ccv != null && (
                    <span className="text-[12.5px] text-ink-3">CCV: {p.ccv.toLocaleString()}</span>
                  )}
                  {p.subscriberCount != null && (
                    <span className="text-[12.5px] text-ink-3">
                      Subs: {p.subscriberCountIsEstimate ? "~" : ""}
                      {p.subscriberCount.toLocaleString()}
                    </span>
                  )}
                  {p.followers != null && (
                    <span className="text-[12.5px] text-ink-3">
                      Followers: {p.followers.toLocaleString()}
                    </span>
                  )}
                  {p.scheduleLabel && (
                    <span className="text-[12.5px] text-ink-3">{p.scheduleLabel}</span>
                  )}
                </div>
                {p.syncStatus === "ok" && p.lastSyncedAt && (
                  <span className="text-[11.5px] text-ink-3">
                    Last synced {new Date(p.lastSyncedAt).toLocaleString()}
                  </span>
                )}
                {p.syncStatus === "error" && (
                  <span className="text-[11.5px] text-brick">
                    Sync failed — showing last known values
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {SYNCABLE.has(p.platform) && (p.handle || p.connectedAccountId) && (
                <button
                  onClick={() => sync.mutate({ id: p.id })}
                  disabled={sync.isPending && sync.variables?.id === p.id}
                  className="flex items-center gap-1 text-[12.5px] font-medium text-pine hover:text-pine-hover disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${sync.isPending && sync.variables?.id === p.id ? "animate-spin" : ""}`}
                  />
                  Sync now
                </button>
              )}
              <button
                onClick={() => startEdit(p)}
                className="text-[12.5px] font-medium text-pine hover:text-pine-hover"
              >
                Edit
              </button>
              <button
                onClick={() => remove.mutate({ id: p.id })}
                disabled={remove.isPending}
                aria-label="Remove platform"
                className="rounded p-1 text-ink-3 transition-colors hover:text-brick"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add / edit form */}
      <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-hairline bg-surface-subtle p-4">
        <h4 className="mb-4 text-[13.5px] font-semibold text-ink">
          {editingId ? "Edit platform" : "Add platform"}
        </h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="platform" className="mb-1.5 block text-[12.5px] font-medium text-ink">Platform</label>
            <select
              id="platform"
              {...register("platform")}
              disabled={!!editingId}
              className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none focus:border-pine focus:ring-1 focus:ring-pine disabled:opacity-60"
            >
              {platforms.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
            {errors.platform && (
              <p className="mt-1 text-[12px] text-brick">{errors.platform.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="handle" className="mb-1.5 block text-[12.5px] font-medium text-ink">Channel handle</label>
            <input
              id="handle"
              {...register("handle")}
              placeholder="e.g. yourchannel"
              className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
            />
            <p className="mt-1 text-[11.5px] text-ink-3">
              Twitch/Kick/YouTube: we auto-fill subs, followers, and avatar daily. Leave blank to enter numbers manually.
            </p>
          </div>

          <div>
            <label htmlFor="ccv" className="mb-1.5 block text-[12.5px] font-medium text-ink">CCV (avg viewers)</label>
            <input
              id="ccv"
              type="number"
              min={0}
              {...register("ccv")}
              placeholder="0"
              className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
            />
          </div>

          <div>
            <label htmlFor="followers" className="mb-1.5 block text-[12.5px] font-medium text-ink">Followers</label>
            <input
              id="followers"
              type="number"
              min={0}
              {...register("followers")}
              placeholder="0"
              className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
            />
          </div>

          <div>
            <label htmlFor="scheduleLabel" className="mb-1.5 block text-[12.5px] font-medium text-ink">Schedule label</label>
            <input
              id="scheduleLabel"
              {...register("scheduleLabel")}
              placeholder="e.g. Mon/Wed/Fri 8pm ET"
              className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting || upsert.isPending}
            className="flex h-9 items-center gap-2 rounded-lg bg-pine px-4 text-[13px] font-semibold text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
          >
            {(isSubmitting || upsert.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editingId ? "Save changes" : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Add platform
              </>
            )}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="h-9 rounded-lg border border-hairline px-4 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
