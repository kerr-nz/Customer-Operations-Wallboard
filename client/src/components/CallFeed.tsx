import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CallData } from "@shared/schema";
import {
  PhoneIncoming,
  PhoneOutgoing,
  User,
  Building2,
  Clock,
  SmilePlus,
  Meh,
  Frown,
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

function CallItem({ call }: { call: CallData }) {
  const isInbound = call.direction === "inbound";
  const isActive = call.status === "active";

  const sentimentIcon = call.sentiment
    ? call.sentiment === "Happy"
      ? <SmilePlus className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
      : call.sentiment === "Angry"
        ? <Frown className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
        : <Meh className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
    : null;

  const statusColor = isActive
    ? "text-emerald-500 dark:text-emerald-400"
    : call.status === "missed"
      ? "text-rose-500 dark:text-rose-400"
      : "text-muted-foreground";

  return (
    <div
      className={`flex items-start gap-3 p-2.5 rounded-md transition-colors ${
        isActive ? "bg-emerald-500/5 dark:bg-emerald-400/5" : ""
      }`}
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
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {call.contactName || call.contactNumber}
          </span>
          {isActive && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          )}
          {sentimentIcon}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          {call.agent && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {call.agent}
            </span>
          )}
          {call.company && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {call.company}
            </span>
          )}
          {call.duration !== null && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {call.durationText || formatSeconds(call.duration)}
            </span>
          )}
        </div>

        {call.summary && (
          <p className="text-xs text-muted-foreground/80 truncate mt-0.5">
            {call.summary}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end gap-1">
        <span className={`text-[10px] font-medium uppercase ${statusColor}`}>
          {isActive ? "Live" : call.status}
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
