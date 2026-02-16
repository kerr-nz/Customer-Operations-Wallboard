# Spoke Phone — Live Operations Wallboard

## Overview
Real-time call activity dashboard that visualizes call data from the Spoke Phone platform. Receives webhook events, persists call data in PostgreSQL for durability across server restarts, and broadcasts updates to connected frontends via WebSocket. Data resets at midnight via node-cron.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI components
- **Backend**: Express server with WebSocket (ws library) + webhook handler
- **Data**: Individual calls are in-memory only (live ticker, capped at 100 most recent). Daily aggregate stats are persisted to PostgreSQL. Stats load from DB on startup. Resets at midnight via node-cron.
- **Map**: MapLibre GL JS with CARTO dark-matter tiles (lazy-loaded, fallback for no-WebGL environments)
- **Theme**: Dark mode by default, light mode toggle available
- **Privacy**: No personal data (names, phone numbers, emails, company names) is ever stored or displayed. Only city/country labels and coordinates are kept.

## Key Features
- MapLibre GL JS world map with animated arcs showing call flow between cities
- Country/region focus dropdown (Entire World, Australia, UK, NZ, US, Canada, Europe, Asia Pacific)
- Live KPI counters (total, active, inbound, outbound, answered, missed, answer rate)
- Sentiment analysis panel (Happy/Normal/Angry from AI content analysis)
- Recent calls feed showing city-to-city format (e.g., "Newcastle, UK -> Sydney, AU") with duration and sentiment
- Demo simulation endpoint for testing without real webhooks
- Daily stats persist across server restarts; call ticker is live/ephemeral

## Important Endpoints
- `POST /webhook` — Receives Spoke Phone webhook events (call.started, call.ended, call.answered, call.not_answered, content_analysis.completed)
- `GET /api/health` — Health check with current stats
- `POST /api/demo/simulate` — Simulates a demo call lifecycle (start -> answer -> end -> sentiment)
- `WS /ws` — WebSocket endpoint for real-time frontend updates

## Database Tables
- `wallboard_stats` — Stores aggregated daily statistics (one row per date with totals for calls, sentiment, duration)

## File Structure
- `shared/schema.ts` — TypeScript types for CallData, DailyStats, WSEvent
- `server/routes.ts` — Webhook handlers, WebSocket server, demo endpoint
- `server/webhookState.ts` — In-memory call ticker + PostgreSQL stats persistence (todayCalls Map, dailyStats, loadFromDb, persistStats)
- `server/geoLookup.ts` — Phone number to geographic coordinates mapping
- `client/src/pages/Dashboard.tsx` — Main dashboard page
- `client/src/components/WorldMap.tsx` — MapLibre GL JS world map with call arcs and region focus selector (lazy-loaded)
- `client/src/components/KPIStrip.tsx` — KPI counter cards
- `client/src/components/SentimentPanel.tsx` — Sentiment distribution
- `client/src/components/CallFeed.tsx` — Recent calls list (city-to-city format, no PII)
- `client/src/hooks/useWebSocket.ts` — WebSocket connection hook

## User Preferences
- Dark mode dashboard by default (wallboard style)
- Font: Outfit for headings, JetBrains Mono for tabular data
- No personal data displayed anywhere — only geographic labels
- Daily stats should persist even if browser is closed or server restarts
- Call ticker is live/ephemeral — no need to store individual calls in DB
