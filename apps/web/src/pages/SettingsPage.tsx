import { useState } from "react";
import { User, Radio, CreditCard, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import ProfilePanel from "@/components/settings/ProfilePanel";
import PlatformsPanel from "@/components/settings/PlatformsPanel";
import RailsPanel from "@/components/settings/RailsPanel";
import ChaseTemplatesPanel from "@/components/settings/ChaseTemplatesPanel";

type TabKey = "profile" | "platforms" | "rails" | "chase";

const tabs: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "platforms", label: "Platforms", icon: Radio },
  { key: "rails", label: "Payout rails", icon: CreditCard },
  { key: "chase", label: "Chase templates", icon: Mail },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  return (
    <div className="mx-auto max-w-[720px]">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Settings</h2>
      <p className="mt-1 text-[13px] text-ink-3">Manage your profile, platforms, and invoice templates.</p>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-hairline">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors",
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
      <div className="mt-6">
        {activeTab === "profile" && <ProfilePanel />}
        {activeTab === "platforms" && <PlatformsPanel />}
        {activeTab === "rails" && <RailsPanel />}
        {activeTab === "chase" && <ChaseTemplatesPanel />}
      </div>
    </div>
  );
}
