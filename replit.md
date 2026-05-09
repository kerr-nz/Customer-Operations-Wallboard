# Spoke Phone — Multi-Tenant Live Operations Wallboard

## Overview
Multi-tenant real-time call activity dashboard platform for Spoke Phone, serving ~800 customers. Each customer receives a unique webhook endpoint, branded dashboard, and optional IP allowlisting. A company-wide global wallboard aggregates all customer data for Spoke internal use. Receives webhook events, persists call data in PostgreSQL for durability across server restarts, and broadcasts updates to connected frontends via WebSocket. Data resets at midnight via node-cron.

## Architecture
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI components
- **Backend**: Express server with WebSocket (ws library) + webhook handler
- **Auth**: Replit Auth (OIDC with Google SSO support) + role-based authorization (admin/viewer)
- **Multi-tenancy**: Map<customerId, TenantState> for in-memory isolation per customer
- **Data**: Individual calls are in-memory only (live ticker, capped at 100 most recent per tenant). Daily aggregate stats are persisted to PostgreSQL per customer. Stats load from DB on startup. Resets at midnight via node-cron.
- **Map**: MapLibre GL JS with CARTO dark-matter tiles (lazy-loaded, fallback for no-WebGL environments)
- **Theme**: Dark mode by default, light mode toggle available
- **Privacy**: Caller identity (contact name, phone number, agent name) is shown on live dashboards only and is never persisted. Only aggregated daily stats and city/country labels are stored.

## Key Features
- Multi-tenant architecture with per-customer data isolation
- Admin interface for customer CRUD operations (create, edit, pause, delete)
- Per-customer branded dashboards ("Spoke - {Customer Name}")
- **Team-level drill-down wallboards** with per-team KPIs, agent roster, and active calls queue
- Teams auto-discovered from webhook data (assignedCallGroup, team.availability.updated)
- Team KPIs: In Queue, In Conversation, Completed, Missed %, Avg Call Duration, Avg Wait Time
- Real-time agent roster with availability status (Available, Busy, Ringing, Offline) and status duration
- Per-team active calls queue with live/completed call tracking
- **Team Groups (Sub-Wallboards)**: Organize teams into named groups (e.g., "BMW Exeter", "Ford Durham") for focused manager views
- Team groups auto-render on customer dashboard when configured, replacing individual team navigation
- Each group gets a unique URL: /:customerId/group/:groupSlug
- Admin CRUD for groups with team membership management via checkbox dialog
- **Team Board view** (/:customerId/teams) listing all enabled teams with availability, calls waiting, avg wait time, and SLA status
- Per-team SLA answer time threshold (configurable in admin), with visual indicators: ok (no color), warning (amber at 80%), breach (red)
- Team navigation on customer dashboard showing team cards with availability indicators (falls back when no groups exist)
- Global Spoke wallboard aggregating all customer data with customer dropdown filter
- IP allowlisting per customer (individual IPs and CIDR notation)
- MapLibre GL JS world map with animated arcs showing call flow between cities
- Country/region focus dropdown (Entire World, Australia, UK, NZ, US, Canada, Europe, Asia Pacific)
- Live KPI counters grouped by direction: Total/Active, Inbound (answered, missed %, avg call duration), Outbound (answered %, unanswered %)
- Avg call durations (per-direction) persist across server restarts and reset at midnight, at both customer and team levels
- Sentiment analysis panel (Happy/Normal/Angry from AI content analysis)
- Recent calls feed showing caller identity (contact name or number) → agent name (when answered/completed), with city route, duration, and sentiment as secondary info
- Per-customer timezone configuration for localized midnight resets
- Global Spoke wallboard timezone setting (configurable in admin) — resets all customer data at midnight in Spoke's timezone
- Demo simulation endpoints: per-customer calls, team availability, and team calls
- Daily stats persist across server restarts; call ticker is live/ephemeral
- Stats date keying aligned with customer's local timezone
- Google SSO authentication for Spoke employees
- Role-based access control: Admin (manage customers + users) and Viewer (view wallboard)
- User management in admin UI (add/remove authorized emails, assign roles)

## Authentication & Authorization
- Replit Auth with Google SSO support (OIDC)
- Two roles: **admin** (full access to /admin + /spoke) and **viewer** (access to /spoke only)
- authorized_users table stores email + role pairs
- Bootstrap mode: if no users exist, any authenticated user gets admin access
- Once first user is added, only authorized emails can access the portal
- Customer dashboards (/:customerId) remain public — no login required
- Webhook endpoints remain public — need to receive data from Spoke Phone

## Routes
- `/` or `/admin` — Admin interface for customer management (requires auth + admin role)
- `/spoke` — Global Spoke wallboard (requires auth, any authorized role)
- `/:customerId` — Customer-specific branded dashboard (public)
- `/:customerId/teams` — Team Board listing all enabled teams with SLA status (public)
- `/:customerId/team/:teamId` — Team-specific drill-down wallboard (public)
- `/:customerId/group/:groupSlug` — Group-specific sub-wallboard (public)

