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

interface MetricProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  testId?: string;
}

function Metric({ label, value, icon, testId }: MetricProps) {
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-0">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        {icon}
        <span
          className="text-lg font-bold tabular-nums leading-none"
          data-testid={testId}
        >
          {value}
        </span>
      </div>
    </div>
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
    <div className="flex gap-2" data-testid="kpi-strip">
      <div className="flex items-center gap-4 rounded-md bg-muted/50 dark:bg-muted/30 px-5 py-3 border border-border/50">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            Total Calls
          </span>
          <div className="flex items-center gap-1.5">
            <Phone className="w-4 h-4 text-chart-1" />
            <span className="text-2xl font-bold tabular-nums leading-none" data-testid="kpi-value-total-calls">
              {stats.total}
            </span>
          </div>
        </div>
        <div className="w-px h-8 bg-border/60" />
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            Active
          </span>
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-chart-2" />
            <span className="text-2xl font-bold tabular-nums leading-none text-chart-2" data-testid="kpi-value-active">
              {stats.active}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center gap-3 rounded-md bg-chart-4/8 dark:bg-chart-4/10 px-4 py-3 border border-chart-4/15">
        <div className="flex items-center gap-1.5 mr-1">
          <PhoneIncoming className="w-3.5 h-3.5 text-chart-4" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-chart-4" data-testid="label-inbound-group">
            Inbound
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Metric
            label="Total"
            value={stats.inbound}
            icon={<PhoneIncoming className="w-3.5 h-3.5 text-chart-4" />}
            testId="kpi-value-inbound"
          />
          <Metric
            label="Answered"
            value={stats.inboundAnswered}
            icon={<CheckCircle className="w-3.5 h-3.5 text-chart-2" />}
            testId="kpi-value-answered-inbound"
          />
          <Metric
            label="Missed"
            value={stats.missed}
            icon={<PhoneMissed className="w-3.5 h-3.5 text-chart-5" />}
            testId="kpi-value-missed"
          />
          <Metric
            label="Answer Rate"
            value={`${inboundAnswerRate}%`}
            icon={<TrendingUp className="w-3.5 h-3.5 text-chart-1" />}
            testId="kpi-value-answer-rate-inbound"
          />
        </div>
      </div>

      <div className="flex-1 flex items-center gap-3 rounded-md bg-chart-3/8 dark:bg-chart-3/10 px-4 py-3 border border-chart-3/15">
        <div className="flex items-center gap-1.5 mr-1">
          <PhoneOutgoing className="w-3.5 h-3.5 text-chart-3" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-chart-3" data-testid="label-outbound-group">
            Outbound
          </span>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Metric
            label="Total"
            value={stats.outbound}
            icon={<PhoneOutgoing className="w-3.5 h-3.5 text-chart-3" />}
            testId="kpi-value-outbound"
          />
          <Metric
            label="Answered"
            value={stats.outboundAnswered}
            icon={<CheckCircle className="w-3.5 h-3.5 text-chart-2" />}
            testId="kpi-value-answered-outbound"
          />
          <Metric
            label="Answer Rate"
            value={`${outboundAnswerRate}%`}
            icon={<TrendingUp className="w-3.5 h-3.5 text-chart-1" />}
            testId="kpi-value-answer-rate-outbound"
          />
        </div>
      </div>
    </div>
  );
}
