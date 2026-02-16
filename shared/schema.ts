import { z } from "zod";

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
}

export interface DailyStats {
  total: number;
  active: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  happy: number;
  normal: number;
  angry: number;
  totalDuration: number;
}

export interface Customer {
  id: string;
  name: string;
  active: boolean;
  ipAllowlist: string[];
  createdAt: string;
}

export const insertCustomerSchema = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Must be lowercase alphanumeric with hyphens, at least 2 characters"),
  name: z.string().min(1).max(200),
  active: z.boolean().default(true),
  ipAllowlist: z.array(z.string()).default([]),
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

export type WSEvent =
  | WSInitEvent
  | WSCallStartedEvent
  | WSCallAnsweredEvent
  | WSCallEndedEvent
  | WSCallNotAnsweredEvent
  | WSSentimentUpdateEvent
  | WSResetEvent;
