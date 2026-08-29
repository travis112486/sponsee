import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import QueryError from "@/components/QueryError";

const railsSchema = z.object({
  paypalLink: z.string().url().optional().or(z.literal("")),
  wiseText: z.string().optional(),
  bankText: z.string().optional(),
});

type RailsForm = z.infer<typeof railsSchema>;

export default function RailsPanel() {
  const utils = trpc.useUtils();
  const { data: rails, isLoading, isError, refetch } = trpc.settings.getRails.useQuery();
  const update = trpc.settings.updateRails.useMutation({
    onSuccess: () => {
      toast.success("Payout rails saved");
      utils.settings.getRails.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to save payout rails"),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<RailsForm>({
    resolver: zodResolver(railsSchema),
    defaultValues: {
      paypalLink: "",
      wiseText: "",
      bankText: "",
    },
  });

  useEffect(() => {
    if (rails) {
      reset({
        paypalLink: rails.paypalLink ?? "",
        wiseText: rails.wiseText ?? "",
        bankText: rails.bankText ?? "",
      });
    }
  }, [rails, reset]);

  const onSubmit = (data: RailsForm) => {
    update.mutate({
      paypalLink: data.paypalLink || null,
      wiseText: data.wiseText || null,
      bankText: data.bankText || null,
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
        message="Couldn't load your payout rails."
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <p className="text-[13px] text-ink-3">
        These are template fields shown on invoices — never payment credentials.
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor="paypalLink" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            PayPal link
          </label>
          <input
            id="paypalLink"
            {...register("paypalLink")}
            placeholder="https://paypal.me/yourname"
            className="h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
          />
          {errors.paypalLink && (
            <p className="mt-1 text-[12px] text-brick">{errors.paypalLink.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="wiseText" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Wise details
          </label>
          <textarea
            id="wiseText"
            {...register("wiseText")}
            rows={3}
            placeholder="e.g. Wise account: example@email.com"
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
          />
        </div>

        <div>
          <label htmlFor="bankText" className="mb-1.5 block text-[12.5px] font-medium text-ink">
            Bank transfer details
          </label>
          <textarea
            id="bankText"
            {...register("bankText")}
            rows={3}
            placeholder="e.g. Routing: 123456789 / Account: 987654321"
            className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-pine focus:ring-1 focus:ring-pine"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={!isDirty || isSubmitting || update.isPending}
          className="flex h-9 items-center gap-2 rounded-lg bg-pine px-4 text-[13px] font-semibold text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
        >
          {(isSubmitting || update.isPending) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save payout rails
        </button>
        {isDirty && (
          <span className="text-[12.5px] text-ink-3">Unsaved changes</span>
        )}
      </div>
    </form>
  );
}
