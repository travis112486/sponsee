import { useState } from "react";
import { useSearchParams } from "react-router";
import { User, Radio, CreditCard, Mail, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import ProfilePanel from "@/components/settings/ProfilePanel";
import PlatformsPanel from "@/components/settings/PlatformsPanel";
import RailsPanel from "@/components/settings/RailsPanel";
import ChaseTemplatesPanel from "@/components/settings/ChaseTemplatesPanel";
import BillingPanel from "@/components/settings/BillingPanel";

type TabKey = "profile" | "platforms" | "rails" | "chase" | "billing";

const tabs: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "platforms", label: "Platforms", icon: Radio },
  { key: "rails", label: "Payout rails", icon: CreditCard },
  { key: "chase", label: "Chase templates", icon: Mail },
  { key: "billing", label: "Billing", icon: Receipt },
];

export default function SettingsPage() {
  // The OAuth connect flow (PlatformsPanel) redirects back to /settings with
  // ?connected= or ?connect_error= — land the user on the tab they left from.
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(
    searchParams.has("connected") || searchParams.has("connect_error") ? "platforms" : "profile"
  );

  return (
    <div className="mx-auto max-w-[720px]">
      <h2 className="font-serif text-[22px] tracking-[-0.01em] text-ink">Settings</h2>
      <p className="mt-1 text-[13px] text-ink-3">Manage your profile, platforms, and invoice templates.</p>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-hairline">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors",
              activeTab === tab.key
                ? "border-pine text-pine"
                : "border-transparent text-ink-3 hover:text-ink"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="mt-6 rounded-xl border border-hairline bg-surface p-5 shadow-warm">
        {activeTab === "profile" && <ProfilePanel />}
        {activeTab === "platforms" && <PlatformsPanel />}
        {activeTab === "rails" && <RailsPanel />}
        {activeTab === "chase" && <ChaseTemplatesPanel />}
        {activeTab === "billing" && <BillingPanel />}
      </div>
    </div>
  );
}
