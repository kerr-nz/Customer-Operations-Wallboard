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
  persistCall,
  persistStats,
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
  log(`Loaded ${todayCalls.size} calls from database`, "db");

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

  app.post("/api/demo/simulate", (_req, res) => {
    const phoneNumbers = [
      "+14155551234", "+12125559876", "+14085554321",
      "+13055558765", "+16505557654", "+12815553456",
      "+442079460000", "+61398765432", "+6421234567",
      "+441912345678", "+613987654321", "+6493216543",
    ];
    const companyNumbers = ["+18005551000", "+442012345678", "+61283456789"];

    const direction = Math.random() > 0.5 ? "inbound" : "outbound";
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
      direction: direction as "inbound" | "outbound",
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

    todayCalls.set(callId, callData);
    dailyStats.total++;
    dailyStats.active++;
    if (isInbound) dailyStats.inbound++;
    else dailyStats.outbound++;

    broadcast({ type: "call.started", call: callData, stats: getStats() });
    persistCall(callData);
    persistStats();

    setTimeout(() => {
      const existing = todayCalls.get(callId);
      if (existing && existing.status === "active") {
        existing.status = "answered";
        dailyStats.answered++;
        broadcast({ type: "call.answered", callId, stats: getStats() });
        persistCall(existing);
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

        dailyStats.active = Math.max(0, dailyStats.active - 1);
        dailyStats.totalDuration += duration;

        broadcast({ type: "call.ended", call: existing, stats: getStats() });
        persistCall(existing);
        persistStats();

        setTimeout(() => {
          const sentiments: CallData["sentiment"][] = ["Happy", "Normal", "Normal", "Normal", "Angry"];
          const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];
          if (existing && !existing.sentiment) {
            existing.sentiment = sentiment;
            const key = sentiment!.toLowerCase();
            if (key === "happy") dailyStats.happy++;
            else if (key === "angry") dailyStats.angry++;
            else dailyStats.normal++;

            broadcast({
              type: "sentiment.update",
              callId,
              sentiment,
              stats: getStats(),
            });
            persistCall(existing);
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

  const isInbound = call.direction === "inbound";
  const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
  const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);

  const callData: CallData = {
    id: call.id,
    direction: call.direction,
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

  todayCalls.set(call.id, callData);
  dailyStats.total++;
  dailyStats.active++;
  if (isInbound) dailyStats.inbound++;
  else dailyStats.outbound++;

  broadcast({ type: "call.started", call: callData, stats: getStats() });
  persistCall(callData);
  persistStats();
}

function handleCallAnswered(event: any) {
  const call = event.data?.call;
  if (!call) return;
  const existing = todayCalls.get(call.id);
  if (existing) {
    existing.status = "answered";
    existing.answeredAt = call.answeredAt;
    dailyStats.answered++;
    broadcast({ type: "call.answered", callId: call.id, stats: getStats() });
    persistCall(existing);
    persistStats();
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);

    const callData: CallData = {
      id: call.id,
      direction: call.direction || "inbound",
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

    todayCalls.set(call.id, callData);
    dailyStats.total++;
    dailyStats.active++;
    dailyStats.answered++;
    if (isInbound) dailyStats.inbound++;
    else dailyStats.outbound++;

    broadcast({ type: "call.started", call: callData, stats: getStats() });
    persistCall(callData);
    persistStats();
  }
}

function handleCallEnded(event: any) {
  const call = event.data?.call;
  if (!call) return;
  const existing = todayCalls.get(call.id);

  if (existing) {
    existing.status = (call.outcome?.status as CallData["status"]) || "ended";
    existing.duration = call.duration ? Math.round(call.duration / 1000) : null;
    existing.durationText = call.durationText || null;

    dailyStats.active = Math.max(0, dailyStats.active - 1);
    if (existing.status === "answered") {
      if (!existing.answeredAt) dailyStats.answered++;
    } else {
      dailyStats.missed++;
    }
    if (existing.duration) {
      dailyStats.totalDuration += existing.duration;
    }
  } else if (!call.isInternal) {
    const isInbound = call.direction === "inbound";
    const fromCoords = phoneToCoords(isInbound ? call.contactNumber : call.companyNumber);
    const toCoords = phoneToCoords(isInbound ? call.companyNumber : call.contactNumber);

    const callData: CallData = {
      id: call.id,
      direction: call.direction || "inbound",
      status: (call.outcome?.status as CallData["status"]) || "ended",
      sentiment: null,
      from: fromCoords,
      to: toCoords,
      fromLabel: fromCoords.name,
      toLabel: toCoords.name,
      startedAt: call.startedAt || new Date().toISOString(),
      timestamp: event.timestamp || Date.now(),
      duration: call.duration ? Math.round(call.duration / 1000) : null,
      durationText: call.durationText || null,
    };
    todayCalls.set(call.id, callData);
    dailyStats.total++;
    if (isInbound) dailyStats.inbound++;
    else dailyStats.outbound++;
    if (callData.status === "answered") dailyStats.answered++;
    else dailyStats.missed++;
    if (callData.duration) dailyStats.totalDuration += callData.duration;
    persistCall(callData);
  }

  const finalCall = todayCalls.get(call.id);
  if (finalCall) {
    persistCall(finalCall);
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
    dailyStats.active = Math.max(0, dailyStats.active - 1);
    dailyStats.missed++;
    persistCall(existing);
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
    const key = sentiment.toLowerCase();
    if (key === "happy") dailyStats.happy++;
    else if (key === "angry") dailyStats.angry++;
    else dailyStats.normal++;

    persistCall(existing);
    persistStats();

    broadcast({
      type: "sentiment.update",
      callId,
      sentiment,
      stats: getStats(),
    });
  }
}
