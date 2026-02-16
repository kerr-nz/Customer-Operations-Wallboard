import { Card } from "@/components/ui/card";
import type { DailyStats } from "@shared/schema";
import { SmilePlus, Meh, Frown } from "lucide-react";

interface SentimentPanelProps {
  stats: DailyStats;
}

export function SentimentPanel({ stats }: SentimentPanelProps) {
  const total = stats.happy + stats.normal + stats.angry;
  const happyPct = total > 0 ? Math.round((stats.happy / total) * 100) : 0;
  const normalPct = total > 0 ? Math.round((stats.normal / total) * 100) : 0;
  const angryPct = total > 0 ? Math.round((stats.angry / total) * 100) : 0;

  return (
    <Card className="p-4 flex flex-col gap-4" data-testid="sentiment-panel">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Sentiment Analysis
      </h3>

      <div className="flex flex-col gap-3">
        <SentimentRow
          label="Happy"
          count={stats.happy}
          percentage={happyPct}
          icon={<SmilePlus className="w-4 h-4" />}
          color="text-emerald-500 dark:text-emerald-400"
          barColor="bg-emerald-500"
        />
        <SentimentRow
          label="Normal"
          count={stats.normal}
          percentage={normalPct}
          icon={<Meh className="w-4 h-4" />}
          color="text-sky-500 dark:text-sky-400"
          barColor="bg-sky-500"
        />
        <SentimentRow
          label="Angry"
          count={stats.angry}
          percentage={angryPct}
          icon={<Frown className="w-4 h-4" />}
          color="text-rose-500 dark:text-rose-400"
          barColor="bg-rose-500"
        />
      </div>

      {total === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No sentiment data yet
        </p>
      )}
    </Card>
  );
}

interface SentimentRowProps {
  label: string;
  count: number;
  percentage: number;
  icon: React.ReactNode;
  color: string;
  barColor: string;
}

function SentimentRow({
  label,
  count,
  percentage,
  icon,
  color,
  barColor,
}: SentimentRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-2 ${color}`}>
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">{count}</span>
          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
            {percentage}%
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-700 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
