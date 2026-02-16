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
