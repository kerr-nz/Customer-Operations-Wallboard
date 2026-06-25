import { useWebSocket } from "@/hooks/useWebSocket";
import { KPIStrip } from "@/components/KPIStrip";
import { Badge } from "@/components/ui/badge";
import { ViewToggle } from "@/components/ViewToggle";
import { WallboardHeader } from "@/components/WallboardHeader";
import {
  Phone, PhoneCall, Users, UserCheck, ArrowRight, Clock, AlertTriangle,
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "wouter";
import type { TeamSummary } from "@shared/schema";
import { useBackNav } from "@/lib/nav";
import { aggregateTeamStats, getSlaStatus, formatWaitTime, slaCardClass } from "@/lib/teamStats";

interface EnabledTeam {
  teamId: string;
  teamName: string;
  slaAnswerSeconds: number | null;
}

interface TeamBoardProps {
  customerId: string;
}

export default function TeamBoard({ customerId }: TeamBoardProps) {
  const { connected, customerName, teams, teamStatsMap } = useWebSocket(customerId);
  const [enabledTeams, setEnabledTeams] = useState<EnabledTeam[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [, navigate] = useLocation();
  const { showBack, goBack } = useBackNav();

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

  const [companyName, setCompanyName] = useState("Your Company Name");

  useEffect(() => {
    fetch(`/api/customers/${customerId}`)
      .then((res) => res.json())
      .then((data) => { if (data?.companyName) setCompanyName(data.companyName); })
      .catch(() => {});
  }, [customerId]);

  const displayName = customerName ? `${companyName} - ${customerName}` : companyName;

  useEffect(() => {
    document.title = displayName;
  }, [displayName]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <WallboardHeader
        logo={
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <Phone className="w-4 h-4 text-primary-foreground" />
          </div>
        }
        title={displayName}
        subtitle="Live Operations"
        connected={connected}
        viewToggle={<ViewToggle customerId={customerId} activeView="team" />}
        showBack={showBack}
        onBack={() => goBack(navigate)}
      />

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
