import { z } from "zod";

export * from "./models/auth";

export interface AuthorizedUser {
  id: string;
  email: string;
  role: "admin" | "viewer";
  createdAt: string;
  hasPassword?: boolean;
}

export const insertAuthorizedUserSchema = z.object({
  email: z.string().email().min(1),
  role: z.enum(["admin", "viewer"]).default("viewer"),
});

export type InsertAuthorizedUser = z.infer<typeof insertAuthorizedUserSchema>;

export interface CustomerTeam {
  id: number;
  customerId: string;
  teamId: string;
  teamName: string;
  enabled: boolean;
  slaAnswerSeconds: number | null;
  createdAt: string;
}

export interface TeamGroup {
  id: number;
  customerId: string;
  name: string;
  slug: string;
  createdAt: string;
  teamCount?: number;
}

export interface TeamGroupWithTeams extends TeamGroup {
  teams: { teamId: string; teamName: string }[];
}

export interface Coordinates {
  lat: number;
  lng: number;
  name: string;
}

export interface CallData {
  id: string;
  direction: "inbound" | "outbound";
  status: "active" | "answered" | "ended" | "missed";
  sentiment: "Happy" | "Normal" | "Angry" | null;
  from: Coordinates;
  to: Coordinates;
  fromLabel: string;
  toLabel: string;
  startedAt: string;
  timestamp: number;
  duration: number | null;
  durationText: string | null;
  answeredAt?: string;
  teamId?: string;
  teamName?: string;
  agentId?: string;
  agentName?: string;
  contactName?: string;
  contactNumber?: string;
}

export interface DailyStats {
  total: number;
  active: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  inboundAnswered: number;
  outboundAnswered: number;
  happy: number;
  normal: number;
  angry: number;
  totalDuration: number;
  inboundTotalDuration: number;
  inboundDurationCount: number;
  outboundTotalDuration: number;
  outboundDurationCount: number;
  avgCallDurationInbound: number;
  avgCallDurationOutbound: number;
  // Live count of inbound calls currently ringing for a queue (started without
  // a directoryTarget, not yet answered/ended). Ephemeral — never persisted.
  callsInQueue?: number;
  // Live count of ALL calls currently ringing (started, not yet answered or
  // ended — any direction). Ephemeral — never persisted.
  ringing?: number;
}

export const REGION_OPTIONS = [
  "world", "australia", "united_kingdom", "new_zealand",
  "united_states", "canada", "europe", "asia_pacific",
] as const;

export const REGION_LABELS: Record<string, string> = {
  world: "Entire World",
  australia: "Australia",
  united_kingdom: "United Kingdom",
  new_zealand: "New Zealand",
  united_states: "United States",
  canada: "Canada",
  europe: "Europe",
  asia_pacific: "Asia Pacific",
};

export interface Customer {
  id: string;
  name: string;
  active: boolean;
  ipAllowlist: string[];
  timezone: string;
  defaultRegion: string;
  createdAt: string;
}

export const TIMEZONES = [
  "Pacific/Auckland", "Pacific/Fiji", "Pacific/Chatham",
  "Australia/Sydney", "Australia/Brisbane", "Australia/Adelaide",
  "Australia/Darwin", "Australia/Perth",
  "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong",
  "Asia/Singapore", "Asia/Kolkata", "Asia/Dubai",
  "Europe/Moscow", "Europe/Istanbul", "Europe/Helsinki",
  "Europe/Berlin", "Europe/Paris", "Europe/London",
  "Atlantic/Reykjavik", "America/Sao_Paulo",
  "America/Buenos_Aires", "America/New_York", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "America/Anchorage",
  "Pacific/Honolulu", "UTC",
] as const;

export const insertCustomerSchema = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Must be lowercase alphanumeric with hyphens, at least 2 characters"),
  name: z.string().min(1).max(200),
  active: z.boolean().default(true),
  ipAllowlist: z.array(z.string()).default([]),
  timezone: z.string().default("UTC"),
  defaultRegion: z.string().default("world"),
});

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

export interface WSInitEvent {
  type: "init";
  stats: DailyStats;
  recentCalls: CallData[];
}

export interface WSCallStartedEvent {
  type: "call.started";
  call: CallData;
  stats: DailyStats;
}

export interface WSCallAnsweredEvent {
  type: "call.answered";
  callId: string;
  stats: DailyStats;
}

export interface WSCallEndedEvent {
  type: "call.ended";
  call: CallData;
  stats: DailyStats;
}

export interface WSCallNotAnsweredEvent {
  type: "call.not_answered";
  callId: string;
  stats: DailyStats;
}

export interface WSSentimentUpdateEvent {
  type: "sentiment.update";
  callId: string;
  sentiment: string;
  stats: DailyStats;
}

export interface WSResetEvent {
  type: "reset";
  stats: DailyStats;
}

export interface WSStatsUpdateEvent {
  type: "stats.update";
  stats: DailyStats;
}

export interface WSCallUpdatedEvent {
  type: "call.updated";
  callId: string;
  call: CallData;
}

export type WSEvent =
  | WSInitEvent
  | WSCallStartedEvent
  | WSCallAnsweredEvent
  | WSCallEndedEvent
  | WSCallNotAnsweredEvent
  | WSSentimentUpdateEvent
  | WSResetEvent
  | WSStatsUpdateEvent
  | WSTeamAvailabilityEvent
  | WSCallUpdatedEvent;

export interface AgentAvailability {
  status: "available" | "busy" | "offline" | "ringing";
  statusAt: string;
  statusTimestamp: number;
  availabilitySummary: string;
  notAvailableReason?: string;
  callId?: string;
}

export interface TeamAgent {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string;
  location?: string;
  loginStatus: "loggedIn" | "loggedOut";
  availability: AgentAvailability;
}

export interface TeamSummary {
  id: string;
  displayName: string;
  totalMembers: number;
  totalAvailable: number;
  status: string;
  availabilitySummary: string;
}

export interface TeamStats {
  total: number;
  // `active` = all live calls (ringing + talking). Kept for aggregation into
  // DailyStats.active ("live now"). For team-card metrics use the disambiguated
  // `ringing` (waiting to be answered) and `talking` (connected) fields below.
  active: number;
  // Calls currently ringing / waiting to be answered (derived from waitingCalls).
  ringing: number;
  // Calls agents are connected/talking on right now (active minus ringing).
  talking: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  inboundAnswered: number;
  outboundAnswered: number;
  totalDuration: number;
  totalWaitTime: number;
  answeredWithWait: number;
  liveWaitAvg?: number;
  inboundTotalDuration: number;
  inboundDurationCount: number;
  outboundTotalDuration: number;
  outboundDurationCount: number;
  avgCallDurationInbound: number;
  avgCallDurationOutbound: number;
}

export interface TeamState {
  summary: TeamSummary;
  agents: TeamAgent[];
  stats: TeamStats;
}

export interface WSTeamAvailabilityEvent {
  type: "team.availability";
  teamId: string;
  summary: TeamSummary;
  agents: TeamAgent[];
  stats: TeamStats;
}
