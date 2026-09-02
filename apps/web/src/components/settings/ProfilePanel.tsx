import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import QueryError from "@/components/QueryError";
import { httpsUrlOrEmpty } from "@/lib/url-schema";
import { applyServerFieldErrors, serverErrorMessage } from "@/lib/trpc-error";
import { isValidTimeZone, listTimeZones, TIME_ZONE_ERROR_MESSAGE } from "@sponsee/shared";

/**
 * The picker's options, straight from this browser's ICU. Same source of truth
 * the router validates against, so nothing offered here can be rejected on
 * save (SPO-246).
 */
const TIME_ZONES = listTimeZones();

const profileSchema = z.object({
  displayName: z.string().min(1, "Display name is required").max(255),
  pronouns: z.string().max(64).optional(),
  category: z.string().max(128).optional(),
  avatarUrl: httpsUrlOrEmpty.optional(),
  timezone: z.string().max(64).refine(isValidTimeZone, TIME_ZONE_ERROR_MESSAGE).optional(),
  defaultCurrency: z.string().length(3).optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

/**
 * Fields whose errors this form actually renders. A server complaint about any
 * other field has nowhere to go inline, so it falls back to the toast rather
 * than being set and never shown.
 */
const INLINE_ERROR_FIELDS = ["displayName", "avatarUrl", "timezone"] as const;

export default function ProfilePanel() {
  const utils = trpc.useUtils();
  const { data: profile, isLoading, isError, refetch } = trpc.settings.getProfile.useQuery();
  const update = trpc.settings.updateProfile.useMutation({
    onSuccess: () => {
      toast.success("Profile saved");
      utils.settings.getProfile.invalidate();
    },
    onError: (err) => {
      // Server-side validation the client schema let through lands under the
      // offending input; anything the form can't show still needs a toast.
      const { applied, unmapped } = applyServerFieldErrors(err, setError, INLINE_ERROR_FIELDS);
      if (applied === 0 || unmapped) {
        toast.error(serverErrorMessage(err, "Failed to save profile"));
      }
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: "",
      pronouns: "",
      category: "",
      avatarUrl: "",
      timezone: "America/New_York",
      defaultCurrency: "USD",
    },
  });

  useEffect(() => {
    if (profile) {
      reset({
        displayName: profile.displayName,
        pronouns: profile.pronouns ?? "",
        category: profile.category ?? "",
        avatarUrl: profile.avatarUrl ?? "",
        timezone: profile.timezone,
        defaultCurrency: profile.defaultCurrency,
      });
    }
  }, [profile, reset]);

  const savedTimezone = profile?.timezone ?? "";
  const savedTimezoneIsUnusable = savedTimezone !== "" && !isValidTimeZone(savedTimezone);

  /**
   * A saved zone that isn't in this browser's list still has to appear as an
   * option — otherwise the `<select>` falls back to its first entry and the
   * next save silently rewrites the creator's timezone. That covers both a
   * legacy unusable row and a link name (`US/Eastern`, `Asia/Kolkata`) that
   * this ICU build doesn't consider canonical.
   */
  const timezoneOptions = useMemo(
    () =>
      savedTimezone === "" || TIME_ZONES.includes(savedTimezone)
        ? TIME_ZONES
        : [savedTimezone, ...TIME_ZONES],
    [savedTimezone]
  );

  const onSubmit = (data: ProfileForm) => {
    update.mutate({
      displayName: data.displayName,
      pronouns: data.pronouns || null,
      category: data.category || null,
      avatarUrl: data.avatarUrl || null,
      timezone: data.timezone,
      defaultCurrency: data.defaultCurrency,
    });
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
        message="Couldn't load your profile."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="displayName" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Display name
          </label>
          <input
            id="displayName"
            {...register("displayName")}
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
          />
          {errors.displayName && (
            <p className="mt-1 text-[12px] text-brick">{errors.displayName.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="pronouns" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Pronouns
          </label>
          <input
            id="pronouns"
            {...register("pronouns")}
            placeholder="e.g. they/them"
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
          />
        </div>

        <div>
          <label htmlFor="category" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Category / niche
          </label>
          <input
            id="category"
            {...register("category")}
            placeholder="e.g. Gaming / Variety"
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
          />
        </div>

        <div>
          <label htmlFor="avatarUrl" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Avatar URL
          </label>
          <input
            id="avatarUrl"
            {...register("avatarUrl")}
            placeholder="https://..."
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
          />
          {errors.avatarUrl && (
            <p className="mt-1 text-[12px] text-brick">{errors.avatarUrl.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="timezone" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Timezone
          </label>
          <select
            id="timezone"
            {...register("timezone")}
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors focus:border-pine focus:ring-1 focus:ring-pine"
          >
            {timezoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone === savedTimezone && savedTimezoneIsUnusable
                  ? `${zone} — not a valid timezone`
                  : zone}
              </option>
            ))}
          </select>
          {savedTimezoneIsUnusable ? (
            <p className="mt-1 text-[12px] text-brick">
              Your saved timezone isn&apos;t one your dashboard can use, so revenue months are
              being counted in UTC. Pick a region/city timezone to fix it.
            </p>
          ) : null}
          {errors.timezone && (
            <p className="mt-1 text-[12px] text-brick">{errors.timezone.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="defaultCurrency" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Default currency
          </label>
          <select
            id="defaultCurrency"
            {...register("defaultCurrency")}
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors focus:border-pine focus:ring-1 focus:ring-pine"
          >
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British Pound</option>
            <option value="CAD">CAD — Canadian Dollar</option>
            <option value="AUD">AUD — Australian Dollar</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={!isDirty || isSubmitting || update.isPending}
          className="flex h-9 items-center gap-2 rounded-lg bg-pine px-4 text-[13px] font-semibold text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
        >
          {(isSubmitting || update.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save profile
        </button>
        {isDirty && (
          <span className="text-[12.5px] text-ink-3">Unsaved changes</span>
        )}
      </div>
    </form>
  );
}
