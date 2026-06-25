import { useWebSocket } from "@/hooks/useWebSocket";
import { KPIStrip } from "@/components/KPIStrip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ViewToggle } from "@/components/ViewToggle";
import { WallboardHeader } from "@/components/WallboardHeader";
import {
  PhoneCall, Users, ArrowRight, UserCheck, ArrowLeft, Loader2,
  Clock, AlertTriangle,
} from "lucide-react";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useBackNav } from "@/lib/nav";
import type { TeamStats, CallData } from "@shared/schema";
import { aggregateTeamStats, getSlaStatus, formatWaitTime, slaCardClass } from "@/lib/teamStats";

interface GroupData {
  id: number;
  customerId: string;
  name: string;
  slug: string;
  teams: { teamId: string; teamName: string; slaAnswerSeconds: number | null }[];
  teamStats: Record<string, TeamStats>;
  recentCalls: CallData[];
}

interface GroupWallboardProps {
  customerId: string;
  groupSlug: string;
}

export default function GroupWallboard({ customerId, groupSlug }: GroupWallboardProps) {
  const { connected, customerName, teams, teamStatsMap } = useWebSocket(customerId);
  const [group, setGroup] = useState<GroupData | null>(null);
  const [initialTeamStats, setInitialTeamStats] = useState<Record<string, TeamStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { showBack, goBack } = useBackNav();

  useEffect(() => {
    fetch("/api/public/settings")
      .then((r) => r.json())
      .then((d) => setLogoUrl(d?.logoUrl || null))
      .catch(() => {});
  }, []);

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
      <WallboardHeader
        logo={<CompanyLogo logoUrl={logoUrl} size={32} />}
        title={displayName}
        titleTestId="text-group-name"
        subtitle="Group Wallboard"
        connected={connected}
        viewToggle={<ViewToggle customerId={customerId} activeView="team" activeSlug={groupSlug} />}
        showBack={showBack}
        onBack={() => goBack(navigate)}
      />

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
