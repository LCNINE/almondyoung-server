'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePermissionCheck } from '@/hooks/use-permission';
import {
  getServerDenyMessage,
  useExcludeShipmentFromBatch,
  useVoidWaybill,
} from '@/lib/services/orders';
import {
  useConsolidationProgress,
  useOutboundBatchV2,
} from '@/lib/services/orders/queries';
import { orderQueryKeys } from '@/lib/services/orders/query-keys';
import type {
  ConsolidationProgressResponse,
  ConsolidationProgressSource,
} from '@/lib/types/dto/fulfillment';
import { cn } from '@/lib/utils/ui';
import { overallProgress, type ConsolidationStep } from './consolidation-model';

const EXCLUDE_REASON = '합포장';
const VOID_REASON = '합포장으로 재발급';
const STALL_BOARD_PATH = '/order/stall-board';

const STEPS: Array<{ step: ConsolidationStep; title: string; who: string }> = [
  { step: 'exclude', title: '배치에서 빼기', who: '나' },
  { step: 'unpick', title: '상품 꺼내기', who: '창고' },
  { step: 'void', title: '운송장 취소', who: '나' },
  { step: 'auto', title: '자동으로 합치기', who: '자동' },
];

type TrackState = 'done' | 'now' | 'wait' | 'todo';

const TRACK_TAG: Record<TrackState, string> = {
  done: '완료',
  now: '지금 할 일',
  wait: '기다리는 중',
  todo: '다음',
};

const TRACK_BAR: Record<TrackState, string> = {
  done: 'bg-green-700',
  now: 'bg-blue-700',
  wait: 'bg-amber-500',
  todo: 'bg-zinc-200',
};

const TRACK_TAG_COLOR: Record<TrackState, string> = {
  done: 'text-green-700',
  now: 'text-blue-700',
  wait: 'text-zinc-700',
  todo: 'text-muted-foreground',
};

type Exception =
  | 'dispatch_attempt'
  | 'waybill_not_registered'
  | 'short_pick'
  | 'operation';

const EXCEPTION_REASON: Record<Exception, string> = {
  dispatch_attempt: '발송 시도가 있어요. 배치에서 빼는 것도 거절될 수 있어요.',
  waybill_not_registered: '운송장이 취소할 수 있는 상태가 아니에요.',
  short_pick: '결품 처리 중이라 배치에서 뺄 수 없어요.',
  operation: '합포장 작업이 실패했거나 복구가 필요한 상태예요.',
};

function boxLabel(source: ConsolidationProgressSource): string {
  return source.trackingNo
    ? `송장 ${source.trackingNo} 상자`
    : `상자 ${source.shipmentId.slice(0, 8)}`;
}

function trackState(index: number, current: number): TrackState {
  if (index < current) {
    return 'done';
  }

  if (index > current) {
    return 'todo';
  }

  return STEPS[index].step === 'unpick' ? 'wait' : 'now';
}

function StallBoardLink() {
  return (
    <Button variant="outline" asChild>
      <Link href={STALL_BOARD_PATH}>정체 보드 열기</Link>
    </Button>
  );
}

function GaveUpNotice({ description }: { description: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3">
      <div>
        <p className="text-xs font-semibold text-red-700">
          자동으로 합쳐지지 않았어요
        </p>
        <p className="mt-1 text-sm text-zinc-700">{description}</p>
      </div>
      <StallBoardLink />
    </div>
  );
}

function MergedPanel({
  targetShipmentId,
}: {
  targetShipmentId: string | null;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-300 bg-green-50 p-5">
      <div>
        <p className="text-base font-semibold">합쳐졌어요</p>
        <p className="mt-1 text-sm text-zinc-700">
          상품이 새 상자 하나에 담겼어요. 이 상자는 이제 쓰지 않아요. 새
          상자에서 계획 확정, 운송장 발급, 배치 넣기를 이어서 해 주세요.
        </p>
      </div>

      {targetShipmentId && (
        <Button asChild>
          <Link
            href={`/order/fulfillments?shipmentId=${encodeURIComponent(targetShipmentId)}`}
          >
            새 상자로 가기
          </Link>
        </Button>
      )}
    </section>
  );
}

