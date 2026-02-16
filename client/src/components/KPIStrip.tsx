import { Card } from "@/components/ui/card";
import type { DailyStats } from "@shared/schema";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Activity,
  Clock,
  CheckCircle,
} from "lucide-react";

interface KPICardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}

function KPICard({ label, value, icon, color, subtitle }: KPICardProps) {
  return (
    <Card className="relative overflow-visible p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <div className={`${color}`}>{icon}</div>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <span
          className="text-2xl font-bold tabular-nums leading-none"
          data-testid={`kpi-value-${label.toLowerCase().replace(/\s+/g, "-")}`}
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

function formatDuration(totalSeconds: number): string {
  if (totalSeconds === 0) return "0s";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatAvgDuration(total: number, count: number): string {
  if (count === 0) return "0s";
  return formatDuration(Math.round(total / count));
}

interface KPIStripProps {
  stats: DailyStats;
}

export function KPIStrip({ stats }: KPIStripProps) {
  const answerRate =
    stats.total > 0
      ? Math.round((stats.answered / stats.total) * 100)
      : 0;

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3"
      data-testid="kpi-strip"
    >
      <KPICard
        label="Total Calls"
        value={stats.total}
        icon={<Phone className="w-4 h-4" />}
        color="text-chart-1"
      />
      <KPICard
        label="Active"
        value={stats.active}
        icon={<Activity className="w-4 h-4" />}
        color="text-chart-2"
        subtitle="live now"
      />
      <KPICard
        label="Inbound"
        value={stats.inbound}
        icon={<PhoneIncoming className="w-4 h-4" />}
        color="text-chart-4"
      />
      <KPICard
        label="Outbound"
        value={stats.outbound}
        icon={<PhoneOutgoing className="w-4 h-4" />}
        color="text-chart-3"
      />
      <KPICard
        label="Answered"
        value={stats.answered}
        icon={<CheckCircle className="w-4 h-4" />}
        color="text-chart-2"
      />
      <KPICard
        label="Missed"
        value={stats.missed}
        icon={<PhoneMissed className="w-4 h-4" />}
        color="text-chart-5"
      />
      <KPICard
        label="Answer Rate"
        value={`${answerRate}%`}
        icon={<Clock className="w-4 h-4" />}
        color="text-chart-1"
        subtitle={`avg ${formatAvgDuration(stats.totalDuration, stats.answered)}`}
      />
    </div>
  );
}
