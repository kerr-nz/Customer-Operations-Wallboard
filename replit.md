# Spoke Phone — Live Operations Wallboard

## Overview
Real-time call activity dashboard that visualizes call data from the Spoke Phone platform. Receives webhook events, stores them in-memory (resets at midnight), and broadcasts updates to connected frontends via WebSocket.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI components
- **Backend**: Express server with WebSocket (ws library) + webhook handler
- **Data**: In-memory storage (Map) — no database needed. Resets at midnight via node-cron.
- **Theme**: Dark mode by default, light mode toggle available

## Key Features
- World map with animated SVG arcs showing call flow
- Live KPI counters (total, active, inbound, outbound, answered, missed, answer rate)
- Sentiment analysis panel (Happy/Normal/Angry from AI content analysis)
- Recent calls feed with agent, company, duration, and sentiment info
- Demo simulation endpoint for testing without real webhooks

## Important Endpoints
- `POST /webhook` — Receives Spoke Phone webhook events (call.started, call.ended, call.answered, call.not_answered, content_analysis.completed)
- `GET /api/health` — Health check with current stats
- `POST /api/demo/simulate` — Simulates a demo call lifecycle (start → answer → end → sentiment)
- `WS /ws` — WebSocket endpoint for real-time frontend updates

## File Structure
- `shared/schema.ts` — TypeScript types for CallData, DailyStats, WSEvent
- `server/routes.ts` — Webhook handlers, WebSocket server, demo endpoint
- `server/webhookState.ts` — In-memory state (todayCalls Map, dailyStats)
- `server/geoLookup.ts` — Phone number to geographic coordinates mapping
- `client/src/pages/Dashboard.tsx` — Main dashboard page
- `client/src/components/WorldMap.tsx` — SVG world map with call arcs
- `client/src/components/KPIStrip.tsx` — KPI counter cards
- `client/src/components/SentimentPanel.tsx` — Sentiment distribution
- `client/src/components/CallFeed.tsx` — Recent calls list
- `client/src/hooks/useWebSocket.ts` — WebSocket connection hook

## User Preferences
- Dark mode dashboard by default (wallboard style)
- Font: Outfit for headings, JetBrains Mono for tabular data
