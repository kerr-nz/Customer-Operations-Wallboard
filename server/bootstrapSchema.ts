// Startup schema bootstrap for fresh installs (self-hosted customer copies).
//
// A brand-new copy of this project starts with a completely empty database.
// Nothing else creates the core tables (drizzle-kit push is interactive and
// can't run unattended), so this module creates every table the app needs,
// idempotently, before the session store or the startup migrations in
// server/routes.ts touch the database. On an existing database every
// statement is a no-op.
//
// IMPORTANT: keep this in sync with the live schema. When a startup migration
// in server/routes.ts adds a column to an existing table, add the same column
// here so fresh installs get it from day one.

import pg from "pg";

const SCHEMA_STATEMENTS: string[] = [
  // Session storage (connect-pg-simple has createTableIfMissing: false).
  `CREATE TABLE IF NOT EXISTS sessions (
    sid varchar PRIMARY KEY,
    sess jsonb NOT NULL,
    expire timestamp NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire)`,

  // Users: presence = authorized; role admin/viewer; password set on first sign-in.
  `CREATE TABLE IF NOT EXISTS users (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(255) UNIQUE,
    first_name varchar(255),
    last_name varchar(255),
    profile_image_url varchar(500),
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    password_hash varchar,
    role varchar NOT NULL DEFAULT 'viewer' CONSTRAINT users_role_check CHECK (role IN ('admin', 'viewer'))
  )`,

  // Customer records (one per tenant).
  `CREATE TABLE IF NOT EXISTS customers (
    id varchar(64) PRIMARY KEY,
    name varchar(200) NOT NULL,
    active boolean NOT NULL DEFAULT true,
    ip_allowlist text[] NOT NULL DEFAULT '{}',
    created_at timestamp NOT NULL DEFAULT now(),
    timezone varchar(64) NOT NULL DEFAULT 'UTC',
    last_reset_date varchar(10),
    default_region varchar(32) NOT NULL DEFAULT 'world'
  )`,

  // Aggregated daily stats per customer.
  `CREATE TABLE IF NOT EXISTS wallboard_stats (
    customer_id varchar(64) NOT NULL DEFAULT '_default',
    date date NOT NULL DEFAULT CURRENT_DATE,
    total integer NOT NULL DEFAULT 0,
    active integer NOT NULL DEFAULT 0,
    inbound integer NOT NULL DEFAULT 0,
    outbound integer NOT NULL DEFAULT 0,
    answered integer NOT NULL DEFAULT 0,
    missed integer NOT NULL DEFAULT 0,
    happy integer NOT NULL DEFAULT 0,
    normal integer NOT NULL DEFAULT 0,
    angry integer NOT NULL DEFAULT 0,
    total_duration integer NOT NULL DEFAULT 0,
    inbound_answered integer NOT NULL DEFAULT 0,
    outbound_answered integer NOT NULL DEFAULT 0,
    inbound_total_duration integer NOT NULL DEFAULT 0,
    inbound_duration_count integer NOT NULL DEFAULT 0,
    outbound_total_duration integer NOT NULL DEFAULT 0,
    outbound_duration_count integer NOT NULL DEFAULT 0,
    avg_call_duration_inbound integer NOT NULL DEFAULT 0,
    avg_call_duration_outbound integer NOT NULL DEFAULT 0,
    PRIMARY KEY (customer_id, date)
  )`,

  // Aggregated daily stats per team.
  `CREATE TABLE IF NOT EXISTS team_daily_stats (
    customer_id varchar NOT NULL,
    team_id varchar NOT NULL,
    date date NOT NULL,
    total integer NOT NULL DEFAULT 0,
    inbound integer NOT NULL DEFAULT 0,
    outbound integer NOT NULL DEFAULT 0,
    answered integer NOT NULL DEFAULT 0,
    missed integer NOT NULL DEFAULT 0,
    inbound_answered integer NOT NULL DEFAULT 0,
    outbound_answered integer NOT NULL DEFAULT 0,
    total_duration integer NOT NULL DEFAULT 0,
    total_wait_time integer NOT NULL DEFAULT 0,
    answered_with_wait integer NOT NULL DEFAULT 0,
    inbound_total_duration integer NOT NULL DEFAULT 0,
    inbound_duration_count integer NOT NULL DEFAULT 0,
    outbound_total_duration integer NOT NULL DEFAULT 0,
    outbound_duration_count integer NOT NULL DEFAULT 0,
    avg_call_duration_inbound integer NOT NULL DEFAULT 0,
    avg_call_duration_outbound integer NOT NULL DEFAULT 0,
    PRIMARY KEY (customer_id, team_id, date)
  )`,

  // Key-value app settings.
  `CREATE TABLE IF NOT EXISTS app_settings (
    key varchar PRIMARY KEY,
    value varchar NOT NULL
  )`,

  // Auto-discovered teams per customer.
  `CREATE TABLE IF NOT EXISTS customer_teams (
    id serial PRIMARY KEY,
    customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    team_id varchar NOT NULL,
    team_name varchar NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now(),
    sla_answer_seconds integer,
    UNIQUE (customer_id, team_id)
  )`,

  // Named team groups (sub-wallboards) + membership join table.
  `CREATE TABLE IF NOT EXISTS customer_team_groups (
    id serial PRIMARY KEY,
    customer_id varchar NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name varchar NOT NULL,
    slug varchar NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (customer_id, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_team_group_members (
    id serial PRIMARY KEY,
    group_id integer NOT NULL REFERENCES customer_team_groups(id) ON DELETE CASCADE,
    customer_id varchar NOT NULL,
    team_id varchar NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (group_id, team_id)
  )`,

  // Rolling per-team recent-call history (ticker survives restarts). One row
  // per (customer, team, call); pruned to the newest ~30 per team; wiped at
  // each customer's midnight rollover. Mirrored in routes.ts startup block.
  `CREATE TABLE IF NOT EXISTS team_recent_calls (
    customer_id varchar NOT NULL,
    team_id varchar NOT NULL,
    call_id varchar NOT NULL,
    date varchar(10) NOT NULL,
    call jsonb NOT NULL,
    ts bigint NOT NULL,
    PRIMARY KEY (customer_id, team_id, call_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_recent_calls_team_ts ON team_recent_calls (customer_id, team_id, ts DESC)`,

  // Single-use password reset tokens (also created idempotently in routes.ts).
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar NOT NULL,
    token_hash varchar NOT NULL UNIQUE,
    expires_at timestamp NOT NULL,
    used boolean NOT NULL DEFAULT false,
    created_at timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id)`,
];

export async function ensureSchema(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    for (const stmt of SCHEMA_STATEMENTS) {
      await pool.query(stmt);
    }
    console.log("[schema] Database schema verified (all tables present)");
  } catch (err) {
    console.error(
      "\n[schema] FATAL: Failed to create or verify the database schema.\n" +
        "  Check that DATABASE_URL points to a reachable PostgreSQL database\n" +
        "  and that the database user can create tables.\n",
      err
    );
    throw err;
  } finally {
    await pool.end();
  }
}
