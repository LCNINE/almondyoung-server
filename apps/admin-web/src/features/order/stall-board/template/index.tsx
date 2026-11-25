'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useOrderProgressSummary } from '@/lib/services/orders/queries';
import {
  useMismatchSummary,
  useQuarantineSummary,
} from '@/lib/services/channel/queries';
import { useCan } from '@/hooks/use-permission';
import { CanOpen } from '@/components/auth/can';
import { permissionLabel } from '@/lib/auth/permission-labels';
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
import {
  PENDING_TRANSFER_READ,
  PENDING_TRANSFER_SERVED,
} from '../components/pending-transfers';
import { useReadGate } from '@/features/main/read-gate';
import { useCarrierTrackingAttention } from '@/lib/services/orders/carrier-tracking';
import { usePendingRefunds } from '@/lib/services/wallet/queries';
import { pendingTransfersOf } from '@/lib/api/domains/wallet/refund-execution';
import { emptyCsDraft, type CsDrafts } from '../cs/cs-drafts';
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
  const [drafts, setDrafts] = useState<CsDrafts>({});
  const summary = useOrderProgressSummary();
  // 수집 칸(격리·채널과 어긋남)은 판매처 조회 권한이다 — 없으면 요청하지 않고 그 칸을 «가림»으로 그린다
  const channelRead = useCan(['channel.account.read']);
  const canReadChannel = channelRead.status === 'ready' && channelRead.allowed;
  const quarantine = useQuarantineSummary({ enabled: canReadChannel });
  const mismatch = useMismatchSummary({ enabled: canReadChannel });
  const collectHidden =
    channelRead.status === 'ready' && !channelRead.allowed
      ? `${permissionLabel('channel.account.read')} 권한이 있어야 보입니다`
      : null;

  // 송금 대기는 정산이 끝난 뒤의 일이라 core 단계 수에 없다 — 취소 요청 칸 아래에 따로 센다(목록과 같은 조회)
  const refundRead = useReadGate(PENDING_TRANSFER_READ);
  const pendingRefunds = usePendingRefunds({
    enabled: refundRead.enabled && PENDING_TRANSFER_SERVED,
  });
  const transferCount = pendingRefunds.data
    ? pendingTransfersOf(pendingRefunds.data.data).length
    : 0;
  // 추적 단계 수는 주문 단위라, 택배사 쪽이 어긋난 송장은 따로 센다(목록과 같은 조회)
  const carrier = useCarrierTrackingAttention();
  const carrierNote = !carrier.data
    ? carrier.isError
      ? '택배사 확인 못 함'
      : ''
    : carrier.data.attention > 0
      ? `택배사 확인 ${carrier.data.attention.toLocaleString('ko-KR')}`
      : '';
  const notes = {
    ...(transferCount > 0 && {
      cancel_request: `송금 대기 ${transferCount.toLocaleString('ko-KR')}`,
    }),
    ...(carrierNote && { track: carrierNote }),
  };

  const stages = summary.data?.stages ?? [];
  const hasSummary = summary.data !== undefined;
  const collect = collectCell(known(quarantine), known(mismatch));
  const cells: BandCell[] = [
    { ...collect.cell, hiddenReason: collectHidden },
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
        notes={notes}
      />
      {selected === 'collect' ? (
        <div className="flex flex-wrap gap-2 rounded-lg border bg-white px-4 py-6 text-sm">
          {collectHidden ? (
            <span className="text-muted-foreground">{collectHidden}</span>
          ) : collect.links.length === 0 ? (
            <span className="text-muted-foreground">없음</span>
          ) : (
            collect.links.map((link) => (
              <CanOpen key={link.href} screen={link.href}>
                <Link
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
              </CanOpen>
            ))
          )}
        </div>
      ) : (
        <StageOrders
          key={selected}
          stage={selected}
          summary={stages.find((s) => s.stage === selected)}
          now={now}
          drafts={drafts}
          setDraft={(id, change) =>
            setDrafts((all) => ({
              ...all,
              [id]: change(all[id] ?? emptyCsDraft()),
            }))
          }
        />
      )}
    </div>
  );
}
