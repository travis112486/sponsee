import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  KanbanSquare,
  Wallet,
  Settings,
  Search,
  Bell,
  ShieldCheck,
  ChevronDown,
  FileText,
  Plus,
  Radio,
  Menu,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { trpc } from "@/trpc";
import { planLabels, planPricesCents } from "@sponsee/shared";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { to: "/payments", label: "Payments", icon: Wallet },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/settings", label: "Settings", icon: Settings },
];

const pageTitles: Record<string, { title: string; crumb?: string }> = {
  "/": { title: "Dashboard" },
  "/pipeline": { title: "Pipeline" },
  "/payments": { title: "Payments" },
  "/calendar": { title: "Calendar" },
  "/settings": { title: "Settings" },
};

function formatPaletteCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

type PaletteResult = {
  id: string;
  label: string;
  icon: typeof KanbanSquare;
  onSelect: () => void;
};

type PaletteGroup = {
  group: string;
  items: PaletteResult[];
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  // Live data — same canonical source as Pipeline/Payments, so results never
  // disagree with what those screens show (D-004/D-006).
  const { data: deals } = trpc.deals.list.useQuery(undefined, { enabled: open });
  const { data: invoices } = trpc.invoice.list.useQuery(undefined, { enabled: open });

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!open) return null;

  function go(path: string) {
    onClose();
    navigate(path);
  }

  const now = new Date();
  const groups: PaletteGroup[] = [
    {
      group: "Deals",
      items: (deals ?? []).map((deal) => ({
        id: deal.id,
        label: `${deal.brand?.name ?? "Unknown brand"} — ${deal.title}`,
        icon: KanbanSquare,
        onSelect: () => go(`/pipeline/${deal.id}`),
      })),
    },
    {
      group: "Invoices",
      items: (invoices ?? []).map((inv) => {
        const dueDate = inv.dueAt ? new Date(inv.dueAt) : null;
        const isOverdue = inv.status === "open" && dueDate !== null && dueDate < now;
        const daysOverdue = isOverdue && dueDate
          ? Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const dueLabel = !dueDate
          ? "no due date"
          : isOverdue
            ? `${daysOverdue}d overdue`
            : `due ${dueDate.toLocaleDateString()}`;
        return {
          id: inv.id,
          label: `${inv.title || `Invoice #${inv.number}`} · ${formatPaletteCents(inv.amountCents)} · ${dueLabel}`,
          icon: FileText,
          onSelect: () => go("/payments"),
        };
      }),
    },
    {
      group: "Actions",
      items: [
        {
          id: "new-deal",
          label: "New deal",
          icon: Plus,
          onSelect: () => go("/pipeline?new=1"),
        },
        {
          id: "create-invoice",
          label: "Create invoice",
          icon: Plus,
          onSelect: () => {
            onClose();
            navigate("/pipeline");
            toast("Create an invoice from a deal on the Pipeline page");
          },
        },
      ],
    },
  ];

  const filteredGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      style={{ backgroundColor: "rgba(27,24,21,.4)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[10px] border border-hairline bg-surface shadow-warm-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <Search className="h-4 w-4 text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deals, brands, invoices…"
            aria-label="Search deals, brands, invoices"
            className="w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded border border-hairline bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-3">esc</kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto py-2">
          {filteredGroups.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-ink-3">No results</p>
          )}
          {filteredGroups.map((group) => (
            <div key={group.group} className="px-2 pb-1">
              <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                {group.group}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={item.onSelect}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-pine-tint hover:text-pine"
                >
                  <item.icon className="h-3.5 w-3.5 text-ink-3" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  open = false,
  onClose,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const { user } = useAuth();
  const { data: subscription } = trpc.billing.getSubscription.useQuery();
  const location = useLocation();

  const plan = subscription?.plan ?? "starter";
  const dealSlotLimit = subscription?.dealSlotLimit ?? 5;
  const activeDealCount = subscription?.activeDealCount ?? 0;
  const usagePct = dealSlotLimit > 0 ? Math.min(100, (activeDealCount / dealSlotLimit) * 100) : 0;

  // Below the lg breakpoint the sidebar is an off-canvas drawer (D-011); at
  // lg+ it is always visible and `open`/`onClose` are ignored.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[232px] flex-col border-r border-hairline bg-surface transition-transform duration-200 lg:z-40 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <img src="/logo.svg" alt="Sponsee" className="h-6 w-6" />
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Sponsee</span>
      </div>

      {/* Identity chip */}
      {user && (
        <div className="mx-3 mb-3 flex items-center gap-2.5 rounded-lg border border-hairline bg-surface-subtle px-2.5 py-2">
          <img src={user.image || "/pixelpanda-avatar.png"} alt={user.name} className="h-7 w-7 rounded-full object-cover" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-4 text-ink">{user.name}</p>
            <p className="truncate text-[10.5px] leading-4 text-ink-3">Creator</p>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors duration-150",
                isActive ? "bg-pine-tint text-pine" : "text-ink-2 hover:bg-surface-subtle hover:text-ink"
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-[-12px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-pine" />
                )}
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Sidebar footer */}
      <div className="space-y-2.5 px-3 pb-4 pt-2">
        <div className="rounded-lg border border-hairline bg-surface-subtle p-3">
          <p className="text-[12px] font-semibold text-ink">
            {planLabels[plan]} plan · ${(planPricesCents[plan] / 100).toFixed(0)}/mo
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-hairline">
            <div className="h-full rounded-full bg-pine" style={{ width: `${usagePct}%` }} />
          </div>
          <p className="mt-1.5 text-[10.5px] text-ink-3">
            {activeDealCount} of {dealSlotLimit} active deal slots used
          </p>
          <button
            onClick={() => toast("Plan management (mock)")}
            className="mt-1.5 text-[11px] font-medium text-pine hover:text-pine-hover"
          >
            Manage
          </button>
        </div>
        <p className="flex items-center gap-1.5 px-1 text-[11px] leading-4 text-ink-3">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-pine" />
          Sponsee never touches your money
        </p>
      </div>
      </aside>
    </>
  );
}

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const page = pageTitles[location.pathname] ?? { title: "Dashboard" };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <header className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-surface px-3 sm:gap-4 sm:px-6 lg:left-[232px]">
      {/* Mobile nav toggle */}
      <button
        onClick={onMenuClick}
        aria-label="Open navigation menu"
        className="rounded-lg p-2 text-ink-2 transition-colors hover:bg-surface-subtle lg:hidden"
      >
        <Menu className="h-4.5 w-4.5" />
      </button>

      {/* Page title + breadcrumb */}
      <div className="flex items-baseline gap-2">
        {page.crumb && <span className="hidden text-[13px] text-ink-3 sm:inline">{page.crumb} /</span>}
        <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{page.title}</h1>
      </div>

      {/* Command search */}
      <button
        onClick={() => setPaletteOpen(true)}
        aria-label="Search deals, brands, invoices"
        className="hidden h-8 items-center gap-2 rounded-lg border border-hairline bg-surface-subtle px-2.5 text-[13px] text-ink-3 transition-colors hover:border-ink-3/40 md:flex md:w-[240px] lg:w-[320px]"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search deals, brands, invoices…</span>
        <kbd className="rounded border border-hairline bg-surface px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <button
        onClick={() => setPaletteOpen(true)}
        aria-label="Search deals, brands, invoices"
        className="rounded-lg p-2 text-ink-2 transition-colors hover:bg-surface-subtle md:hidden"
      >
        <Search className="h-4 w-4" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Go Live */}
        <button
          onClick={() => toast("You're not live right now")}
          className="flex h-8 items-center gap-2 rounded-lg border border-pine px-3 text-[13px] font-medium text-pine transition-all duration-120 hover:bg-pine-tint active:scale-[0.97]"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute h-full w-full animate-ping rounded-full bg-pine opacity-60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-pine" />
          </span>
          <span className="hidden sm:inline">Go Live</span>
        </button>

        {/* Bell */}
        <div className="relative">
          <button
            onClick={() => {
              setBellOpen((v) => !v);
              setAvatarOpen(false);
            }}
            className="relative rounded-lg p-2 text-ink-2 transition-colors hover:bg-surface-subtle"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute right-1.5 top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-brick text-[0px]" />
          </button>
          {bellOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} />
              <div className="absolute right-0 top-10 z-20 w-72 rounded-[10px] border border-hairline bg-surface py-1 shadow-warm-md">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Notifications · 0 new
                </p>
                <p className="px-3 py-2 text-[12.5px] text-ink-3">No notifications yet</p>
              </div>
            </>
          )}
        </div>

        {/* Avatar */}
        <div className="relative">
          <button
            onClick={() => {
              setAvatarOpen((v) => !v);
              setBellOpen(false);
            }}
            className="flex items-center gap-1 rounded-lg p-1 transition-colors hover:bg-surface-subtle"
          >
            <img
              src={user?.image || "/pixelpanda-avatar.png"}
              alt={user?.name || "User"}
              className="h-8 w-8 rounded-full object-cover"
            />
            <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
          </button>
          {avatarOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAvatarOpen(false)} />
              <div className="absolute right-0 top-11 z-20 w-44 rounded-[10px] border border-hairline bg-surface py-1 shadow-warm-md">
                <button
                  onClick={() => {
                    setAvatarOpen(false);
                    toast("Profile (mock)");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-surface-subtle"
                >
                  <Radio className="h-3.5 w-3.5 text-ink-3" /> Profile
                </button>
                <button
                  onClick={() => {
                    setAvatarOpen(false);
                    navigate("/settings");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-surface-subtle"
                >
                  <Settings className="h-3.5 w-3.5 text-ink-3" /> Settings
                </button>
                <button
                  onClick={() => {
                    setAvatarOpen(false);
                    signOut();
                    toast("Signed out");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink-2 hover:bg-surface-subtle"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </header>
  );
}
