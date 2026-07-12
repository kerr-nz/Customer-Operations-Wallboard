import { useWebSocket } from "@/hooks/useWebSocket";
import { WorldMap } from "@/components/WorldMap";
import { KPIStrip } from "@/components/KPIStrip";
import { SentimentPanel } from "@/components/SentimentPanel";
import { CallFeed } from "@/components/CallFeed";
import { ViewToggle } from "@/components/ViewToggle";
import { WallboardHeader } from "@/components/WallboardHeader";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useState, useEffect } from "react";

interface DashboardProps {
  customerId: string;
}

export default function Dashboard({ customerId }: DashboardProps) {
  const { stats, calls, connected, customerName, defaultRegion } = useWebSocket(customerId);
  const [companyName, setCompanyName] = useState("Your Company Name");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/customers/${customerId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.companyName) setCompanyName(data.companyName);
        setLogoUrl(data?.logoUrl || null);
      })
      .catch(() => {});
  }, [customerId]);

  const displayName = customerName ? `${companyName} - ${customerName}` : companyName;

  useEffect(() => {
    document.title = displayName;
  }, [displayName]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <WallboardHeader
        logo={<CompanyLogo logoUrl={logoUrl} size={32} />}
        title={displayName}
        subtitle="Live Operations"
        connected={connected}
        viewToggle={<ViewToggle customerId={customerId} activeView="company" />}
      />

      <main className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        <KPIStrip stats={stats} showRinging />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          <div className="lg:col-span-2 flex flex-col gap-4 min-h-0">
            <div className="flex-1 min-h-[280px]">
              <WorldMap calls={calls} activeCount={stats.active} defaultRegion={defaultRegion} />
            </div>
          </div>

          <div className="flex flex-col gap-4 min-h-0">
            <SentimentPanel stats={stats} />
            <div className="flex-1 min-h-[200px]">
              <CallFeed calls={calls} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
