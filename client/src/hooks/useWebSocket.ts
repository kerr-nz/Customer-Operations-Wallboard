import { useEffect, useRef, useState, useCallback } from "react";
import type { WSEvent, DailyStats, CallData, TeamSummary, TeamStats } from "@shared/schema";

const INITIAL_STATS: DailyStats = {
  total: 0, active: 0, inbound: 0, outbound: 0,
  answered: 0, missed: 0,
  inboundAnswered: 0, outboundAnswered: 0,
  happy: 0, normal: 0, angry: 0,
  totalDuration: 0,
};

export function useWebSocket(customerId: string) {
  const [stats, setStats] = useState<DailyStats>(INITIAL_STATS);
  const [calls, setCalls] = useState<CallData[]>([]);
  const [connected, setConnected] = useState(false);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [defaultRegion, setDefaultRegion] = useState<string>("world");
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamStatsMap, setTeamStatsMap] = useState<Record<string, TeamStats>>({});
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${customerId}`);
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

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setLastEvent(data);

        if (data.customerName) {
          setCustomerName(data.customerName);
        }

        switch (data.type) {
          case "init":
            setStats(data.stats);
            setCalls(data.recentCalls);
            if (data.customerName) setCustomerName(data.customerName);
            if (data.defaultRegion) setDefaultRegion(data.defaultRegion);
            if (data.teams) setTeams(data.teams);
            if (data.teamStatsMap) setTeamStatsMap(data.teamStatsMap);
            break;

          case "team.availability":
            if (data.summary) {
              setTeams(prev => {
                const exists = prev.find(t => t.id === data.summary.id);
                if (exists) return prev.map(t => t.id === data.summary.id ? data.summary : t);
                return [...prev, data.summary];
              });
            }
            break;

          case "team.stats":
            if (data.teamId && data.stats) {
              setTeamStatsMap(prev => ({ ...prev, [data.teamId]: data.stats }));
            }
            break;

          case "call.started":
            setStats(data.stats);
            setCalls((prev) => [data.call, ...prev].slice(0, 50));
            break;

          case "call.answered":
            setStats(data.stats);
            setCalls((prev) =>
              prev.map((c) =>
                c.id === data.callId ? { ...c, status: "answered" as const } : c
              )
            );
            break;

          case "call.ended":
            setStats(data.stats);
            setCalls((prev) => {
              const exists = prev.find((c) => c.id === data.call.id);
              if (exists) {
                return prev.map((c) => (c.id === data.call.id ? data.call : c));
              }
              return [data.call, ...prev].slice(0, 50);
            });
            break;

          case "call.not_answered":
            setStats(data.stats);
            setCalls((prev) =>
              prev.map((c) =>
                c.id === data.callId ? { ...c, status: "missed" as const } : c
              )
            );
            break;

          case "sentiment.update":
            setStats(data.stats);
            setCalls((prev) =>
              prev.map((c) =>
                c.id === data.callId
                  ? { ...c, sentiment: data.sentiment as CallData["sentiment"] }
                  : c
              )
            );
            break;

          case "reset":
            setStats(data.stats);
            setCalls([]);
            setTeamStatsMap({});
            break;
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };
  }, [customerId]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return { stats, calls, connected, customerName, defaultRegion, teams, teamStatsMap, lastEvent };
}
