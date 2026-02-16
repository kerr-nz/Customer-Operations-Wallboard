import { Card } from "@/components/ui/card";
import type { DailyStats } from "@shared/schema";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Activity,
  CheckCircle,
  TrendingUp,
} from "lucide-react";

interface KPICardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
  compact?: boolean;
  testIdSuffix?: string;
}

function KPICard({ label, value, icon, color, subtitle, compact, testIdSuffix }: KPICardProps) {
  return (
    <Card className={`relative overflow-visible ${compact ? "p-3" : "p-4"} flex flex-col gap-1.5 min-w-0`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <div className={`${color}`}>{icon}</div>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <span
          className={`${compact ? "text-xl" : "text-2xl"} font-bold tabular-nums leading-none`}
          data-testid={`kpi-value-${label.toLowerCase().replace(/\s+/g, "-")}${testIdSuffix || ""}`}
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

interface KPIStripProps {
  stats: DailyStats;
}

export function KPIStrip({ stats }: KPIStripProps) {
  const inboundAnswerRate =
    stats.inbound > 0
      ? Math.round((stats.inboundAnswered / stats.inbound) * 100)
      : 0;

  const outboundAnswerRate =
    stats.outbound > 0
      ? Math.round((stats.outboundAnswered / stats.outbound) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-3" data-testid="kpi-strip">
      <div className="grid grid-cols-2 gap-3">
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <PhoneIncoming className="w-3.5 h-3.5 text-chart-4" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" data-testid="label-inbound-group">
              Inbound
            </span>
            <span className="text-xs text-muted-foreground">— team performance</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KPICard
              label="Inbound"
              value={stats.inbound}
              icon={<PhoneIncoming className="w-3.5 h-3.5" />}
              color="text-chart-4"
              compact
            />
            <KPICard
              label="Answered"
              value={stats.inboundAnswered}
              icon={<CheckCircle className="w-3.5 h-3.5" />}
              color="text-chart-2"
              compact
              testIdSuffix="-inbound"
            />
            <KPICard
              label="Missed"
              value={stats.missed}
              icon={<PhoneMissed className="w-3.5 h-3.5" />}
              color="text-chart-5"
              compact
            />
            <KPICard
              label="Answer Rate"
              value={`${inboundAnswerRate}%`}
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              color="text-chart-1"
              compact
              testIdSuffix="-inbound"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <PhoneOutgoing className="w-3.5 h-3.5 text-chart-3" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" data-testid="label-outbound-group">
              Outbound
            </span>
            <span className="text-xs text-muted-foreground">— brand trust</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <KPICard
              label="Outbound"
              value={stats.outbound}
              icon={<PhoneOutgoing className="w-3.5 h-3.5" />}
              color="text-chart-3"
              compact
            />
            <KPICard
              label="Answered"
              value={stats.outboundAnswered}
              icon={<CheckCircle className="w-3.5 h-3.5" />}
              color="text-chart-2"
              compact
              testIdSuffix="-outbound"
            />
            <KPICard
              label="Answer Rate"
              value={`${outboundAnswerRate}%`}
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              color="text-chart-1"
              compact
              testIdSuffix="-outbound"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