## Important Endpoints
- `POST /webhook/:customerId` — Receives Spoke Phone webhook events per customer (public)
- `GET /api/health` — Global health check (public)
- `GET /api/customers/:customerId/health` — Customer-specific health check (public)
- `GET /api/customers/:customerId` — Customer info for frontend branding (public)
- `POST /api/customers/:customerId/demo/simulate` — Simulates a demo call lifecycle (public)
- `POST /api/customers/:customerId/demo/team-availability` — Simulates team availability update (public)
- `POST /api/customers/:customerId/demo/team-call` — Simulates a team-assigned call (public)
- `POST /api/customers/:customerId/reset` — Manual reset for a customer (public)
- `GET /api/auth/me` — Current user's authorization level (requires auth)
- `GET /api/admin/customers` — List all customers (requires admin)
- `POST /api/admin/customers` — Create customer (requires admin)
- `PATCH /api/admin/customers/:customerId` — Update customer (requires admin)
- `DELETE /api/admin/customers/:customerId` — Delete customer (requires admin)
- `GET /api/admin/users` — List authorized users (requires admin)
- `POST /api/admin/users` — Add authorized user (requires admin)
- `PATCH /api/admin/users/:userId` — Update user role (requires admin)
- `DELETE /api/admin/users/:userId` — Remove authorized user (requires admin)
- `GET /api/admin/settings` — Get app settings including spoke_timezone (requires admin)
- `PATCH /api/admin/settings` — Update app settings (requires admin)
- `GET /api/admin/customers/:customerId/teams` — List all discovered teams for a customer (requires admin)
- `PATCH /api/admin/customers/:customerId/teams/:teamId` — Enable/disable team visibility (requires admin)
- `GET /api/customers/:customerId/teams` — List enabled teams for a customer (public, used by dashboard)
- `GET /api/admin/customers/:customerId/groups` — List all groups for a customer (requires admin)
- `POST /api/admin/customers/:customerId/groups` — Create group (requires admin)
- `PATCH /api/admin/customers/:customerId/groups/:groupId` — Rename group (requires admin)
- `DELETE /api/admin/customers/:customerId/groups/:groupId` — Delete group (requires admin)
- `GET /api/admin/customers/:customerId/groups/:groupId/teams` — List enabled teams with membership for group (requires admin)
- `PUT /api/admin/customers/:customerId/groups/:groupId/teams` — Update group team membership (requires admin)
- `GET /api/customers/:customerId/groups` — List groups for a customer (public)
- `GET /api/customers/:customerId/groups/:slug` — Get group details with teams (public)
- `WS /ws/:customerId` — WebSocket endpoint for customer-specific real-time updates
- `WS /ws/:customerId/team/:teamId` — WebSocket endpoint for team-specific real-time updates
- `WS /ws/_spoke` — WebSocket endpoint for global aggregated real-time updates

## Database Tables
- `customers` — Customer records (id, name, active, ip_allowlist, timezone, last_reset_date, created_at)
- `wallboard_stats` — Aggregated daily statistics per customer (composite key: customer_id + date, date uses customer's local timezone)
- `authorized_users` — Email-based access control (id, email, role, added_by, created_at)
- `users` — Replit Auth user records (id, email, first_name, last_name, profile_image_url)
- `sessions` — Server-side session storage for Replit Auth (sid, sess, expire)
- `app_settings` — Key-value application settings (spoke_timezone, spoke_last_reset_date)
- `customer_teams` — Auto-discovered teams per customer with billing visibility control (id, customer_id, team_id, team_name, enabled, created_at)
- `customer_team_groups` — Named team groups per customer for sub-wallboards (id, customer_id, name, slug, created_at; unique on customer_id+slug)
- `customer_team_group_members` — Join table mapping teams to groups (id, group_id, customer_id, team_id; unique on group_id+team_id)

## File Structure
- `shared/schema.ts` — TypeScript types for CallData, DailyStats, Customer, AuthorizedUser, WSEvent
- `shared/models/auth.ts` — Drizzle schema for users and sessions tables
- `server/routes.ts` — Webhook handlers, WebSocket server (per-tenant + global), admin API, auth middleware, user management API
- `server/webhookState.ts` — In-memory call ticker + PostgreSQL stats persistence per tenant, global aggregation functions
- `server/geoLookup.ts` — Phone number to geographic coordinates mapping
- `server/db.ts` — Drizzle database client for auth storage
- `server/auth/` — Google OIDC auth integration (passport, session, storage)
- `client/src/App.tsx` — Router with auth-protected /admin, /spoke and public /:customerId routes
- `client/src/pages/LoginPage.tsx` — Login page for unauthenticated users
- `client/src/pages/Admin.tsx` — Customer management admin interface + user management section
- `client/src/pages/Dashboard.tsx` — Customer-specific branded dashboard
- `client/src/pages/SpokeWallboard.tsx` — Global Spoke wallboard with customer dropdown filter
- `client/src/pages/TeamWallboard.tsx` — Team-specific drill-down wallboard with KPIs, agent roster, and calls queue
- `client/src/pages/GroupWallboard.tsx` — Group-specific sub-wallboard showing team cards for selected teams
- `client/src/hooks/use-auth.ts` — React hook for authentication state
- `client/src/lib/auth-utils.ts` — Auth error handling utilities
- `client/src/components/WorldMap.tsx` — MapLibre GL JS world map with call arcs and region focus selector
- `client/src/components/KPIStrip.tsx` — KPI counter cards
- `client/src/components/SentimentPanel.tsx` — Sentiment distribution
- `client/src/components/CallFeed.tsx` — Recent calls list (city-to-city format, no PII)
- `client/src/hooks/useWebSocket.ts` — WebSocket connection hook (per-customer)

## User Preferences
- Dark mode dashboard by default (wallboard style)
- Font: Outfit for headings, JetBrains Mono for tabular data
- Caller identity (contact name/number, agent name) is live-only — displayed on dashboards but never persisted
- Daily stats (including avg call durations) should persist even if browser is closed or server restarts
- Call ticker is live/ephemeral — no need to store individual calls in DB
