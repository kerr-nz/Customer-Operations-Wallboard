import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CallData, TeamAgent, TeamSummary, TeamStats } from "@shared/schema";
import { KPIStrip } from "@/components/KPIStrip";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Wifi,
  WifiOff,
  Sun,
  Moon,
  ArrowLeft,
  Users,
  Clock,
  CheckCircle,
  XCircle,
  Timer,
  TrendingUp,
  ArrowRight,
  Activity,
  CircleDot,
  Headphones,
  UserCheck,
  UserX,
} from "lucide-react";
import { Link } from "wouter";

interface TeamWallboardProps {
  customerId: string;
  teamId: string;
}

const EMPTY_STATS: TeamStats = {
  total: 0, active: 0, callsWaiting: 0, inbound: 0, outbound: 0,
  answered: 0, missed: 0, inboundAnswered: 0, outboundAnswered: 0,
  totalDuration: 0, totalWaitTime: 0, answeredWithWait: 0, liveWaitAvg: 0,
  inboundTotalDuration: 0, inboundDurationCount: 0, avgCallDurationInbound: 0,
  outboundTotalDuration: 0, outboundDurationCount: 0, avgCallDurationOutbound: 0,
};

function useTeamWebSocket(customerId: string, teamId: string) {
  const [stats, setStats] = useState<TeamStats>(EMPTY_STATS);
  const [calls, setCalls] = useState<CallData[]>([]);
  const [agents, setAgents] = useState<TeamAgent[]>([]);
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${customerId}/team/${teamId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    };
    ws.onclose = () => { setConnected(false); reconnectTimerRef.current = setTimeout(connect, 3000); };
    ws.onerror = () => { ws.close(); };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "team.init":
            setStats(data.stats || EMPTY_STATS);
            setCalls(data.recentCalls || []);
            setAgents(data.agents || []);
            setSummary(data.summary || null);
            if (data.customerName) setCustomerName(data.customerName);
            if (data.teams) setTeams(data.teams);
            break;
          case "call.started":
            if (data.stats) setStats(data.stats);
            if (data.call) setCalls(prev => [data.call, ...prev].slice(0, 100));
            break;
          case "call.answered":
            if (data.stats) setStats(data.stats);
            setCalls(prev => prev.map(c => c.id === data.callId ? { ...c, ...(data.call || {}), status: "answered" as const } : c));
            break;
          case "call.ended":
            if (data.stats) setStats(data.stats);
            if (data.call) {
              setCalls(prev => {
                const exists = prev.find(c => c.id === data.call.id);
                if (exists) return prev.map(c => c.id === data.call.id ? data.call : c);
                return [data.call, ...prev].slice(0, 100);
              });
            }
            break;
          case "call.not_answered":
            if (data.stats) setStats(data.stats);
            setCalls(prev => {
              const exists = prev.find(c => c.id === data.callId);
              if (exists) {
                return prev.map(c => c.id === data.callId ? { ...c, status: "missed" as const } : c);
              }
              if (data.call) {
                return [{ ...data.call, status: "missed" as const }, ...prev].slice(0, 100);
              }
              return prev;
            });
            break;
          case "call.updated":
            if (data.call) {
              setCalls(prev => prev.map(c => c.id === data.callId ? { ...c, ...(data.call || {}) } : c));
            }
            break;
          case "team.availability":
            if (data.summary) setSummary(data.summary);
            if (data.agents) setAgents(data.agents);
            if (data.stats) setStats(data.stats);
            break;
          case "reset":
            setStats(EMPTY_STATS);
            setCalls([]);
            break;
        }
      } catch (err) {
        console.error("Team WS parse error:", err);
      }
    };
  }, [customerId, teamId]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect]);

  return { stats, calls, agents, summary, connected, customerName, teams };
}

