import { useWebSocket } from "@/hooks/useWebSocket";
import { KPIStrip } from "@/components/KPIStrip";
import { SentimentPanel } from "@/components/SentimentPanel";
import { CallFeed } from "@/components/CallFeed";
import { WorldMap } from "@/components/WorldMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Phone, Wifi, WifiOff, Sun, Moon, Users, ArrowRight, UserCheck, ArrowLeft, Loader2,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import type { TeamSummary, TeamGroupWithTeams } from "@shared/schema";

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

interface GroupWallboardProps {
  customerId: string;
  groupSlug: string;
}

export default function GroupWallboard({ customerId, groupSlug }: GroupWallboardProps) {
  const { stats, calls, connected, customerName, defaultRegion, teams } = useWebSocket(customerId);
  const [group, setGroup] = useState<TeamGroupWithTeams | null>(null);
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
      .then((data: TeamGroupWithTeams) => {
        setGroup(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [customerId, groupSlug]);

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

  const groupTeamIds = new Set(group.teams.map((t) => t.teamId));
  const filteredTeams = teams.filter((t) => groupTeamIds.has(t.id));

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
        <KPIStrip stats={stats} />

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
