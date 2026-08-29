import { useState, useCallback } from "react";
import { trpc } from "@/trpc";
import { renderMergeTokens, validateMergeTokens } from "@sponsee/shared";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, AlertCircle, Check, RotateCcw } from "lucide-react";
import QueryError from "@/components/QueryError";

const STEP_NAMES: Record<number, string> = {
  1: "Friendly reminder",
  2: "Second notice",
  3: "Final notice",
};

const PREVIEW_CTX = {
  brandContact: "Sarah",
  brand: "NordVPN",
  dealTitle: "July Sponsorship",
  invoiceId: "INV-0042",
  amount: "$1,250.00",
  dueDate: "Aug 15, 2026",
  daysLate: 7,
  creatorName: "Alex",
};

export default function ChaseTemplatesPanel() {
  const utils = trpc.useUtils();
  const { data: templates, isLoading, isError, refetch } = trpc.chase.templates.useQuery();
  const update = trpc.chase.updateTemplate.useMutation({
    onSuccess: () => {
      toast.success("Template saved");
      utils.chase.templates.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to save"),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftEnabled, setDraftEnabled] = useState(true);
  const [showPreview, setShowPreview] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const startEdit = useCallback(
    (template: NonNullable<typeof templates>[number]) => {
      setEditingId(template.id);
      setDraftSubject(template.subject);
      setDraftBody(template.body);
      setDraftEnabled(template.enabled);
      setValidationErrors(validateMergeTokens(template.subject + " " + template.body));
    },
    []
  );

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraftSubject("");
    setDraftBody("");
    setValidationErrors([]);
  }, []);

  const saveEdit = useCallback(
    (id: string) => {
      const errors = validateMergeTokens(draftSubject + " " + draftBody);
      if (errors.length > 0) {
        setValidationErrors(errors);
        return;
      }
      update.mutate({
        id,
        subject: draftSubject,
        body: draftBody,
        enabled: draftEnabled,
      });
      setEditingId(null);
    },
    [draftSubject, draftBody, draftEnabled, update]
  );

  const togglePreview = (id: string) => {
    setShowPreview((prev) => ({ ...prev, [id]: !prev[id] }));
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
        message="Couldn't load chase templates."
        onRetry={() => refetch()}
      />
    );
  }

  const sorted = templates?.slice().sort((a, b) => a.step - b.step) ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-hairline bg-amber-tint/30 p-3">
        <p className="text-[12.5px] text-amber">
          Use merge tokens like{" "}
          <code className="rounded bg-amber-tint px-1 py-0.5 text-[11px] font-medium">
            {"{brand_contact}"}
          </code>
          ,{" "}
          <code className="rounded bg-amber-tint px-1 py-0.5 text-[11px] font-medium">
            {"{amount}"}
          </code>
          ,{" "}
          <code className="rounded bg-amber-tint px-1 py-0.5 text-[11px] font-medium">
            {"{days_late}"}
          </code>{" "}
          to personalize chase emails. The same renderer runs in preview and in production.
        </p>
      </div>

      {sorted.map((template) => {
        const isEditing = editingId === template.id;
        const previewSubject = renderMergeTokens(template.subject, PREVIEW_CTX);
        const previewBody = renderMergeTokens(template.body, PREVIEW_CTX);

        return (
          <div
            key={template.id}
            className={cn(
              "rounded-xl border p-4 transition-colors",
              template.enabled ? "border-hairline bg-surface" : "border-hairline bg-surface-subtle opacity-70"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-3/10 text-[11px] font-bold text-ink-3">
                  {template.step}
                </span>
                <span className="text-[13px] font-semibold text-ink">
                  {STEP_NAMES[template.step]}
                </span>
                {!template.enabled && (
                  <span className="rounded-full bg-ink-3/10 px-2 py-0.5 text-[10px] font-medium text-ink-3">
                    Disabled
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => togglePreview(template.id)}
                  className="flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-[11px] text-ink-3 transition-colors hover:bg-surface-subtle"
                >
                  {showPreview[template.id] ? (
                    <>
                      <EyeOff className="h-3 w-3" /> Hide preview
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3" /> Preview
                    </>
                  )}
                </button>
                {!isEditing && (
                  <button
                    onClick={() => startEdit(template)}
                    className="flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-[11px] text-ink-2 transition-colors hover:bg-surface-subtle"
                  >
                    Edit
                  </button>
                )}
              </div>
            </div>

            {/* Offset badge */}
            <p className="mt-1 text-[11px] text-ink-3">
              Sends {template.offsetDays} day{template.offsetDays === 1 ? "" : "s"} after due date
            </p>

            {isEditing ? (
              <div className="mt-3 space-y-3">
                <div>
                  <label
                    htmlFor={`template-subject-${template.id}`}
                    className="mb-1 block text-[11px] font-medium text-ink-2"
                  >
                    Subject
                  </label>
                  <input
                    id={`template-subject-${template.id}`}
                    value={draftSubject}
                    onChange={(e) => {
                      setDraftSubject(e.target.value);
                      setValidationErrors(validateMergeTokens(e.target.value + " " + draftBody));
                    }}
                    className="h-9 w-full rounded-lg border border-hairline bg-surface px-3 text-[13px] text-ink outline-none transition-colors focus:border-pine focus:ring-1 focus:ring-pine"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`template-body-${template.id}`}
                    className="mb-1 block text-[11px] font-medium text-ink-2"
                  >
                    Body
                  </label>
                  <textarea
                    id={`template-body-${template.id}`}
                    value={draftBody}
                    onChange={(e) => {
                      setDraftBody(e.target.value);
                      setValidationErrors(validateMergeTokens(draftSubject + " " + e.target.value));
                    }}
                    rows={6}
                    className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-pine focus:ring-1 focus:ring-pine"
                  />
                </div>

                {validationErrors.length > 0 && (
                  <div className="flex items-start gap-1.5 rounded-md bg-brick-tint p-2 text-[11px] text-brick">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>Unknown tokens: {validationErrors.join(", ")}</span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={draftEnabled}
                      onChange={(e) => setDraftEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-hairline text-pine focus:ring-pine"
                    />
                    Enabled
                  </label>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => saveEdit(template.id)}
                    disabled={update.isPending}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-pine px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-pine-hover disabled:opacity-50"
                  >
                    {update.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                    <Check className="h-3 w-3" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[12.5px] text-ink-3 transition-colors hover:bg-surface-subtle"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-3">
                  <p className="text-[11px] font-medium text-ink-3">Subject</p>
                  <p className="mt-0.5 text-[13px] text-ink">{template.subject}</p>
                </div>
                <div className="mt-2">
                  <p className="text-[11px] font-medium text-ink-3">Body</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-ink">{template.body}</p>
                </div>
              </>
            )}

            {/* Preview pane */}
            {showPreview[template.id] && (
              <div className="mt-3 rounded-lg border border-dashed border-pine/30 bg-pine/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-pine">
                  Preview
                </p>
                <p className="mt-1 text-[13px] font-medium text-ink">{previewSubject}</p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-ink-2">
                  {previewBody}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