function PendingPanel({
  shipmentId,
  progress,
}: {
  shipmentId: string;
  progress: ConsolidationProgressResponse;
}) {
  const queryClient = useQueryClient();
  const { canRun } = usePermissionCheck();
  const exclude = useExcludeShipmentFromBatch();
  const voidWaybill = useVoidWaybill();

  const overall = overallProgress(progress.sources);
  const current =
    progress.sources.find(
      (source) => source.shipmentId === overall.shipmentId
    ) ?? null;
  const batch = useOutboundBatchV2(current?.batchId ?? '');
  const batchName = batch.data
    ? batch.data.name || batch.data.batchNumber
    : null;

  let exception: Exception | null = null;

  if (progress.status !== 'pending') {
    exception = 'operation';
  } else if (overall.current.step === 'stuck') {
    exception = overall.current.reason;
  }

  const step = overall.current.step === 'stuck' ? null : overall.current.step;
  const stepIndex = STEPS.findIndex((entry) => entry.step === step);
  const busy = exclude.isPending || voidWaybill.isPending;

  const refresh = () => {
    const shipmentIds = new Set([
      shipmentId,
      current?.shipmentId ?? shipmentId,
    ]);

    void queryClient.invalidateQueries({
      queryKey: orderQueryKeys.consolidationProgress(shipmentId),
    });

    shipmentIds.forEach((id) => {
      void queryClient.invalidateQueries({
        queryKey: orderQueryKeys.shipment(id),
      });
    });
  };

  const onExclude = async () => {
    if (!current?.batchId) {
      return;
    }

    try {
      await exclude.mutateAsync({
        batchId: current.batchId,
        shipmentId: current.shipmentId,
        reason: EXCLUDE_REASON,
      });
      toast.success('배치에서 뺐어요');
      refresh();
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  const onVoid = async () => {
    if (!current?.waybillId) {
      return;
    }

    try {
      await voidWaybill.mutateAsync({
        waybillId: current.waybillId,
        shipmentId: current.shipmentId,
        data: { reason: VOID_REASON },
      });
      toast.success('운송장을 취소했어요');
      refresh();
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  const warehouseMessage = current
    ? `${batchName ? `${batchName} 배치의 ` : ''}${boxLabel(current)}를 뺐어요. 담아 둔 상품을 되돌려 주세요.`
    : '';

  const onCopy = () => {
    navigator.clipboard.writeText(warehouseMessage).then(
      () => toast.success('문구를 복사했어요'),
      () => toast.error('문구를 복사하지 못했어요')
    );
  };

  const canExclude = canRun(useExcludeShipmentFromBatch) && !!current?.batchId;
  const canVoid =
    canRun(useVoidWaybill) &&
    !!current?.waybillId &&
    current.waybillStatus === 'registered';

  return (
    <section className="overflow-hidden rounded-lg border border-blue-200">
      <div className="bg-blue-50 px-5 py-4">
        <p className="text-base font-semibold">합포장 진행 중</p>
        <p className="mt-1 text-sm text-zinc-700">
          {`상자 ${progress.sources.length}개를 하나로 합치는 중이에요`}
        </p>
        <p className="text-sm text-zinc-700">
          끝날 때까지 이 상자는 출고되지 않아요
        </p>
      </div>

      {exception === null && (
        <ol className="grid grid-cols-2 gap-2 border-b p-5 sm:grid-cols-4">
          {STEPS.map((entry, index) => {
            const state = trackState(index, stepIndex);

            return (
              <li key={entry.step} className="flex flex-col gap-1.5">
                <div className={cn('h-1 rounded-sm', TRACK_BAR[state])} />
                <span
                  className={cn(
                    'text-xs font-semibold',
                    TRACK_TAG_COLOR[state]
                  )}
                >
                  {TRACK_TAG[state]}
                </span>
                <span className="text-sm font-semibold">{entry.title}</span>
                <span className="text-xs text-muted-foreground">
                  담당: {entry.who}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex flex-col gap-3 p-5">
        {exception !== null && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold">
                이 화면에서 처리할 수 없는 상태예요
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                {EXCEPTION_REASON[exception]}
              </p>
              <p className="text-sm text-zinc-700">
                정체 보드에서 멈춘 이유를 확인해 주세요
              </p>
            </div>
            <StallBoardLink />
          </div>
        )}

        {exception === null && overall.gaveUp && step === 'auto' && (
          <GaveUpNotice description="여러 번 시도해도 안 합쳐졌어요. 정체 보드에 멈춘 이유가 있어요. 개발팀에 이 화면 주소를 같이 보내 주세요." />
        )}

        {exception === null && step === 'exclude' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-blue-700">지금 할 일</p>
              <p className="mt-0.5 text-base font-semibold">
                이 상자를 배치에서 빼 주세요
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                {`${batchName ? `${batchName} 배치` : '배치'}에 들어 있어요. 빼면 창고에서 담아 둔 상품을 되돌리는 작업이 생겨요.`}
              </p>
            </div>
            {canExclude && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onExclude()}
              >
                배치에서 빼기
              </Button>
            )}
          </div>
        )}

        {exception === null && step === 'unpick' && (
          <div className="flex flex-col gap-2.5">
            <p className="text-xs font-semibold text-zinc-700">
              창고 작업을 기다리는 중
            </p>
            <p className="text-base font-semibold">
              창고에서 상품을 제자리에 돌려놓아야 해요
            </p>
            <p className="text-sm text-zinc-700">
              담아 둔 상품이 아직 작업대에 있어요. 어드민에서는 처리할 수
              없어요. 창고에 아래 문구를 전해 주세요. 끝나면 이 화면이 저절로
              다음 단계로 넘어가요.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-zinc-50 p-3">
              <span className="text-sm">{warehouseMessage}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onCopy}
              >
                문구 복사
              </Button>
            </div>
          </div>
        )}

        {exception === null && step === 'void' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-blue-700">지금 할 일</p>
              <p className="mt-0.5 text-base font-semibold">
                기존 운송장을 취소해 주세요
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                {`${current ? boxLabel(current) : '이 상자'}의 송장은 더 쓸 수 없어요. 합쳐진 상자에 새로 발급해요.`}
              </p>
            </div>
            {canVoid && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void onVoid()}
              >
                운송장 취소
              </Button>
            )}
          </div>
        )}

        {exception === null && !overall.gaveUp && step === 'auto' && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold text-green-700">할 일 끝</p>
            <p className="text-base font-semibold">
              10분 안에 자동으로 합쳐져요
            </p>
            <p className="text-sm text-zinc-700">
              더 누를 건 없어요. 합쳐지면 여기에 새 상자가 나타나요.
            </p>
          </div>
        )}

        {exception === null &&
          step !== 'auto' &&
          current &&
          progress.sources.length > 1 && (
            <p className="text-sm text-muted-foreground">
              {`${boxLabel(current)}의 일이에요`}
            </p>
          )}

        {exception === null && overall.gaveUp && step !== 'auto' && (
          <GaveUpNotice description="위 할 일을 끝내도 저절로 안 합쳐질 수 있어요. 정체 보드에 멈춘 이유가 있어요." />
        )}
      </div>
    </section>
  );
}

// 합쳐진 원본 상자는 superseded 라 아래 상자 내용(children)을 흐리게 둔다. 초록 패널은 흐리지 않는다.
export function ConsolidationProgressPanel({
  shipmentId,
  children,
}: {
  shipmentId: string;
  children?: ReactNode;
}) {
  const { data } = useConsolidationProgress(shipmentId);

  const superseded =
    data?.status === 'completed' &&
    data.sources.some((source) => source.shipmentId === shipmentId);

  let panel: ReactNode = null;

  if (data?.status === 'completed') {
    panel = <MergedPanel targetShipmentId={data.targetShipmentId} />;
  } else if (data) {
    panel = <PendingPanel shipmentId={shipmentId} progress={data} />;
  }

  return (
    <>
      {panel}
      {children && (
        <div
          data-testid="consolidation-box-content"
          className={cn('space-y-6', superseded && 'opacity-50')}
        >
          {children}
        </div>
      )}
    </>
  );
}
