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

interface KPIStripProps {
  stats: DailyStats;
}

function Metric({ label, value, icon, color, testId }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  testId?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className={color}>{icon}</div>
      <div className="flex flex-col">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-none">{label}</span>
        <span
          className="text-base font-bold tabular-nums leading-tight"
          data-testid={testId || `kpi-value-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="w-px self-stretch bg-border shrink-0" />;
}

function MetricGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 shrink-0">{children}</div>;
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
    <Card
      className="flex items-center gap-3 px-3 py-2 overflow-x-auto"
      data-testid="kpi-strip"
    >
      <MetricGroup>
        <Metric
          label="Total"
          value={stats.total}
          icon={<Phone className="w-3.5 h-3.5" />}
          color="text-chart-1"
        />
        <Metric
          label="Active"
          value={stats.active}
          icon={<Activity className="w-3.5 h-3.5" />}
          color="text-chart-2"
        />
      </MetricGroup>

      <Divider />

      <MetricGroup>
        <div className="flex items-center gap-1 shrink-0">
          <PhoneIncoming className="w-3 h-3 text-chart-4" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="label-inbound-group">In</span>
        </div>
        <Metric
          label="Inbound"
          value={stats.inbound}
          icon={<PhoneIncoming className="w-3 h-3" />}
          color="text-chart-4"
        />
        <Metric
          label="Answered"
          value={stats.inboundAnswered}
          icon={<CheckCircle className="w-3 h-3" />}
          color="text-chart-2"
          testId="kpi-value-answered-inbound"
        />
        <Metric
          label="Missed"
          value={stats.missed}
          icon={<PhoneMissed className="w-3 h-3" />}
          color="text-chart-5"
        />
        <Metric
          label="Rate"
          value={`${inboundAnswerRate}%`}
          icon={<TrendingUp className="w-3 h-3" />}
          color="text-chart-1"
          testId="kpi-value-answer-rate-inbound"
        />
      </MetricGroup>

      <Divider />

      <MetricGroup>
        <div className="flex items-center gap-1 shrink-0">
          <PhoneOutgoing className="w-3 h-3 text-chart-3" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="label-outbound-group">Out</span>
        </div>
        <Metric
          label="Outbound"
          value={stats.outbound}
          icon={<PhoneOutgoing className="w-3 h-3" />}
          color="text-chart-3"
        />
        <Metric
          label="Answered"
          value={stats.outboundAnswered}
          icon={<CheckCircle className="w-3 h-3" />}
          color="text-chart-2"
          testId="kpi-value-answered-outbound"
        />
        <Metric
          label="Rate"
          value={`${outboundAnswerRate}%`}
          icon={<TrendingUp className="w-3 h-3" />}
          color="text-chart-1"
          testId="kpi-value-answer-rate-outbound"
        />
      </MetricGroup>
    </Card>
  );
}
