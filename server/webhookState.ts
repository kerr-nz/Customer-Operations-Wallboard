import type { CallData, DailyStats } from "@shared/schema";

export let todayCalls = new Map<string, CallData>();

export let dailyStats: DailyStats = {
  total: 0,
  active: 0,
  inbound: 0,
  outbound: 0,
  answered: 0,
  missed: 0,
  happy: 0,
  normal: 0,
  angry: 0,
  totalDuration: 0,
};

export function resetState() {
  todayCalls.clear();
  dailyStats = {
    total: 0,
    active: 0,
    inbound: 0,
    outbound: 0,
    answered: 0,
    missed: 0,
    happy: 0,
    normal: 0,
    angry: 0,
    totalDuration: 0,
  };
}

export function getStats(): DailyStats {
  return { ...dailyStats };
}

export function getRecentCalls(limit = 30): CallData[] {
  return [...todayCalls.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}
