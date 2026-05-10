import { useWebSocket } from "@/hooks/useWebSocket";
import { KPIStrip } from "@/components/KPIStrip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Phone, PhoneCall, Wifi, WifiOff, Sun, Moon, Users, UserCheck, ArrowRight, ArrowLeft, PhoneIncoming, Clock, AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import type { DailyStats, TeamGroup, TeamSummary, TeamStats } from "@shared/schema";
import { useBackNav } from "@/lib/nav";

const EMPTY_STATS: DailyStats = {
  total: 0, active: 0, inbound: 0, outbound: 0,
  answered: 0, missed: 0, inboundAnswered: 0, outboundAnswered: 0,
  happy: 0, normal: 0, angry: 0, totalDuration: 0,
  inboundTotalDuration: 0, inboundDurationCount: 0, avgCallDurationInbound: 0,
  outboundTotalDuration: 0, outboundDurationCount: 0, avgCallDurationOutbound: 0,
};

function aggregateTeamStats(teamIds: string[], statsMap: Record<string, TeamStats>): DailyStats {
  const s = { ...EMPTY_STATS };
  for (const tid of teamIds) {
    const ts = statsMap[tid];
    if (!ts) continue;
    s.total += ts.total;
    s.active += ts.active;
    s.inbound += ts.inbound;
    s.outbound += ts.outbound;
    s.answered += ts.answered;
    s.missed += ts.missed;
    s.inboundAnswered += ts.inboundAnswered;
    s.outboundAnswered += ts.outboundAnswered;
    s.totalDuration += ts.totalDuration;
    s.inboundTotalDuration += ts.inboundTotalDuration ?? 0;
    s.inboundDurationCount += ts.inboundDurationCount ?? 0;
    s.outboundTotalDuration += ts.outboundTotalDuration ?? 0;
    s.outboundDurationCount += ts.outboundDurationCount ?? 0;
  }
  s.avgCallDurationInbound =
    s.inboundDurationCount > 0 ? Math.round(s.inboundTotalDuration / s.inboundDurationCount) : 0;
  s.avgCallDurationOutbound =
    s.outboundDurationCount > 0 ? Math.round(s.outboundTotalDuration / s.outboundDurationCount) : 0;
  return s;
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

function SubBoardSelector({ customerId }: { customerId: string }) {
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [, setLocation] = useLocation();

  useEffect(() => {
    fetch(`/api/customers/${customerId}/groups`)
      .then((res) => res.json())
      .then((data: TeamGroup[]) => {
        if (Array.isArray(data)) setGroups(data.filter((g) => (g.teamCount || 0) > 0));
      })
      .catch(() => {});
  }, [customerId]);

  return (
    <Select
      value="all-teams"
      onValueChange={(val) => {
        if (val === "company") {
          setLocation(`/${customerId}`);
        } else if (val === "all-teams") {
          return;
        } else {
          setLocation(`/${customerId}/group/${val}`);
        }
      }}
    >
      <SelectTrigger className="w-[160px]" data-testid="select-sub-board">
        <SelectValue placeholder="Sub-Boards" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="company" data-testid="select-sub-board-company">Company</SelectItem>
        <SelectItem value="all-teams" data-testid="select-sub-board-all-teams">All Teams</SelectItem>
        {groups.map((group) => (
          <SelectItem key={group.id} value={group.slug} data-testid={`select-sub-board-${group.slug}`}>
            {group.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface EnabledTeam {
  teamId: string;
  teamName: string;
  slaAnswerSeconds: number | null;
}

type SlaStatus = "ok" | "warning" | "breach";

function getSlaStatus(avgWaitTime: number, slaSeconds: number | null): SlaStatus {
  if (slaSeconds === null || slaSeconds <= 0) return "ok";
  if (avgWaitTime >= slaSeconds) return "breach";
  if (avgWaitTime >= slaSeconds * 0.8) return "warning";
  return "ok";
}

function formatWaitTime(seconds: number): string {
  if (seconds === 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function slaCardClass(status: SlaStatus): string {
  switch (status) {
    case "breach":
      return "border-l-[3px] border-l-red-500 bg-red-500/5";
    case "warning":
      return "border-l-[3px] border-l-amber-500 bg-amber-500/5";
    default:
      return "";
  }
}

interface TeamBoardProps {
  customerId: string;
}

export default function TeamBoard({ customerId }: TeamBoardProps) {
  const { connected, customerName, teams, teamStatsMap } = useWebSocket(customerId);
  const [enabledTeams, setEnabledTeams] = useState<EnabledTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [location] = useLocation();
  const { parentPath, showBack } = useBackNav(location);

  useEffect(() => {
    setTeamsLoading(true);
    fetch(`/api/customers/${customerId}/teams`)
      .then((res) => res.json())
      .then((data: EnabledTeam[]) => {
        if (Array.isArray(data)) setEnabledTeams(data);
        setTeamsLoading(false);
      })
      .catch(() => {
        setTeamsLoading(false);
      });
  }, [customerId]);

  const teamRows = useMemo(() => {
    const wsTeamMap = new Map<string, TeamSummary>();
    for (const t of teams) {
      wsTeamMap.set(t.id, t);
    }

    return enabledTeams
      .map((et) => {
        const ws = wsTeamMap.get(et.teamId);
        const ts = teamStatsMap[et.teamId];
        const liveWait = ts?.liveWaitAvg ?? 0;

        return {
          teamId: et.teamId,
          teamName: et.teamName,
          totalAvailable: ws?.totalAvailable ?? 0,
          totalMembers: ws?.totalMembers ?? 0,
          activeCalls: ts?.active ?? 0,
          callsWaiting: ts?.callsWaiting ?? 0,
          avgWaitTime: liveWait,
          slaAnswerSeconds: et.slaAnswerSeconds,
          slaStatus: getSlaStatus(liveWait, et.slaAnswerSeconds),
        };
      })
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [enabledTeams, teams, teamStatsMap]);

  const aggregatedStats = useMemo(
    () => aggregateTeamStats(enabledTeams.map((t) => t.teamId), teamStatsMap),
    [enabledTeams, teamStatsMap],
  );

  const displayName = customerName ? `Spoke - ${customerName}` : "Spoke Phone";

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b flex-wrap">
        <div className="flex items-center gap-3">
          {showBack && parentPath && (
            <Link href={parentPath}>
              <Button size="icon" variant="ghost" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
          )}
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
          <SubBoardSelector customerId={customerId} />
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
        <KPIStrip stats={aggregatedStats} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2" data-testid="team-board-grid">
          {teamRows.map((team) => (
            <Link key={team.teamId} href={`/${customerId}/team/${team.teamId}`}>
              <div
                className={`flex items-center justify-between gap-3 px-4 py-3 bg-card rounded-md hover-elevate active-elevate-2 cursor-pointer ${slaCardClass(team.slaStatus)}`}
                data-testid={`team-row-${team.teamId}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm font-medium truncate">{team.teamName}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="flex items-center gap-1" data-testid={`team-active-${team.teamId}`}>
                    <PhoneCall className={`w-3 h-3 ${team.activeCalls > 0 ? "text-emerald-500" : "text-muted-foreground"}`} />
                    <span className={`text-xs tabular-nums ${team.activeCalls > 0 ? "text-emerald-500 font-medium" : "text-muted-foreground"}`}>{team.activeCalls}</span>
                  </div>
                  <div className="flex items-center gap-1" data-testid={`team-waiting-${team.teamId}`}>
                    <PhoneIncoming className={`w-3 h-3 ${team.callsWaiting > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
                    <span className={`text-xs tabular-nums ${team.callsWaiting > 0 ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>{team.callsWaiting}</span>
                  </div>
                  <div className="flex items-center gap-1" data-testid={`team-wait-time-${team.teamId}`}>
                    <Clock className={`w-3 h-3 ${team.slaStatus === "breach" ? "text-red-500" : team.slaStatus === "warning" ? "text-amber-500" : "text-muted-foreground"}`} />
                    <span className={`text-xs tabular-nums ${team.slaStatus === "breach" ? "text-red-500 font-medium" : team.slaStatus === "warning" ? "text-amber-500" : "text-muted-foreground"}`}>
                      {formatWaitTime(team.avgWaitTime)}
                    </span>
                  </div>
                  {team.slaStatus === "breach" && (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" data-testid={`team-sla-breach-${team.teamId}`} />
                  )}
                  <Badge variant="secondary" className="text-xs tabular-nums gap-1">
                    <UserCheck className="w-3 h-3 text-emerald-500" />
                    {team.totalAvailable}/{team.totalMembers}
                  </Badge>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </div>
            </Link>
          ))}
          {teamsLoading && (
            <div className="col-span-2 py-12 text-center text-sm text-muted-foreground bg-card rounded-md">
              Loading teams...
            </div>
          )}
          {!teamsLoading && teamRows.length === 0 && (
            <div className="col-span-2 py-12 text-center text-sm text-muted-foreground bg-card rounded-md">
              No enabled teams found. Teams are managed in the admin panel.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
