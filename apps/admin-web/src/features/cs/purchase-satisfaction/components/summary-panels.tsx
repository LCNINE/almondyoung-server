'use client';

import { cn } from '@/lib/utils/cn';
import {
  PURCHASE_SATISFACTION_REASONS,
  type PurchaseSatisfactionReason,
  type PurchaseSatisfactionSummary,
} from '@/lib/types/dto/purchase-satisfaction';
import { PURCHASE_SATISFACTION_REASON_LABELS } from '../reason-labels';

function Kpi({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold">{value}</span>
    </>
  );
  const base = 'flex flex-col gap-1 rounded-lg border p-4 text-left';
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(base, 'hover:bg-muted/50', active && 'border-foreground')}
    >
      {body}
    </button>
  );
}

export function KpiRow({
  summary,
  uncheckedActive,
  onUncheckedLow,
}: {
  summary: PurchaseSatisfactionSummary;
  uncheckedActive: boolean;
  onUncheckedLow: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label="응답" value={`${summary.count.toLocaleString()}건`} />
      <Kpi label="평균 별점" value={summary.count ? summary.average.toFixed(1) : '-'} />
      <Kpi label="만족 비율" value={summary.count ? `${summary.csatPercent}%` : '-'} />
      <Kpi
        label="확인 안 한 3점 이하"
        value={`${summary.uncheckedLow.toLocaleString()}건`}
        onClick={onUncheckedLow}
        active={uncheckedActive}
      />
    </div>
  );
}

function Bar({ label, count, max }: { label: string; count: number; max: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-48 shrink-0 truncate">{label}</span>
      <div className="h-2 flex-1 rounded bg-muted">
        <div className="h-2 rounded bg-foreground/70" style={{ width: max ? `${(count / max) * 100}%` : 0 }} />
      </div>
      <span className="w-10 text-right tabular-nums">{count}</span>
    </div>
  );
}

export function DistributionBars({ summary }: { summary: PurchaseSatisfactionSummary }) {
  const max = Math.max(0, ...summary.distribution);
  return (
    <section aria-label="별점 분포" className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">별점 분포</h3>
      {[5, 4, 3, 2, 1].map((score) => (
        <Bar key={score} label={`${score}점`} count={summary.distribution[score - 1] ?? 0} max={max} />
      ))}
    </section>
  );
}

export function ReasonBars({
  summary,
  selected,
  onSelect,
}: {
  summary: PurchaseSatisfactionSummary;
  selected?: PurchaseSatisfactionReason;
  onSelect: (reason: PurchaseSatisfactionReason | undefined) => void;
}) {
  const max = Math.max(0, ...PURCHASE_SATISFACTION_REASONS.map((r) => summary.reasonCounts[r] ?? 0));
  return (
    <section aria-label="3점 이하 사유" className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">3점 이하 사유</h3>
      {PURCHASE_SATISFACTION_REASONS.map((reason) => (
        <button
          key={reason}
          type="button"
          aria-pressed={selected === reason}
          onClick={() => onSelect(selected === reason ? undefined : reason)}
          className={cn('rounded px-1 text-left hover:bg-muted/50', selected === reason && 'bg-muted')}
        >
          <Bar
            label={PURCHASE_SATISFACTION_REASON_LABELS[reason]}
            count={summary.reasonCounts[reason] ?? 0}
            max={max}
          />
        </button>
      ))}
    </section>
  );
}
