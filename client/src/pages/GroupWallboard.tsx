import { useWebSocket } from "@/hooks/useWebSocket";
import { KPIStrip } from "@/components/KPIStrip";
import { SentimentPanel } from "@/components/SentimentPanel";
import { CallFeed } from "@/components/CallFeed";
import { WorldMap } from "@/components/WorldMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Phone, Wifi, WifiOff, Sun, Moon, Users, ArrowRight, UserCheck, ArrowLeft, Loader2,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import type { TeamSummary, TeamGroup, DailyStats, TeamStats, CallData } from "@shared/schema";

interface GroupData {
  id: number;
  customerId: string;
  name: string;
  slug: string;
  teams: { teamId: string; teamName: string }[];
  teamStats: Record<string, TeamStats>;
  recentCalls: CallData[];
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

  if (groups.length === 0) return null;

  return (
    <Select
      value={currentSlug}
      onValueChange={(val) => {
        if (val === "company") {
          setLocation(`/${customerId}`);
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
  }
  return s;
}

export default function GroupWallboard({ customerId, groupSlug }: GroupWallboardProps) {
  const { calls, connected, customerName, defaultRegion, teams, teamStatsMap } = useWebSocket(customerId);
  const [group, setGroup] = useState<GroupData | null>(null);
  const [initialCalls, setInitialCalls] = useState<CallData[]>([]);
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
        setInitialCalls(data.recentCalls || []);
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

  const groupTeamIdSet = useMemo(() => new Set(groupTeamIds), [groupTeamIds]);

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

  const filteredCalls = useMemo(() => {
    const wsGroupCalls = calls.filter((c) => c.teamId && groupTeamIdSet.has(c.teamId));
    const seenIds = new Set(wsGroupCalls.map((c) => c.id));
    const combined = [...wsGroupCalls];
    for (const c of initialCalls) {
      if (!seenIds.has(c.id)) {
        combined.push(c);
        seenIds.add(c.id);
      }
    }
    combined.sort((a, b) => b.timestamp - a.timestamp);
    return combined.slice(0, 100);
  }, [calls, initialCalls, groupTeamIdSet]);

  const filteredCallsWithSentiment = useMemo(() => {
    let happy = 0, normal = 0, angry = 0;
    for (const c of filteredCalls) {
      if (c.sentiment === "Happy") happy++;
      else if (c.sentiment === "Angry") angry++;
      else if (c.sentiment === "Normal") normal++;
    }
    return { ...aggregatedStats, happy, normal, angry };
  }, [filteredCalls, aggregatedStats]);

  const filteredTeams = useMemo(() => {
    return teams.filter((t) => groupTeamIdSet.has(t.id));
  }, [teams, groupTeamIdSet]);

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
        <KPIStrip stats={filteredCallsWithSentiment} />

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredTeams.map((team) => (
                <Link key={team.id} href={`/${customerId}/team/${team.id}`}>
                  <div
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md hover-elevate active-elevate-2 cursor-pointer"
                    data-testid={`link-team-${team.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{team.displayName}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          <div className="lg:col-span-2 flex flex-col gap-4 min-h-0">
            <div className="flex-1 min-h-[280px]">
              <WorldMap calls={filteredCalls} activeCount={filteredCallsWithSentiment.active} defaultRegion={defaultRegion} />
            </div>
          </div>

          <div className="flex flex-col gap-4 min-h-0">
            <SentimentPanel stats={filteredCallsWithSentiment} />
            <div className="flex-1 min-h-[200px]">
              <CallFeed calls={filteredCalls} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
