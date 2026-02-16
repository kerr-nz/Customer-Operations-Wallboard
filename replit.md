# Spoke Phone — Multi-Tenant Live Operations Wallboard

## Overview
Multi-tenant real-time call activity dashboard platform for Spoke Phone, serving ~800 customers. Each customer receives a unique webhook endpoint, branded dashboard, and optional IP allowlisting. A company-wide global wallboard aggregates all customer data for Spoke internal use. Receives webhook events, persists call data in PostgreSQL for durability across server restarts, and broadcasts updates to connected frontends via WebSocket. Data resets at midnight via node-cron.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI components
- **Backend**: Express server with WebSocket (ws library) + webhook handler
- **Multi-tenancy**: Map<customerId, TenantState> for in-memory isolation per customer
- **Data**: Individual calls are in-memory only (live ticker, capped at 100 most recent per tenant). Daily aggregate stats are persisted to PostgreSQL per customer. Stats load from DB on startup. Resets at midnight via node-cron.
- **Map**: MapLibre GL JS with CARTO dark-matter tiles (lazy-loaded, fallback for no-WebGL environments)
- **Theme**: Dark mode by default, light mode toggle available
- **Privacy**: No personal data (names, phone numbers, emails, company names) is ever stored or displayed. Only city/country labels and coordinates are kept.

## Key Features
- Multi-tenant architecture with per-customer data isolation
- Admin interface for customer CRUD operations (create, edit, pause, delete)
- Per-customer branded dashboards ("Spoke - {Customer Name}")
- Global Spoke wallboard aggregating all customer data with customer dropdown filter
- IP allowlisting per customer (individual IPs and CIDR notation)
- MapLibre GL JS world map with animated arcs showing call flow between cities
- Country/region focus dropdown (Entire World, Australia, UK, NZ, US, Canada, Europe, Asia Pacific)
- Live KPI counters (total, active, inbound, outbound, answered, missed, answer rate)
- Sentiment analysis panel (Happy/Normal/Angry from AI content analysis)
- Recent calls feed showing city-to-city format with duration and sentiment
- Demo simulation endpoint per customer for testing without real webhooks
- Daily stats persist across server restarts; call ticker is live/ephemeral

## Routes
- `/` or `/admin` — Admin interface for customer management
- `/spoke` — Global Spoke wallboard (aggregated view across all customers, with customer filter dropdown)
- `/:customerId` — Customer-specific branded dashboard

## Important Endpoints
- `POST /webhook/:customerId` — Receives Spoke Phone webhook events per customer
- `GET /api/health` — Global health check
- `GET /api/customers/:customerId/health` — Customer-specific health check
- `GET /api/customers/:customerId` — Customer info for frontend branding
- `POST /api/customers/:customerId/demo/simulate` — Simulates a demo call lifecycle
- `POST /api/customers/:customerId/reset` — Manual reset for a customer
- `GET /api/admin/customers` — List all customers
- `POST /api/admin/customers` — Create customer
- `PATCH /api/admin/customers/:customerId` — Update customer
- `DELETE /api/admin/customers/:customerId` — Delete customer
- `WS /ws/:customerId` — WebSocket endpoint for customer-specific real-time updates
- `WS /ws/_spoke` — WebSocket endpoint for global aggregated real-time updates

## Database Tables
- `customers` — Customer records (id, name, active, ip_allowlist, created_at)
- `wallboard_stats` — Aggregated daily statistics per customer (composite key: customer_id + date)

## File Structure
- `shared/schema.ts` — TypeScript types for CallData, DailyStats, Customer, WSEvent
- `server/routes.ts` — Webhook handlers, WebSocket server (per-tenant + global), admin API, demo endpoint
- `server/webhookState.ts` — In-memory call ticker + PostgreSQL stats persistence per tenant, global aggregation functions
- `server/geoLookup.ts` — Phone number to geographic coordinates mapping
- `client/src/App.tsx` — Router with /admin, /spoke, /:customerId routes
- `client/src/pages/Admin.tsx` — Customer management admin interface
- `client/src/pages/Dashboard.tsx` — Customer-specific branded dashboard
- `client/src/pages/SpokeWallboard.tsx` — Global Spoke wallboard with customer dropdown filter
- `client/src/components/WorldMap.tsx` — MapLibre GL JS world map with call arcs and region focus selector
- `client/src/components/KPIStrip.tsx` — KPI counter cards
- `client/src/components/SentimentPanel.tsx` — Sentiment distribution
- `client/src/components/CallFeed.tsx` — Recent calls list (city-to-city format, no PII)
- `client/src/hooks/useWebSocket.ts` — WebSocket connection hook (per-customer)

## User Preferences
- Dark mode dashboard by default (wallboard style)
- Font: Outfit for headings, JetBrains Mono for tabular data
- No personal data displayed anywhere — only geographic labels
- Daily stats should persist even if browser is closed or server restarts
- Call ticker is live/ephemeral — no need to store individual calls in DB
