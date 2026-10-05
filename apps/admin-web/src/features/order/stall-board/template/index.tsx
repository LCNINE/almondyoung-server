'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useOrderProgressSummary } from '@/lib/services/orders/queries';
import { useQuarantineSummary } from '@/lib/services/channel/queries';
import { BoardStageKey, formatDwell, freshness } from '@/lib/api/domains/orders/order-progress.shape';
import { StageBand, BandCell } from '../components/stage-band';
import { StageOrders } from '../components/stage-orders';
import { cn } from '@/lib/utils/ui';

export default function StallBoardTemplate() {
  const [selected, setSelected] = useState<BoardStageKey>('fo');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const summary = useOrderProgressSummary();
  const quarantine = useQuarantineSummary();

  const stages = summary.data?.stages ?? [];
  const cells: BandCell[] = [
    {
      key: 'collect',
      open: quarantine.data?.quarantined ?? 0,
      stuck: quarantine.data?.quarantined ?? 0, // 격리는 전부 사람 일(스펙 §6)
      oldestAt: quarantine.data?.oldestCreatedAt ?? null,
    },
    ...stages.map((s) => ({ key: s.stage as BoardStageKey, open: s.open, stuck: s.stuck, oldestAt: s.oldestEnteredAt })),
  ];
  const evaluatedAt = summary.data?.evaluatedAt ?? null;
  const stale = summary.isSuccess && freshness(evaluatedAt, now) === 'stale';

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">정체 보드</h1>
        <span className={cn('text-xs text-muted-foreground', stale && 'font-semibold text-red-600')}>
          {evaluatedAt ? `${formatDwell(now.getTime() - new Date(evaluatedAt).getTime())} 전 판정` : summary.isSuccess ? '판정 전' : ''}
        </span>
      </div>
      <StageBand cells={cells} selected={selected} onSelect={setSelected} now={now} />
      {selected === 'collect' ? (
        <Link href="/mall/channel-listings" className="rounded-lg border bg-white px-4 py-10 text-center text-sm">
          수집 격리 목록으로
        </Link>
      ) : (
        <StageOrders key={selected} stage={selected} summary={stages.find((s) => s.stage === selected)} now={now} />
      )}
    </div>
  );
}
