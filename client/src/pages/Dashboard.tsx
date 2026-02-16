import { useWebSocket } from "@/hooks/useWebSocket";
import { WorldMap } from "@/components/WorldMap";
import { KPIStrip } from "@/components/KPIStrip";
import { SentimentPanel } from "@/components/SentimentPanel";
import { CallFeed } from "@/components/CallFeed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, Wifi, WifiOff, Sun, Moon } from "lucide-react";
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

  const displayName = customerName ? `Spoke - ${customerName}` : "Spoke Phone";

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Phone className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none" data-testid="text-customer-name">{displayName}</h1>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">
                Live Operations
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
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

      <main className="flex-1 overflow-auto p-3 flex flex-col gap-3">
        <KPIStrip stats={stats} />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3 flex-1 min-h-0">
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex-1 min-h-[300px]">
              <WorldMap calls={calls} activeCount={stats.active} defaultRegion={defaultRegion} />
            </div>
          </div>

          <div className="flex flex-col gap-3 min-h-0">
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
