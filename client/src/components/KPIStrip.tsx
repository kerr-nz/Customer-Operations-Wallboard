import { Card } from "@/components/ui/card";
import type { DailyStats, TeamStats } from "@shared/schema";
import {
  Phone,
  PhoneMissed,
  Activity,
  CheckCircle,
  Clock,
  Headphones,
  Timer,
} from "lucide-react";

function CallReceivedIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
      <path d="M200-200v-400h80v264l464-464 56 56-464 464h264v80H200Z" />
    </svg>
  );
}

function CallMadeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
      <path d="m216-160-56-56 464-464H360v-80h400v400h-80v-264L216-160Z" />
    </svg>
  );
}

interface KPICardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
  compact?: boolean;
  outbound?: boolean;
  testIdSuffix?: string;
  testId?: string;
}

function KPICard({ label, value, icon, color, subtitle, compact, outbound, testIdSuffix, testId }: KPICardProps) {
  const resolvedTestId = testId ?? `kpi-value-${label.toLowerCase().replace(/\s+/g, "-")}${testIdSuffix || ""}`;
  return (
    <Card className={`relative overflow-visible ${compact ? "p-3" : "p-4"} flex flex-col gap-1.5 min-w-0${outbound ? " bg-white/[0.06] dark:bg-white/[0.06]" : ""}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <div className={`${color}`}>{icon}</div>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <span
          className={`${compact ? "text-xl" : "text-2xl"} font-bold tabular-nums leading-none`}
          data-testid={resolvedTestId}
        >
          {value}
        </span>
        {subtitle && (
          <span className="text-xs text-muted-foreground mb-0.5">{subtitle}</span>
        )}
      </div>
    </Card>
  );
}

function formatDurationMs(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

interface KPIStripProps {
  stats: DailyStats | TeamStats;
  variant?: "default" | "team";
}

function BaseKPIRows({ s, teamExtras }: { s: DailyStats | TeamStats; teamExtras?: React.ReactNode }) {
  const inboundMissed = Math.max(0, s.inbound - s.inboundAnswered);
  const inboundMissedPct = s.inbound > 0 ? Math.round((inboundMissed / s.inbound) * 100) : 0;
  const outboundAnsweredPct = s.outbound > 0 ? Math.round((s.outboundAnswered / s.outbound) * 100) : 0;
  const inboundAvg = s.avgCallDurationInbound ?? 0;
  const outboundAvg = s.avgCallDurationOutbound ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <KPICard
          label="Total Calls"
          value={s.total}
          icon={<Phone className="w-4 h-4" />}
          color="text-chart-1"
        />
        <KPICard
          label="Active"
          value={s.active}
          icon={<Activity className="w-4 h-4" />}
          color="text-chart-2"
          subtitle="live now"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
        <KPICard
          label="Inbound Calls"
          value={s.inbound}
          icon={<CallReceivedIcon className="w-3.5 h-3.5" />}
          color="text-chart-4"
          compact
        />
        <KPICard
          label="Answered"
          value={s.inboundAnswered}
          icon={<CheckCircle className="w-3.5 h-3.5" />}
          color="text-chart-2"
          compact
          testIdSuffix="-inbound"
          testId="kpi-value-inbound-answered-inbound"
        />
        <KPICard
          label="% Missed"
          value={`${inboundMissedPct}%`}
          icon={<PhoneMissed className="w-3.5 h-3.5" />}
          color="text-chart-5"
          compact
          subtitle={`${inboundMissed}`}
          testId="kpi-value-missed-%-inbound"
        />
        <KPICard
          label="Avg Duration"
          value={formatDurationMs(inboundAvg)}
          icon={<Clock className="w-3.5 h-3.5" />}
          color="text-chart-1"
          compact
          testId="kpi-value-avg-call-duration-inbound"
        />
        <KPICard
          label="Outbound Calls"
          value={s.outbound}
          icon={<CallMadeIcon className="w-3.5 h-3.5" />}
          color="text-chart-3"
          compact
          outbound
        />
        <KPICard
          label="% Answered"
          value={`${outboundAnsweredPct}%`}
          icon={<CheckCircle className="w-3.5 h-3.5" />}
          color="text-chart-2"
          compact
          outbound
          testIdSuffix="-outbound"
          testId="kpi-value-outbound-answered-outbound"
          subtitle={`${s.outboundAnswered}`}
        />
        <KPICard
          label="Avg Duration"
          value={formatDurationMs(outboundAvg)}
          icon={<Clock className="w-3.5 h-3.5" />}
          color="text-chart-1"
          compact
          outbound
          testId="kpi-value-outbound-avg-duration-outbound"
        />
      </div>

      {teamExtras}
    </div>
  );
}

export function KPIStrip({ stats, variant = "default" }: KPIStripProps) {
  if (variant === "team") {
    const t = stats as TeamStats;
    const avgWait = t.liveWaitAvg ?? 0;

    const teamExtras = (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="kpi-strip-team-extras">
        <KPICard
          label="In Queue"
          value={t.callsWaiting}
          icon={<Activity className="w-3.5 h-3.5" />}
          color="text-amber-500 dark:text-amber-400"
          subtitle="ringing now"
          compact
        />
        <KPICard
          label="In Conversation"
          value={Math.max(0, t.active - t.callsWaiting)}
          icon={<Headphones className="w-3.5 h-3.5" />}
          color="text-emerald-500 dark:text-emerald-400"
          subtitle="talking"
          compact
        />
        <KPICard
          label="Completed"
          value={Math.max(0, t.total - t.active)}
          icon={<CheckCircle className="w-3.5 h-3.5" />}
          color="text-chart-1"
          subtitle="today"
          compact
        />
        <KPICard
          label="Avg Wait"
          value={avgWait > 0 ? `${avgWait}s` : "--"}
          icon={<Timer className="w-3.5 h-3.5" />}
          color="text-chart-3"
          subtitle="to answer"
          compact
        />
      </div>
    );

    return (
      <div data-testid="kpi-strip-team">
        <BaseKPIRows s={t} teamExtras={teamExtras} />
      </div>
    );
  }

  return (
    <div data-testid="kpi-strip">
      <BaseKPIRows s={stats as DailyStats} />
    </div>
  );
}
