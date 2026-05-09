import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CallData } from "@shared/schema";
import {
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  SmilePlus,
  Meh,
  Frown,
  ArrowRight,
  Users,
} from "lucide-react";

interface CallFeedProps {
  calls: CallData[];
}

export function CallFeed({ calls }: CallFeedProps) {
  return (
    <Card className="p-4 flex flex-col gap-3 h-full" data-testid="call-feed">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Recent Calls
        </h3>
        <Badge variant="secondary" className="text-xs tabular-nums">
          {calls.length}
        </Badge>
      </div>

      <ScrollArea className="flex-1 -mx-1 px-1">
        {calls.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No calls yet today
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {calls.map((call) => (
              <CallItem key={call.id} call={call} />
            ))}
          </div>
        )}
      </ScrollArea>
    </Card>
  );
}

function getStatusInfo(call: CallData): { label: string; colorClass: string; bgClass: string; isLive: boolean } {
  if (call.status === "active") {
    return { label: "Ringing", colorClass: "text-emerald-500 dark:text-emerald-400", bgClass: "bg-emerald-500/5 dark:bg-emerald-400/5", isLive: true };
  }
  if (call.status === "answered" && call.duration == null) {
    return { label: "Talking", colorClass: "text-amber-500 dark:text-amber-400", bgClass: "bg-amber-500/5 dark:bg-amber-400/5", isLive: true };
  }
  if (call.status === "missed") {
    return { label: "Missed", colorClass: "text-rose-500 dark:text-rose-400", bgClass: "", isLive: false };
  }
  return { label: "Completed", colorClass: "text-indigo-400 dark:text-indigo-300", bgClass: "", isLive: false };
}

function CallItem({ call }: { call: CallData }) {
  const isInbound = call.direction === "inbound";
  const { label, colorClass, bgClass, isLive } = getStatusInfo(call);

  const sentimentIcon = call.sentiment
    ? call.sentiment === "Happy"
      ? <SmilePlus className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
      : call.sentiment === "Angry"
        ? <Frown className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
        : <Meh className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
    : null;

  return (
    <div
      className={`flex items-start gap-3 p-2.5 rounded-md transition-colors ${bgClass}`}
      data-testid={`call-item-${call.id}`}
    >
      <div className={`mt-0.5 ${isInbound ? "text-chart-4" : "text-chart-3"}`}>
        {isInbound ? (
          <PhoneIncoming className="w-4 h-4" />
        ) : (
          <PhoneOutgoing className="w-4 h-4" />
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate" data-testid={`call-caller-${call.id}`}>
            {call.contactName ?? call.contactNumber ?? "—"}
          </span>
          {(call.status === "answered" || call.status === "ended") && call.agentName && (
            <>
              <ArrowRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium truncate text-muted-foreground" data-testid={`call-agent-${call.id}`}>
                {call.agentName}
              </span>
            </>
          )}
          {isLive && (
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${call.status === "active" ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${call.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`} />
            </span>
          )}
          {sentimentIcon}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span className="flex items-center gap-1 truncate" data-testid={`call-route-${call.id}`}>
            {call.fromLabel} → {call.toLabel}
          </span>
          {call.teamName && (
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {call.teamName}
            </span>
          )}
          {call.duration !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {call.durationText || formatSeconds(call.duration)}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className={`text-[10px] font-medium uppercase ${colorClass}`}>
          {label}
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {formatTime(call.startedAt)}
        </span>
      </div>
    </div>
  );
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
