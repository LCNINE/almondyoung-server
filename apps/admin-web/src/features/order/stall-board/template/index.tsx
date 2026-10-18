'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useOrderProgressSummary } from '@/lib/services/orders/queries';
import {
  useMismatchSummary,
  useQuarantineSummary,
} from '@/lib/services/channel/queries';
import {
  BOARD_STAGES,
  BoardStageKey,
  cellCount,
  headerStatus,
  initialBoardStage,
} from '@/lib/api/domains/orders/order-progress.shape';
import { StageBand, BandCell } from '../components/stage-band';
import { StageOrders } from '../components/stage-orders';
import { collectCell, known } from '../collect-cell';
import { cn } from '@/lib/utils/ui';

export default function StallBoardTemplate() {
  const searchParams = useSearchParams();
  const stageParam = searchParams.get('stage');
  const [selected, setSelected] = useState<BoardStageKey>(() =>
    initialBoardStage(stageParam)
  );
  // 보드에 있는 채로 «출고불가» 링크(?stage=reserve)를 따라오면 URL 만 바뀌고 화면은 안 바뀐다 —
  // 주소가 바뀔 때마다 그 단계로 간다. 칸을 직접 누른 선택은 주소가 그대로면 건드리지 않는다.
  useEffect(() => {
    setSelected(initialBoardStage(stageParam));
  }, [stageParam]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const summary = useOrderProgressSummary();
  const quarantine = useQuarantineSummary();
  const mismatch = useMismatchSummary();

  const stages = summary.data?.stages ?? [];
  const hasSummary = summary.data !== undefined;
  const collect = collectCell(known(quarantine), known(mismatch));
  const cells: BandCell[] = [
    collect.cell,
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
        <div className="flex flex-wrap gap-2 rounded-lg border bg-white px-4 py-6 text-sm">
          {collect.links.length === 0 ? (
            <span className="text-muted-foreground">없음</span>
          ) : (
            collect.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md border px-3 py-2 hover:border-slate-400"
              >
                {link.label}
                {link.count !== null && (
                  <b className="ml-1.5 tabular-nums">
                    {link.count.toLocaleString('ko-KR')}
                  </b>
                )}
              </Link>
            ))
          )}
        </div>
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
