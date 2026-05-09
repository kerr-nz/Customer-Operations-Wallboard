import { useWebSocket } from "@/hooks/useWebSocket";
import { KPIStrip } from "@/components/KPIStrip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Phone, PhoneCall, Wifi, WifiOff, Sun, Moon, Users, ArrowRight, UserCheck, ArrowLeft, Loader2,
  PhoneIncoming, Clock, AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import type { TeamGroup, DailyStats, TeamStats, CallData } from "@shared/schema";

interface GroupData {
  id: number;
  customerId: string;
  name: string;
  slug: string;
  teams: { teamId: string; teamName: string; slaAnswerSeconds: number | null }[];
  teamStats: Record<string, TeamStats>;
  recentCalls: CallData[];
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
    case "breach": return "border-l-[3px] border-l-red-500 bg-red-500/5";
    case "warning": return "border-l-[3px] border-l-amber-500 bg-amber-500/5";
    default: return "";
  }
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

function SubBoardSelector({ customerId, currentSlug }: { customerId: string; currentSlug: string }) {
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
      value={currentSlug}
      onValueChange={(val) => {
        if (val === "company") {
          setLocation(`/${customerId}`);
        } else if (val === "all-teams") {
          setLocation(`/${customerId}/teams`);
        } else if (val !== currentSlug) {
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

interface GroupWallboardProps {
  customerId: string;
  groupSlug: string;
}

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

export default function GroupWallboard({ customerId, groupSlug }: GroupWallboardProps) {
  const { connected, customerName, teams, teamStatsMap } = useWebSocket(customerId);
  const [group, setGroup] = useState<GroupData | null>(null);
  const [initialTeamStats, setInitialTeamStats] = useState<Record<string, TeamStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/customers/${customerId}/groups/${groupSlug}`)
      .then((res) => {
        if (!res.ok) throw new Error("Group not found");
        return res.json();
      })
      .then((data: GroupData) => {
        setGroup(data);
        setInitialTeamStats(data.teamStats || {});
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [customerId, groupSlug]);

  const groupTeamIds = useMemo(() => {
    if (!group) return [] as string[];
    return group.teams.map((t) => t.teamId);
  }, [group]);

  const mergedTeamStats = useMemo(() => {
    const merged = { ...initialTeamStats };
    for (const tid of groupTeamIds) {
      if (teamStatsMap[tid]) {
        merged[tid] = teamStatsMap[tid];
      }
    }
    return merged;
  }, [initialTeamStats, teamStatsMap, groupTeamIds]);

  const aggregatedStats = useMemo(() => {
    return aggregateTeamStats(groupTeamIds, mergedTeamStats);
  }, [groupTeamIds, mergedTeamStats]);


  const filteredTeams = useMemo(() => {
    if (!group) return [];
    const wsTeamMap = new Map(teams.map((t) => [t.id, t]));
    return group.teams
      .map((gt) => {
        const ws = wsTeamMap.get(gt.teamId);
        const ts = mergedTeamStats[gt.teamId];
        const liveWait = ts?.liveWaitAvg ?? 0;
        return {
          id: gt.teamId,
          displayName: ws?.displayName || gt.teamName,
          totalMembers: ws?.totalMembers ?? 0,
          totalAvailable: ws?.totalAvailable ?? 0,
          activeCalls: ts?.active ?? 0,
          callsWaiting: ts?.callsWaiting ?? 0,
          avgWaitTime: liveWait,
          slaAnswerSeconds: gt.slaAnswerSeconds,
          slaStatus: getSlaStatus(liveWait, gt.slaAnswerSeconds),
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [group, teams, mergedTeamStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <p className="text-muted-foreground">{error || "Group not found"}</p>
        <Link href={`/${customerId}`}>
          <Button variant="outline" data-testid="button-back-to-dashboard">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const displayName = customerName
    ? `${customerName} - ${group.name}`
    : group.name;

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
              <h1 className="text-sm font-semibold leading-none" data-testid="text-group-name">{displayName}</h1>
              <p className="text-xs text-muted-foreground leading-none mt-0.5">
                Group Wallboard
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <SubBoardSelector customerId={customerId} currentSlug={groupSlug} />
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

        <Card className="p-4 flex flex-col gap-3" data-testid="group-team-nav">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {group.name} Teams ({filteredTeams.length})
            </h3>
          </div>
          {filteredTeams.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No team data available yet. Teams will appear here as activity comes in.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filteredTeams.map((team) => (
                <Link key={team.id} href={`/${customerId}/team/${team.id}`}>
                  <div
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover-elevate active-elevate-2 cursor-pointer ${slaCardClass(team.slaStatus)}`}
                    data-testid={`link-team-${team.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{team.displayName}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="flex items-center gap-1">
                        <PhoneCall className={`w-3 h-3 ${team.activeCalls > 0 ? "text-emerald-500" : "text-muted-foreground"}`} />
                        <span className={`text-xs tabular-nums ${team.activeCalls > 0 ? "text-emerald-500 font-medium" : "text-muted-foreground"}`}>{team.activeCalls}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <PhoneIncoming className={`w-3 h-3 ${team.callsWaiting > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
                        <span className={`text-xs tabular-nums ${team.callsWaiting > 0 ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>{team.callsWaiting}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className={`w-3 h-3 ${team.slaStatus === "breach" ? "text-red-500" : team.slaStatus === "warning" ? "text-amber-500" : "text-muted-foreground"}`} />
                        <span className={`text-xs tabular-nums ${team.slaStatus === "breach" ? "text-red-500 font-medium" : team.slaStatus === "warning" ? "text-amber-500" : "text-muted-foreground"}`}>
                          {formatWaitTime(team.avgWaitTime)}
                        </span>
                      </div>
                      {team.slaStatus === "breach" && (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
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
            </div>
          )}
        </Card>

      </main>
    </div>
  );
}
