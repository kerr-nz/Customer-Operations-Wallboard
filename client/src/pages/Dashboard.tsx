import { useWebSocket } from "@/hooks/useWebSocket";
import { WorldMap } from "@/components/WorldMap";
import { KPIStrip } from "@/components/KPIStrip";
import { SentimentPanel } from "@/components/SentimentPanel";
import { CallFeed } from "@/components/CallFeed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ViewToggle } from "@/components/ViewToggle";
import { Wifi, WifiOff, Sun, Moon } from "lucide-react";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useState, useEffect } from "react";

function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("spoke-theme");
    if (saved === "light") {
      setDark(false);
      document.documentElement.classList.remove("dark");
    } else {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("spoke-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("spoke-theme", "light");
    }
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={toggle}
      data-testid="button-theme-toggle"
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-sm tabular-nums text-muted-foreground font-mono" data-testid="text-live-clock">
      {time.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
    </span>
  );
}

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
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CompanyLogo logoUrl={logoUrl} size={32} />
            <div>
              <h1 className="text-sm font-semibold leading-none" data-testid="text-customer-name">{displayName}</h1>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">
                Live Operations
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ViewToggle customerId={customerId} activeView="company" />
          <LiveClock />
          <Badge
            variant={connected ? "secondary" : "destructive"}
            className="gap-1.5"
            data-testid="badge-connection-status"
          >
            {connected ? (
              <Wifi className="w-3 h-3" />
            ) : (
              <WifiOff className="w-3 h-3" />
            )}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        <KPIStrip stats={stats} />

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
