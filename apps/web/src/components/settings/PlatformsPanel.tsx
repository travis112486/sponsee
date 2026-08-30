import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/trpc";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { platforms, type Platform } from "@sponsee/shared";
import QueryError from "@/components/QueryError";
import { applyServerFieldErrors, serverErrorMessage } from "@/lib/trpc-error";

const platformSchema = z.object({
  platform: z.enum(platforms),
  ccv: z.coerce.number().int().min(0).optional(),
  followers: z.coerce.number().int().min(0).optional(),
  scheduleLabel: z.string().max(255).optional(),
});

type PlatformForm = z.infer<typeof platformSchema>;

/** Fields whose errors this form renders inline; the rest fall back to a toast. */
const INLINE_ERROR_FIELDS = ["platform"] as const;

export default function PlatformsPanel() {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.settings.getPlatforms.useQuery();
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

  const [editingId, setEditingId] = useState<string | null>(null);

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
    },
  });

  const resetForm = () => {
    reset({ platform: "twitch", ccv: undefined, followers: undefined, scheduleLabel: "" });
    setEditingId(null);
  };

  const startEdit = (p: {
    id: string;
    platform: string;
    ccv: number | null;
    followers: number | null;
    scheduleLabel: string | null;
  }) => {
    setEditingId(p.id);
    reset({
      platform: p.platform as Platform,
      ccv: p.ccv ?? undefined,
      followers: p.followers ?? undefined,
      scheduleLabel: p.scheduleLabel ?? "",
    });
  };

  const onSubmit = (form: PlatformForm) => {
    const input: {
      id?: string;
      platform: Platform;
      ccv: number | null;
      followers: number | null;
      scheduleLabel: string | null;
    } = {
      platform: form.platform,
      ccv: form.ccv ?? null,
      followers: form.followers ?? null,
      scheduleLabel: form.scheduleLabel || null,
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
              <span className="text-[13.5px] font-semibold capitalize text-ink">{p.platform}</span>
              {p.ccv != null && (
                <span className="text-[12.5px] text-ink-3">CCV: {p.ccv.toLocaleString()}</span>
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
            <div className="flex items-center gap-2">
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
              className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none focus:border-pine focus:ring-1 focus:ring-pine"
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
