import { useEffect, useRef, useState, useCallback } from "react";
import type { WSEvent, DailyStats, CallData } from "@shared/schema";

const INITIAL_STATS: DailyStats = {
  total: 0, active: 0, inbound: 0, outbound: 0,
  answered: 0, missed: 0,
  happy: 0, normal: 0, angry: 0,
  totalDuration: 0,
};

export function useWebSocket() {
  const [stats, setStats] = useState<DailyStats>(INITIAL_STATS);
  const [calls, setCalls] = useState<CallData[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
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
        const data: WSEvent = JSON.parse(event.data);
        setLastEvent(data);

        switch (data.type) {
          case "init":
            setStats(data.stats);
            setCalls(data.recentCalls);
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
            break;
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    };
  }, []);

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

  return { stats, calls, connected, lastEvent };
}
