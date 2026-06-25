import type { DailyStats, TeamStats } from "@shared/schema";

export const EMPTY_STATS: DailyStats = {
  total: 0, active: 0, inbound: 0, outbound: 0,
  answered: 0, missed: 0, inboundAnswered: 0, outboundAnswered: 0,
  happy: 0, normal: 0, angry: 0, totalDuration: 0,
  inboundTotalDuration: 0, inboundDurationCount: 0, avgCallDurationInbound: 0,
  outboundTotalDuration: 0, outboundDurationCount: 0, avgCallDurationOutbound: 0,
};

export function aggregateTeamStats(teamIds: string[], statsMap: Record<string, TeamStats>): DailyStats {
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

export type SlaStatus = "ok" | "warning" | "breach";

export function getSlaStatus(avgWaitTime: number, slaSeconds: number | null): SlaStatus {
  if (slaSeconds === null || slaSeconds <= 0) return "ok";
  if (avgWaitTime >= slaSeconds) return "breach";
  if (avgWaitTime >= slaSeconds * 0.8) return "warning";
  return "ok";
}

export function formatWaitTime(seconds: number): string {
  if (seconds === 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function slaCardClass(status: SlaStatus): string {
  switch (status) {
    case "breach":
      return "border-l-[3px] border-l-red-500 bg-red-500/5";
    case "warning":
      return "border-l-[3px] border-l-amber-500 bg-amber-500/5";
    default:
      return "";
  }
}
