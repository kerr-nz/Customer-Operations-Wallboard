import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useCompanyName } from "@/hooks/useCompanyName";
import { WorldMap } from "@/components/WorldMap";
import { KPIStrip } from "@/components/KPIStrip";
import { SentimentPanel } from "@/components/SentimentPanel";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DailyStats, CallData } from "@shared/schema";
import { EMPTY_STATS } from "@/lib/teamStats";
import { formatSeconds, formatTime } from "@/lib/format";
import { CompanyLogo } from "@/components/CompanyLogo";
import {
  Wifi,
  WifiOff,
  Sun,
  Moon,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  SmilePlus,
  Meh,
  Frown,
  ArrowRight,
  Building2,
  LogOut,
  Settings,
} from "lucide-react";
import { Link } from "wouter";

interface GlobalCallData extends CallData {
  customerId?: string;
}

interface CustomerOption {
  id: string;
  name: string;
  defaultRegion?: string;
}

function useGlobalWebSocket() {
  const [globalStats, setGlobalStats] = useState<DailyStats>(EMPTY_STATS);
  const [perCustomerStats, setPerCustomerStats] = useState<Map<string, DailyStats>>(new Map());
  const [calls, setCalls] = useState<GlobalCallData[]>([]);
  const [connected, setConnected] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/_spoke`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimerRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => { ws.close(); };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "init":
            setGlobalStats(data.stats);
            setCalls(data.recentCalls || []);
            if (data.customers) setCustomers(data.customers);
            if (data.perCustomerStats) {
              setPerCustomerStats(
                new Map(Object.entries(data.perCustomerStats as Record<string, DailyStats>))
              );
            }
            break;

          case "call.started":
            if (data.globalStats) setGlobalStats(data.globalStats);
            if (data.customerId && data.stats) {
              setPerCustomerStats((prev) => {
                const next = new Map(prev);
                next.set(data.customerId, data.stats);
                return next;
              });
            }
            if (data.call) {
              const callWithCustomer = { ...data.call, customerId: data.customerId };
              setCalls((prev) => {
                const exists = prev.some((c) => c.id === callWithCustomer.id);
                if (exists) {
                  return prev.map((c) => (c.id === callWithCustomer.id ? callWithCustomer : c));
                }
                return [callWithCustomer, ...prev].slice(0, 100);
              });
            }
            break;

          case "call.answered":
            if (data.globalStats) setGlobalStats(data.globalStats);
            if (data.customerId && data.stats) {
              setPerCustomerStats((prev) => {
                const next = new Map(prev);
                next.set(data.customerId, data.stats);
                return next;
              });
            }
            setCalls((prev) =>
              prev.map((c) =>
                c.id === data.callId
                  ? { ...c, ...(data.call || {}), status: "answered" as const }
                  : c
              )
            );
            break;

          case "call.ended":
            if (data.globalStats) setGlobalStats(data.globalStats);
            if (data.customerId && data.stats) {
              setPerCustomerStats((prev) => {
                const next = new Map(prev);
                next.set(data.customerId, data.stats);
                return next;
              });
            }
            if (data.call) {
              setCalls((prev) => {
                const exists = prev.find((c) => c.id === data.call.id);
                const callWithCustomer = { ...data.call, customerId: data.customerId };
                if (exists) {
                  return prev.map((c) => (c.id === data.call.id ? callWithCustomer : c));
                }
                return [callWithCustomer, ...prev].slice(0, 100);
              });
            }
            break;

          case "call.not_answered":
            if (data.globalStats) setGlobalStats(data.globalStats);
            if (data.customerId && data.stats) {
              setPerCustomerStats((prev) => {
                const next = new Map(prev);
                next.set(data.customerId, data.stats);
                return next;
              });
            }
            setCalls((prev) =>
              prev.map((c) =>
                c.id === data.callId ? { ...c, status: "missed" as const } : c
              )
            );
            break;

          case "call.updated":
            if (data.call) {
              setCalls((prev) =>
                prev.map((c) =>
                  c.id === data.callId ? { ...c, ...(data.call || {}) } : c
                )
              );
            }
            break;

          case "sentiment.update":
            if (data.globalStats) setGlobalStats(data.globalStats);
            if (data.customerId && data.stats) {
              setPerCustomerStats((prev) => {
                const next = new Map(prev);
                next.set(data.customerId, data.stats);
                return next;
              });
            }
            setCalls((prev) =>
              prev.map((c) =>
                c.id === data.callId
                  ? { ...c, sentiment: data.sentiment as CallData["sentiment"] }
                  : c
              )
            );
            break;

          case "stats":
            if (data.globalStats) setGlobalStats(data.globalStats);
            break;

          case "reset":
            if (data.globalStats) setGlobalStats(data.globalStats);
            setCalls([]);
            setPerCustomerStats(new Map());
            break;
        }
      } catch (err) {
        console.error("Global WS parse error:", err);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  return { globalStats, perCustomerStats, calls, connected, customers };
}

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
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

export default function SpokeWallboard() {
  const { globalStats, perCustomerStats, calls, connected, customers } = useGlobalWebSocket();
  const [selectedCustomer, setSelectedCustomer] = useState<string>("_all");
  const { companyName, logoUrl } = useCompanyName();

  useEffect(() => {
    document.title = `${companyName} - Company Operations`;
  }, [companyName]);

  const customerNameMap = useMemo(() => {
    const m = new Map<string, string>();
    customers.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [customers]);

  const displayStats = useMemo(() => {
    if (selectedCustomer === "_all") return globalStats;
    return perCustomerStats.get(selectedCustomer) || EMPTY_STATS;
  }, [selectedCustomer, globalStats, perCustomerStats]);

  const displayCalls = useMemo(() => {
    if (selectedCustomer === "_all") return calls;
    return calls.filter((c) => c.customerId === selectedCustomer);
  }, [selectedCustomer, calls]);

  const displayRegion = useMemo(() => {
    if (selectedCustomer === "_all") return "world";
    const cust = customers.find((c) => c.id === selectedCustomer);
    return cust?.defaultRegion || "world";
  }, [selectedCustomer, customers]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <CompanyLogo logoUrl={logoUrl} size={32} />
            <div>
              <h1 className="text-sm font-semibold leading-none" data-testid="text-wallboard-title">
                {companyName}
              </h1>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">
                Company Operations
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
            <SelectTrigger className="w-[200px]" data-testid="select-customer-filter">
              <Building2 className="w-3.5 h-3.5 mr-1.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All Companies</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <LiveClock />

          <Badge
            variant={connected ? "secondary" : "destructive"}
            className="gap-1.5"
            data-testid="badge-connection-status"
          >
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? "Connected" : "Disconnected"}
          </Badge>
          <Link href="/admin">
            <Button size="icon" variant="ghost" data-testid="button-admin-link">
              <Settings className="w-4 h-4" />
            </Button>
          </Link>
          <ThemeToggle />
          <a href="/api/auth/logout">
            <Button size="icon" variant="ghost" data-testid="button-logout">
              <LogOut className="w-4 h-4" />
            </Button>
          </a>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        <KPIStrip stats={displayStats} showRinging />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          <div className="lg:col-span-2 flex flex-col gap-4 min-h-0">
            <div className="flex-1 min-h-[280px]">
              <WorldMap calls={displayCalls} activeCount={displayStats.active} defaultRegion={displayRegion} />
            </div>
          </div>

          <div className="flex flex-col gap-4 min-h-0">
            <SentimentPanel stats={displayStats} />
            <div className="flex-1 min-h-[200px]">
              <GlobalCallFeed calls={displayCalls} customerNameMap={customerNameMap} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function GlobalCallFeed({
  calls,
  customerNameMap,
}: {
  calls: GlobalCallData[];
  customerNameMap: Map<string, string>;
}) {
  return (
    <Card className="p-4 flex flex-col gap-3 h-full" data-testid="call-feed">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Recent Calls
        </h3>
        <Badge variant="secondary" className="text-xs tabular-nums">
          {calls.length}
        </Badge>
      </div>

      <ScrollArea className="flex-1 -mx-1 px-1">
        {calls.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No calls yet today
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {calls.map((call) => (
              <GlobalCallItem
                key={call.id}
                call={call}
                customerName={call.customerId ? customerNameMap.get(call.customerId) : undefined}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}

function getStatusInfo(call: CallData): { label: string; colorClass: string; bgClass: string; isLive: boolean } {
  if (call.status === "active") {
    return { label: "Ringing", colorClass: "text-emerald-500 dark:text-emerald-400", bgClass: "bg-emerald-500/5 dark:bg-emerald-400/5", isLive: true };
  }
  if (call.status === "answered" && call.duration == null) {
    return { label: "Talking", colorClass: "text-amber-500 dark:text-amber-400", bgClass: "bg-amber-500/5 dark:bg-amber-400/5", isLive: true };
  }
  if (call.status === "missed") {
    return { label: "Missed", colorClass: "text-rose-500 dark:text-rose-400", bgClass: "", isLive: false };
  }
  return { label: "Completed", colorClass: "text-indigo-400 dark:text-indigo-300", bgClass: "", isLive: false };
}

function GlobalCallItem({ call, customerName }: { call: GlobalCallData; customerName?: string }) {
  const isInbound = call.direction === "inbound";
  const { label, colorClass, bgClass, isLive } = getStatusInfo(call);

  const sentimentIcon = call.sentiment
    ? call.sentiment === "Happy"
      ? <SmilePlus className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
      : call.sentiment === "Angry"
        ? <Frown className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
        : <Meh className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
    : null;

  return (
    <div
      className={`flex items-start gap-3 p-2.5 rounded-md transition-colors ${bgClass}`}
      data-testid={`call-item-${call.id}`}
    >
      <div className={`mt-0.5 ${isInbound ? "text-chart-4" : "text-chart-3"}`}>
        {isInbound ? <PhoneIncoming className="w-4 h-4" /> : <PhoneOutgoing className="w-4 h-4" />}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isInbound ? (
            <>
              <span className="text-sm font-medium truncate" data-testid={`call-caller-${call.id}`}>
                {call.contactName ?? call.contactNumber ?? "—"}
              </span>
              {(call.status === "answered" || call.status === "ended") && call.agentName && (
                <>
                  <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium truncate text-muted-foreground" data-testid={`call-agent-${call.id}`}>
                    {call.agentName}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              {(call.status === "answered" || call.status === "ended") && call.agentName && (
                <>
                  <span className="text-sm font-medium truncate text-muted-foreground" data-testid={`call-agent-${call.id}`}>
                    {call.agentName}
                  </span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                </>
              )}
              <span className="text-sm font-medium truncate" data-testid={`call-caller-${call.id}`}>
                {call.contactName ?? call.contactNumber ?? "—"}
              </span>
            </>
          )}
          {isLive && (
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${call.status === "active" ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${call.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
            </span>
          )}
          {sentimentIcon}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span className="truncate">{call.fromLabel} → {call.toLabel}</span>
          {customerName && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {customerName}
            </span>
          )}
          {call.duration !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {call.durationText || formatSeconds(call.duration)}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className={`text-[10px] font-medium uppercase ${colorClass}`}>{label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{formatTime(call.startedAt)}</span>
      </div>
    </div>
  );
}
