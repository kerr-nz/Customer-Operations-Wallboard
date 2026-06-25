import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Sun, Moon, ArrowLeft } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";

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
    <Button size="icon" variant="ghost" onClick={toggle} data-testid="button-theme-toggle">
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

interface WallboardHeaderProps {
  logo: ReactNode;
  title: string;
  subtitle: string;
  connected: boolean;
  titleTestId?: string;
  viewToggle?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
}

export function WallboardHeader({
  logo,
  title,
  subtitle,
  connected,
  titleTestId = "text-customer-name",
  viewToggle,
  showBack = false,
  onBack,
}: WallboardHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap">
      <div className="flex items-center gap-3">
        {showBack && (
          <Button size="icon" variant="ghost" onClick={onBack} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        <div className="flex items-center gap-2">
          {logo}
          <div>
            <h1 className="text-sm font-semibold leading-none" data-testid={titleTestId}>{title}</h1>
            <p className="text-xs text-muted-foreground leading-none mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {viewToggle}
        <LiveClock />
        <Badge
          variant={connected ? "secondary" : "destructive"}
          className="gap-1.5"
          data-testid="badge-connection-status"
        >
          {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {connected ? "Connected" : "Disconnected"}
        </Badge>
        <ThemeToggle />
      </div>
    </header>
  );
}
