'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useOrderProgressSummary } from '@/lib/services/orders/queries';
import { useQuarantineSummary } from '@/lib/services/channel/queries';
import { useCan, useCanOpen } from '@/hooks/use-permission';
import { CanOpen } from '@/components/auth/can';
import { permissionLabel } from '@/lib/auth/permission-labels';
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
  // 수집 격리 건수는 판매처 조회 권한이다 — 없으면 요청하지 않고 그 칸을 «가림»으로 그린다
  const channelRead = useCan(['channel.account.read']);
  const listingsAccess = useCanOpen('/mall/channel-listings');
  const quarantine = useQuarantineSummary({ enabled: channelRead.status === 'ready' && channelRead.allowed });
  const collectHidden =
    channelRead.status === 'ready' && !channelRead.allowed
      ? `${permissionLabel('channel.account.read')} 권한이 있어야 보입니다`
      : null;

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
      hiddenReason: collectHidden,
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
        <CanOpen
          screen="/mall/channel-listings"
          fallback={
            listingsAccess.status === 'ready' ? (
              <p className="rounded-lg border bg-white px-4 py-10 text-center text-sm text-muted-foreground">
                수집 격리 목록을 볼 권한이 없습니다.
              </p>
            ) : null
          }
        >
          <Link
            href="/mall/channel-listings"
            className="rounded-lg border bg-white px-4 py-10 text-center text-sm"
          >
            수집 격리 목록으로
          </Link>
        </CanOpen>
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
