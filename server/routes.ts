import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import cron from "node-cron";
import { phoneToCoords } from "./geoLookup";
import {
  todayCalls,
  dailyStats,
  resetState,
  getStats,
  getRecentCalls,
  loadFromDb,
  persistStats,
  addCall,
  statsNewCall,
  statsAnswer,
  statsEndCall,
  statsSentiment,
} from "./webhookState";
import type { CallData } from "@shared/schema";
import { log } from "./index";

let wss: WebSocketServer;

function broadcast(event: Record<string, unknown>) {
  const msg = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await loadFromDb();
  log(`Loaded stats from database (total: ${dailyStats.total})`, "db");

  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    log("Frontend connected via WebSocket", "ws");
    ws.send(
      JSON.stringify({
        type: "init",
        stats: getStats(),
        recentCalls: getRecentCalls(),
      })
    );
  });

  cron.schedule("0 0 * * *", () => {
    log("Midnight reset - clearing daily data", "cron");
    resetState();
    broadcast({ type: "reset", stats: getStats() });
  });

  app.post("/webhook", (req, res) => {
    const event = req.body;
    const eventType = event?.type;

    log(`Webhook received: ${eventType} (${event?.id})`, "webhook");

    try {
      switch (eventType) {
        case "call.started":
          handleCallStarted(event);
          break;
        case "call.answered":
          handleCallAnswered(event);
          break;
        case "call.ended":
        case "call.hungup":
          handleCallEnded(event);
          break;
        case "call.not_answered":
          handleCallNotAnswered(event);
          break;
        case "content_analysis.completed":
          handleContentAnalysis(event);
          break;
        default:
          log(`Unhandled event type: ${eventType}`, "webhook");
      }
    } catch (err) {
      console.error(`Error handling ${eventType}:`, err);
    }

    res.status(200).json({ received: true });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      calls: todayCalls.size,
      stats: getStats(),
      wsClients: wss.clients.size,
    });
  });

  app.post("/api/reset", async (_req, res) => {
    log("Manual reset triggered via API", "reset");
    await resetState();
    await persistStats();
    broadcast({ type: "reset", stats: getStats() });
    res.json({ status: "reset", stats: getStats() });
  });

  app.post("/api/demo/simulate", (_req, res) => {
    const phoneNumbers = [
      "+14155551234", "+12125559876", "+14085554321",
      "+13055558765", "+16505557654", "+12815553456",
      "+442079460000", "+61398765432", "+6421234567",
      "+441912345678", "+613987654321", "+6493216543",
    ];
    const companyNumbers = ["+18005551000", "+442012345678", "+61283456789"];

    const direction: "inbound" | "outbound" = Math.random() > 0.5 ? "inbound" : "outbound";
    const contactNum = phoneNumbers[Math.floor(Math.random() * phoneNumbers.length)];
    const companyNum = companyNumbers[Math.floor(Math.random() * companyNumbers.length)];
    const isInbound = direction === "inbound";

    const fromNum = isInbound ? contactNum : companyNum;
    const toNum = isInbound ? companyNum : contactNum;
    const fromCoords = phoneToCoords(fromNum);
    const toCoords = phoneToCoords(toNum);

    const callId = `demo-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    const callData: CallData = {
      id: callId,
      direction,
      status: "active",
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: new Date().toISOString(),
      timestamp: Date.now(),
      duration: null,
      durationText: null,
    };

    addCall(callData);
    statsNewCall(callId, direction);

    broadcast({ type: "call.started", call: callData, stats: getStats() });
    persistStats();

    setTimeout(() => {
      const existing = todayCalls.get(callId);
      if (existing && existing.status === "active") {
        existing.status = "answered";
        statsAnswer(callId);
        broadcast({ type: "call.answered", callId, stats: getStats() });
        persistStats();
      }
    }, 2000 + Math.random() * 3000);

    setTimeout(() => {
      const existing = todayCalls.get(callId);
      if (existing) {
        const duration = Math.floor(30 + Math.random() * 300);
        existing.status = "answered";
        existing.duration = duration;
        existing.durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;

        statsEndCall(callId, "answered", duration);

        broadcast({ type: "call.ended", call: existing, stats: getStats() });
        persistStats();

        setTimeout(() => {
          const sentiments: CallData["sentiment"][] = ["Happy", "Normal", "Normal", "Normal", "Angry"];
          const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
          if (existing && !existing.sentiment) {
            existing.sentiment = sentiment;
            statsSentiment(callId, sentiment!);

            broadcast({
              type: "sentiment.update",
              callId,
              sentiment,
              stats: getStats(),
            });
            persistStats();
          }
        }, 1000 + Math.random() * 2000);
      }
    }, 8000 + Math.random() * 12000);

    res.json({ callId, status: "simulated" });
  });

  return httpServer;
}

function handleCallStarted(event: any) {
  const call = event.data?.call;
  if (!call || call.isInternal) return;

  if (todayCalls.has(call.id)) return;

  const isInbound = call.direction === "inbound";
  const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
  const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
  const direction: "inbound" | "outbound" = call.direction;

  const callData: CallData = {
    id: call.id,
    direction,
    status: "active",
    sentiment: null,
    from: fromCoords,
    to: toCoords,
    fromLabel: fromCoords.name,
    toLabel: toCoords.name,
    startedAt: call.startedAt || new Date().toISOString(),
    timestamp: event.timestamp || Date.now(),
    duration: null,
    durationText: null,
  };

  addCall(callData);
  statsNewCall(call.id, direction);

  broadcast({ type: "call.started", call: callData, stats: getStats() });
  persistStats();
}

function handleCallAnswered(event: any) {
  const call = event.data?.call;
  if (!call) return;
  const existing = todayCalls.get(call.id);
  if (existing) {
    existing.status = "answered";
    existing.answeredAt = call.answeredAt;
    statsAnswer(call.id);
    broadcast({ type: "call.answered", callId: call.id, stats: getStats() });
    persistStats();
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
    const direction: "inbound" | "outbound" = call.direction || "inbound";

    const callData: CallData = {
      id: call.id,
      direction,
      status: "answered",
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: call.startedAt || new Date().toISOString(),
      timestamp: event.timestamp || Date.now(),
      duration: null,
      durationText: null,
      answeredAt: call.answeredAt,
    };

    addCall(callData);
    statsNewCall(call.id, direction);
    statsAnswer(call.id);

    broadcast({ type: "call.started", call: callData, stats: getStats() });
    persistStats();
  }
}

function handleCallEnded(event: any) {
  const call = event.data?.call;
  if (!call) return;
  const existing = todayCalls.get(call.id);

  if (existing) {
    const outcomeStatus = call.outcome?.status;
    const isAnswered = outcomeStatus === "answered" || outcomeStatus === "completed";

    if (isAnswered) {
      existing.status = "answered";
      statsAnswer(call.id);
    } else if (existing.status === "active") {
      existing.status = "missed";
    }

    const duration = call.duration ? Math.round(call.duration / 1000) : null;
    existing.duration = duration || existing.duration;
    existing.durationText = call.durationText || existing.durationText;

    statsEndCall(call.id, existing.status, duration);
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);
    const outcomeStatus = call.outcome?.status;
    const direction: "inbound" | "outbound" = call.direction || "inbound";
    const isAnswered = outcomeStatus === "answered" || outcomeStatus === "completed";
    const duration = call.duration ? Math.round(call.duration / 1000) : null;
    const finalStatus = isAnswered ? "answered" : "missed";

    const callData: CallData = {
      id: call.id,
      direction,
      status: finalStatus,
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: call.startedAt || new Date().toISOString(),
      timestamp: event.timestamp || Date.now(),
      duration,
      durationText: call.durationText || null,
    };
    addCall(callData);
    statsNewCall(call.id, direction);
    if (isAnswered) statsAnswer(call.id);
    statsEndCall(call.id, finalStatus, duration);
  }

  const finalCall = todayCalls.get(call.id);
  if (finalCall) {
    persistStats();
    broadcast({
      type: "call.ended",
      call: finalCall,
      stats: getStats(),
    });
  }
}

function handleCallNotAnswered(event: any) {
  const call = event.data?.call;
  if (!call) return;
  const existing = todayCalls.get(call.id);
  if (existing) {
    existing.status = "missed";
    statsEndCall(call.id, "missed", null);
    persistStats();
  }
  broadcast({ type: "call.not_answered", callId: call.id, stats: getStats() });
}

function handleContentAnalysis(event: any) {
  const ca = event.data?.contentAnalysis;
  if (!ca) return;
  const callId = ca.request?.source?.id;
  if (!callId) return;

  let sentiment: string | null = null;
  if (ca.artifacts && ca.artifacts.length > 0) {
    for (const artifact of ca.artifacts) {
      const data = artifact.data || {};
      if (data.sentiment) {
        sentiment = data.sentiment;
        break;
      }
      if (artifact.schema === "sentiment" && data.value) {
        sentiment = data.value;
        break;
      }
      if (data.customerSentiment) {
        sentiment = data.customerSentiment;
        break;
      }
    }
  }

  if (!sentiment) return;

  const existing = todayCalls.get(callId);
  if (existing && !existing.sentiment) {
    existing.sentiment = sentiment as CallData["sentiment"];
    statsSentiment(callId, sentiment);

    persistStats();

    broadcast({
      type: "sentiment.update",
      callId,
      sentiment,
      stats: getStats(),
    });
  }
}