function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("spoke-theme");
    if (saved === "light") { setDark(false); document.documentElement.classList.remove("dark"); }
    else { setDark(true); document.documentElement.classList.add("dark"); }
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) { document.documentElement.classList.add("dark"); localStorage.setItem("spoke-theme", "dark"); }
    else { document.documentElement.classList.remove("dark"); localStorage.setItem("spoke-theme", "light"); }
  };
  return (
    <Button size="icon" variant="ghost" onClick={toggle} data-testid="button-theme-toggle">
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <span className="text-sm tabular-nums text-muted-foreground font-mono" data-testid="text-live-clock">
      {time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

function getAgentStatusInfo(agent: TeamAgent): { label: string; colorClass: string; dotColor: string; isActive: boolean } {
  if (agent.loginStatus === "loggedOut") {
    return { label: "Offline", colorClass: "text-muted-foreground", dotColor: "bg-muted-foreground", isActive: false };
  }
  switch (agent.availability.status) {
    case "available":
      return { label: "Available", colorClass: "text-emerald-500 dark:text-emerald-400", dotColor: "bg-emerald-500", isActive: true };
    case "busy":
      return { label: agent.availability.notAvailableReason || "On a call", colorClass: "text-amber-500 dark:text-amber-400", dotColor: "bg-amber-500", isActive: true };
    case "ringing":
      return { label: "Ringing", colorClass: "text-sky-500 dark:text-sky-400", dotColor: "bg-sky-500", isActive: true };
    default:
      return { label: "Offline", colorClass: "text-muted-foreground", dotColor: "bg-muted-foreground", isActive: false };
  }
}

function formatDuration(timestamp: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  const hrs = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    return `${days}d ${remHrs}h`;
  }
  return `${hrs}h ${mins}m`;
}

function AgentRoster({ agents, calls }: { agents: TeamAgent[]; calls: CallData[] }) {
  const [, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 5000); return () => clearInterval(i); }, []);

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aOrder = a.availability.status === "available" ? 0 : a.availability.status === "busy" ? 1 : a.availability.status === "ringing" ? 2 : 3;
      const bOrder = b.availability.status === "available" ? 0 : b.availability.status === "busy" ? 1 : b.availability.status === "ringing" ? 2 : 3;
      if (a.loginStatus !== b.loginStatus) return a.loginStatus === "loggedIn" ? -1 : 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [agents]);

  const available = agents.filter(a => a.loginStatus === "loggedIn" && a.availability.status === "available").length;
  const busy = agents.filter(a => a.loginStatus === "loggedIn" && a.availability.status === "busy").length;
  const offline = agents.filter(a => a.loginStatus === "loggedOut" || a.availability.status === "offline").length;

  return (
    <Card className="p-4 flex flex-col gap-3 h-full" data-testid="agent-roster">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Agents</h3>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary" className="text-xs tabular-nums gap-1">
                <UserCheck className="w-3 h-3 text-emerald-500" />
                {available}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Available</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary" className="text-xs tabular-nums gap-1">
                <Headphones className="w-3 h-3 text-amber-500" />
                {busy}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Busy</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary" className="text-xs tabular-nums gap-1">
                <UserX className="w-3 h-3 text-muted-foreground" />
                {offline}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Offline</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="flex-1 -mx-1 px-1">
        {sortedAgents.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No agent data yet
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {sortedAgents.map(agent => (
              <AgentRow key={agent.id} agent={agent} calls={calls} />
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}

function AgentRow({ agent, calls }: { agent: TeamAgent; calls: CallData[] }) {
  const { label, colorClass, dotColor, isActive } = getAgentStatusInfo(agent);

  const isBusyOrRinging = agent.availability.status === "busy" || agent.availability.status === "ringing";
  const activeCall = isBusyOrRinging
    ? calls.find(c =>
        (c.status === "active" || (c.status === "answered" && c.duration === null)) &&
        (c.agentId === agent.id || (agent.availability.callId && agent.availability.callId === c.id))
      ) ?? null
    : null;

  const contactDisplay = activeCall ? (activeCall.contactName ?? activeCall.contactNumber ?? null) : null;

  return (
    <div
      className="flex items-center gap-3 px-2 py-2 rounded-md"
      data-testid={`agent-row-${agent.id}`}
    >
      <div className="relative">
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
          {agent.firstName?.[0]?.toUpperCase() || ""}{agent.lastName?.[0]?.toUpperCase() || ""}
        </div>
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card ${dotColor}`}>
          {isActive && agent.availability.status !== "available" && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColor}`} />
          )}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{agent.displayName}</div>
        {agent.jobTitle && (
          <div className="text-xs text-muted-foreground truncate">{agent.jobTitle}</div>
        )}
      </div>

      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1">
          {isBusyOrRinging && activeCall && (
            <span className={activeCall.direction === "inbound" ? "text-chart-4" : "text-chart-3"} data-testid={`agent-call-direction-${agent.id}`}>
              {activeCall.direction === "inbound"
                ? <PhoneIncoming className="w-3 h-3" />
                : <PhoneOutgoing className="w-3 h-3" />}
            </span>
          )}
          <span className={`text-xs font-medium ${colorClass}`}>{label}</span>
        </div>
        {isBusyOrRinging && contactDisplay && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" data-testid={`agent-contact-${agent.id}`}>
            {contactDisplay}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatDuration(agent.availability.statusTimestamp)}
        </span>
      </div>
    </div>
  );
}

function ActiveCallsQueue({ calls }: { calls: CallData[] }) {
  const activeCalls = useMemo(() => {
    return calls.filter(c => c.status === "active" || (c.status === "answered" && c.duration === null));
  }, [calls]);

  const recentCompleted = useMemo(() => {
    return calls
      .filter(c => c.status !== "active" && !(c.status === "answered" && c.duration === null))
      .slice(0, 20);
  }, [calls]);

  return (
    <Card className="p-4 flex flex-col gap-3 h-full" data-testid="active-calls-queue">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Calls</h3>
        </div>
        <div className="flex items-center gap-2">
          {activeCalls.length > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums gap-1">
              <CircleDot className="w-3 h-3 text-emerald-500" />
              {activeCalls.length} live
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs tabular-nums">
            {calls.length} total
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1 -mx-1 px-1">
        {calls.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No calls yet today
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {activeCalls.map(call => (
              <TeamCallItem key={call.id} call={call} />
            ))}
            {activeCalls.length > 0 && recentCompleted.length > 0 && (
              <div className="border-t my-1" />
            )}
            {recentCompleted.map(call => (
              <TeamCallItem key={call.id} call={call} />
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}

function getCallStatusInfo(call: CallData): { label: string; colorClass: string; bgClass: string; isLive: boolean } {
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

function TeamCallItem({ call }: { call: CallData }) {
  const isInbound = call.direction === "inbound";
  const { label, colorClass, bgClass, isLive } = getCallStatusInfo(call);

  return (
    <div className={`flex items-center gap-3 px-2 py-2 rounded-md transition-colors ${bgClass}`} data-testid={`team-call-${call.id}`}>
      <div className={`${isInbound ? "text-chart-4" : "text-chart-3"}`}>
        {isInbound ? <PhoneIncoming className="w-4 h-4" /> : <PhoneOutgoing className="w-4 h-4" />}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate" data-testid={`call-caller-${call.id}`}>
            {call.contactName ?? call.contactNumber ?? "—"}
          </span>
          {(call.status === "answered" || call.status === "ended") && call.agentName && (
            <>
              <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground truncate" data-testid={`call-agent-${call.id}`}>
                {call.agentName}
              </span>
            </>
          )}
          {isLive && (
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${call.status === "active" ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${call.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground truncate">{call.fromLabel} → {call.toLabel}</span>
      </div>

      {call.duration !== null && (
        <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {call.durationText || formatSeconds(call.duration)}
        </span>
      )}

      <div className="flex flex-col items-end gap-0.5">
        <span className={`text-[10px] font-medium uppercase ${colorClass}`}>{label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{formatTime(call.startedAt)}</span>
      </div>
    </div>
  );
}

function AvailabilitySummaryBar({ summary }: { summary: TeamSummary | null }) {
  if (!summary) return null;

  const availPct = summary.totalMembers > 0 ? Math.round((summary.totalAvailable / summary.totalMembers) * 100) : 0;

  return (
    <Card className="p-4 flex flex-col gap-2" data-testid="availability-summary">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Team Availability</span>
        </div>
        <span className="text-sm font-medium">{summary.availabilitySummary}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-700 ease-out"
          style={{ width: `${availPct}%` }}
        />
      </div>
    </Card>
  );
}

export default function TeamWallboard({ customerId, teamId }: TeamWallboardProps) {
  const { stats, calls, agents, summary, connected, customerName } = useTeamWebSocket(customerId, teamId);
  const teamDisplayName = summary?.displayName || teamId;
  const customerDisplayName = customerName || customerId;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap">
        <div className="flex items-center gap-3">
          <Link href={`/${customerId}`}>
            <Button size="icon" variant="ghost" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Phone className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none" data-testid="text-team-name">{teamDisplayName}</h1>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">
                {customerDisplayName}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
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

      <main className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        <KPIStrip stats={stats} variant="team" />
        <AvailabilitySummaryBar summary={summary} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
          <div className="min-h-[300px]">
            <AgentRoster agents={agents} calls={calls} />
          </div>
          <div className="min-h-[300px]">
            <ActiveCallsQueue calls={calls} />
          </div>
        </div>
      </main>
    </div>
  );
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
