'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useOrderProgressSummary } from '@/lib/services/orders/queries';
import { useQuarantineSummary } from '@/lib/services/channel/queries';
import {
  BOARD_STAGES,
  BoardStageKey,
  cellCount,
  headerStatus,
} from '@/lib/api/domains/orders/order-progress.shape';
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
  const hasSummary = summary.data !== undefined;
  const qCount = quarantine.isSuccess
    ? quarantine.data?.quarantined
    : undefined;
  const cells: BandCell[] = [
    {
      key: 'collect',
      open: cellCount(qCount, quarantine.isSuccess),
      stuck: qCount ?? 0, // 격리는 전부 사람 일(스펙 §6)
      gaveUp: 0,
      oldestAt: quarantine.isSuccess
        ? (quarantine.data?.oldestCreatedAt ?? null)
        : null,
    },
    ...BOARD_STAGES.slice(1, 9).map((b) => {
      const s = stages.find((x) => x.stage === b.key);
      return {
        key: b.key,
        open: cellCount(s?.open ?? (hasSummary ? 0 : undefined), hasSummary),
        stuck: s?.stuck ?? 0,
        gaveUp: s?.gaveUp ?? 0,
        oldestAt: s?.oldestEnteredAt ?? null,
      };
    }),
    ...stages
      .filter((s) => !BOARD_STAGES.slice(0, 9).some((b) => b.key === s.stage))
      .map((s) => ({
        key: s.stage as BoardStageKey,
        open: s.open,
        stuck: s.stuck,
        gaveUp: s.gaveUp ?? 0,
        oldestAt: s.oldestEnteredAt,
      })),
  ];
  const evaluatedAt = summary.data?.evaluatedAt ?? null;
  const header = headerStatus(
    { isError: summary.isError, hasData: hasSummary },
    evaluatedAt,
    now
  );
  const stale = header.tone === 'stale';

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">정체 보드</h1>
        <span
          className={cn(
            'text-xs text-muted-foreground',
            stale && 'font-semibold text-red-600'
          )}
        >
          {header.text}
        </span>
      </div>
      <StageBand
        cells={cells}
        selected={selected}
        onSelect={setSelected}
        now={now}
      />
      {selected === 'collect' ? (
        <Link
          href="/mall/channel-listings"
          className="rounded-lg border bg-white px-4 py-10 text-center text-sm"
        >
          수집 격리 목록으로
        </Link>
      ) : (
        <StageOrders
          key={selected}
          stage={selected}
          summary={stages.find((s) => s.stage === selected)}
          now={now}
        />
      )}
    </div>
  );
}
