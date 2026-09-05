import { useEffect, useState } from "react";
import { Download, Eye, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/trpc";
import { useAuth } from "@/lib/auth";
import QueryError from "@/components/QueryError";
import type { MediaKitViewModel } from "@sponsee/shared";

type Kit = MediaKitViewModel;

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

function downloadPdf(kit: Kit) {
  const lines = [kit.creator.displayName, kit.headline ?? "Sponsorship proposal", kit.bio ?? "", "", "Offerings", ...kit.offerings.map((item) => `${item.title} — ${money(item.priceCents, item.currency)}`), "", "Examples", ...kit.examples.map((item) => `${item.title}: ${item.url}`)];
  const escaped = lines.map((line) => line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")).join("\\n");
  const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${escaped.length + 36}>>stream\nBT /F1 12 Tf 48 744 Td (${escaped}) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${kit.creator.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-proposal.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

export function MediaKitPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const query = trpc.mediaKit.get.useQuery();
  const update = trpc.mediaKit.update.useMutation({ onSuccess: () => { void utils.mediaKit.get.invalidate(); toast.success("Proposal saved"); }, onError: () => toast.error("Couldn't save your proposal") });
  const profileUpdate = trpc.settings.updateProfile.useMutation({ onSuccess: () => { void utils.mediaKit.get.invalidate(); toast.success("Profile saved"); }, onError: () => toast.error("Couldn't save your profile") });
  const offeringCreate = trpc.mediaKit.offering.create.useMutation({ onSuccess: () => void utils.mediaKit.get.invalidate(), onError: () => toast.error("Couldn't add offering") });
  const offeringUpdate = trpc.mediaKit.offering.update.useMutation({ onSuccess: () => void utils.mediaKit.get.invalidate(), onError: () => toast.error("Couldn't update offering") });
  const offeringDelete = trpc.mediaKit.offering.delete.useMutation({ onSuccess: () => void utils.mediaKit.get.invalidate() });
  const exampleCreate = trpc.mediaKit.example.create.useMutation({ onSuccess: () => void utils.mediaKit.get.invalidate(), onError: () => toast.error("Use an HTTPS example URL") });
  const exampleUpdate = trpc.mediaKit.example.update.useMutation({ onSuccess: () => void utils.mediaKit.get.invalidate(), onError: () => toast.error("Use an HTTPS example URL") });
  const exampleDelete = trpc.mediaKit.example.delete.useMutation({ onSuccess: () => void utils.mediaKit.get.invalidate() });
  const [preview, setPreview] = useState(false);
  const [headline, setHeadline] = useState("");
  const [bio, setBio] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    // Hydrate the local draft when the creator-scoped query becomes available.
    // This is intentionally state synchronization, not an event subscription.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query.data) { setHeadline(query.data.headline ?? ""); setBio(query.data.bio ?? ""); setDisplayName(query.data.creator.displayName); setCategory(query.data.creator.category ?? ""); }
  }, [query.data]);

  if (query.isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-pine" aria-label="Loading" /></div>;
  if (query.isError || !query.data) return <QueryError message="Couldn't load your proposal creator." onRetry={() => void query.refetch()} />;
  const kit = query.data;
  const save = () => {
    if (!displayName.trim() || !headline.trim()) { toast.error("Display name and proposal headline are required"); return; }
    profileUpdate.mutate({ displayName: displayName.trim(), category: category.trim() || null });
    update.mutate({ headline: headline.trim(), bio: bio.trim() || null });
  };

  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-pine">Creator-owned sales asset</p><h1 className="mt-1 font-serif text-[36px] leading-tight text-ink">Proposal Creator</h1><p className="mt-1 max-w-xl text-[13px] text-ink-3">Build a polished Media Kit for your next brand conversation. It stays private to your workspace.</p></div>
      <div className="flex gap-2"><button onClick={() => setPreview(true)} className="flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-[13px] font-medium text-ink-2 hover:bg-surface-subtle"><Eye className="h-4 w-4" />Preview proposal</button><button onClick={save} disabled={update.isPending || profileUpdate.isPending} className="rounded-lg bg-pine px-3 py-2 text-[13px] font-medium text-white hover:bg-pine-hover disabled:opacity-50">Save changes</button></div>
    </header>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-5">
        <Card title="Identity & profile" hint="Required fields are marked *"><div className="grid gap-4 sm:grid-cols-2"><Field label="Display name *" value={displayName} onChange={setDisplayName} /><Field label="Category / niche" value={category} onChange={setCategory} /><Field label="Contact email" value={user?.email ?? ""} readOnly /><Field label="Primary channels" value={kit.platforms.map((p) => `${p.platform}${p.handle ? ` · @${p.handle}` : ""}`).join(", ")} readOnly /></div><p className="mt-3 text-[11px] text-ink-3">Channel metrics are <strong>synced from connected channels</strong>; last refresh is shown in Settings.</p></Card>
        <Card title="Your story"><Field label="Proposal headline *" value={headline} onChange={setHeadline} /><label className="mt-4 block text-[12.5px] font-medium text-ink">Short bio<textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} className="mt-1.5 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-[13px] outline-none focus:border-pine" placeholder="Tell a brand why your community is a good fit." /></label></Card>
        <Card title="Offerings" action={<button onClick={() => offeringCreate.mutate({ title: "New offering", priceCents: 0, currency: "USD" })} className="flex items-center gap-1 text-[12px] font-medium text-pine"><Plus className="h-3.5 w-3.5" />Add offering</button>}><div className="space-y-3">{kit.offerings.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-hairline p-3"><input aria-label="Offering title" defaultValue={item.title} onBlur={(e) => { const title = e.currentTarget.value.trim(); if (title && title !== item.title) offeringUpdate.mutate({ id: item.id, title, description: item.description, priceCents: item.priceCents, currency: item.currency, position: item.position }); }} className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none" /><span className="text-[13px] text-ink-2">{money(item.priceCents, item.currency)}</span><button aria-label={`Delete ${item.title}`} onClick={() => offeringDelete.mutate({ id: item.id })} className="text-ink-3 hover:text-brick"><Trash2 className="h-4 w-4" /></button></div>)}</div></Card>
        <Card title="Examples" action={<button onClick={() => exampleCreate.mutate({ title: "New example", url: "https://example.com" })} className="flex items-center gap-1 text-[12px] font-medium text-pine"><Plus className="h-3.5 w-3.5" />Add example</button>}><div className="space-y-3">{kit.examples.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg border border-hairline p-3"><input aria-label="Example title" defaultValue={item.title} onBlur={(e) => { const title = e.currentTarget.value.trim(); if (title && title !== item.title) exampleUpdate.mutate({ id: item.id, title, url: item.url, position: item.position }); }} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" /><a href={item.url} target="_blank" rel="noreferrer" className="max-w-[180px] truncate text-[12px] text-pine">{item.url}</a><button aria-label={`Delete ${item.title}`} onClick={() => exampleDelete.mutate({ id: item.id })} className="text-ink-3 hover:text-brick"><Trash2 className="h-4 w-4" /></button></div>)}</div></Card>
      </section>
      <aside className="rounded-xl border border-hairline bg-surface p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Live preview</p><div className="mt-4 rounded-lg border border-hairline bg-paper p-5"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-pine">{kit.creator.category ?? "Live creator"}</p><h2 className="mt-3 font-serif text-[27px] leading-tight text-ink">{headline || "Your proposal headline"}</h2><p className="mt-3 text-[13px] leading-5 text-ink-2">{bio || "Your short creator story will appear here."}</p><div className="mt-5 grid grid-cols-2 gap-2">{kit.platforms.map((p) => <div key={p.platform} className="rounded-md bg-surface p-2"><p className="text-[11px] font-semibold capitalize text-ink">{p.platform}</p><p className="mt-1 text-[11px] text-ink-3">{p.ccv ? `${p.ccv.toLocaleString()} CCV` : "Connected"}</p></div>)}</div></div>{kit.cpvhGuidance && <p className="mt-4 text-[11px] text-ink-3">CPVH guidance · shared benchmark: {money(kit.cpvhGuidance.floor, "USD")}–{money(kit.cpvhGuidance.agency, "USD")}<br />Use as a reference, not a promise.</p>}<button onClick={() => downloadPdf({ ...kit, headline: headline || kit.headline, bio: bio || kit.bio })} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-hairline px-3 py-2 text-[13px] font-medium text-ink-2 hover:bg-surface-subtle"><Download className="h-4 w-4" />Download PDF</button></aside>
    </div>
    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onClick={() => setPreview(false)}><div role="dialog" aria-modal="true" aria-label="Proposal preview" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-paper p-6 shadow-warm-lg" onClick={(e) => e.stopPropagation()}><div className="flex justify-end"><button aria-label="Close preview" onClick={() => setPreview(false)}><X className="h-5 w-5 text-ink-3" /></button></div><h2 className="font-serif text-[42px] text-ink">{headline || kit.creator.displayName}</h2><p className="mt-3 text-[15px] leading-6 text-ink-2">{bio}</p><h3 className="mt-8 text-[14px] font-semibold text-ink">Offerings</h3>{kit.offerings.map((item) => <div key={item.id} className="mt-2 flex justify-between border-b border-hairline py-2 text-[13px]"><span>{item.title}</span><span>{money(item.priceCents, item.currency)}</span></div>)}<button onClick={() => downloadPdf({ ...kit, headline: headline || kit.headline, bio: bio || kit.bio })} className="mt-6 flex items-center gap-2 rounded-lg bg-pine px-3 py-2 text-[13px] font-medium text-white"><Download className="h-4 w-4" />Download PDF</button></div></div>}
  </div>;
}

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) { return <section className="rounded-xl border border-hairline bg-surface p-5"><div className="mb-4 flex items-start justify-between"><div><h2 className="text-[14px] font-semibold text-ink">{title}</h2>{hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}</div>{action}</div>{children}</section>; }
function Field({ label, value, onChange, readOnly = false }: { label: string; value: string; onChange?: (value: string) => void; readOnly?: boolean }) { return <label className="block text-[12.5px] font-medium text-ink">{label}<input value={value} readOnly={readOnly} onChange={(e) => onChange?.(e.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-hairline bg-surface px-3 text-[13px] outline-none focus:border-pine read-only:bg-surface-subtle read-only:text-ink-3" /></label>; }

export default MediaKitPage;
