import { useState } from "react";
import { trpc } from "@/trpc";
import { toast } from "sonner";
import { Plus } from "lucide-react";

/**
 * Pick (or create) a brand contact, shared by the new-deal modal and the deal
 * detail contact card so the two surfaces can never disagree about how a
 * primary contact is captured.
 *
 * The "add contact" form is a plain <div> + button rather than a <form> so it
 * can sit inside the new-deal modal's own <form> without nesting forms.
 */
export function ContactPicker({
  brandId,
  selectedId,
  onSelect,
}: {
  brandId: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const utils = trpc.useUtils();
  const { data: contacts, isLoading } = trpc.brand.contacts.useQuery(
    { brandId: brandId ?? "" },
    { enabled: !!brandId }
  );
  const addContact = trpc.brand.addContact.useMutation({
    onSuccess: () => {
      if (brandId) utils.brand.contacts.invalidate({ brandId });
    },
    onError: (err) => toast.error(err.message || "Failed to add contact"),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");

  function submit() {
    if (!brandId || !name.trim() || !email.trim()) return;
    addContact.mutate(
      {
        brandId,
        name: name.trim(),
        email: email.trim(),
        role: role.trim() || undefined,
      },
      {
        onSuccess: (contact) => {
          onSelect(contact.id);
          setName("");
          setEmail("");
          setRole("");
          setShowAdd(false);
        },
      }
    );
  }

  return (
    <div className="mt-1.5 space-y-2">
      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value || null)}
        disabled={!brandId}
        aria-label="Primary contact"
        className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-pine disabled:opacity-50"
      >
        <option value="">No primary contact</option>
        {(contacts ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {c.email}
          </option>
        ))}
      </select>

      {isLoading && brandId && (
        <p className="text-[11px] text-ink-3">Loading contacts…</p>
      )}

      {showAdd ? (
        <div className="space-y-2 rounded-lg border border-hairline bg-surface-subtle p-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contact name"
            className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-pine"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Email"
            className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-pine"
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role (optional)"
            className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-pine"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-md border border-hairline px-2.5 py-1 text-[11px] text-ink-3 hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={addContact.isPending || !name.trim() || !email.trim()}
              className="rounded-md bg-pine px-2.5 py-1 text-[11px] font-medium text-white hover:bg-pine-hover disabled:opacity-50"
            >
              {addContact.isPending ? "Adding…" : "Add contact"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 text-[11px] font-medium text-pine hover:text-pine-hover"
        >
          <Plus className="h-3 w-3" />
          Add contact
        </button>
      )}
    </div>
  );
}
