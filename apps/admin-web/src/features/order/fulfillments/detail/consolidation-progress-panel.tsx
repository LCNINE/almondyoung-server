'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExcludeShipmentDialog } from '../../outbound-batches/components/exclude-shipment-dialog';
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
import {
  mergedHeading,
  mergingHeading,
  nextStepsAfterMerge,
  type NextStepKey,
  type NextStepState,
} from './consolidation-copy';
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

function orderNoLabel(orderNo: string): string {
  return orderNo
    .split(', ')
    .map((no) => `#${no}`)
    .join(', ');
}

function boxLabel(source: ConsolidationProgressSource): string {
  if (source.orderNo) {
    return source.trackingNo
      ? `${orderNoLabel(source.orderNo)} 상자(송장 ${source.trackingNo})`
      : `${orderNoLabel(source.orderNo)} 상자`;
  }

  return source.trackingNo
    ? `송장 ${source.trackingNo} 상자`
    : `상자 ${source.shipmentId.slice(0, 8)}`;
}

function boxName(source: ConsolidationProgressSource): string {
  return source.orderNo
    ? `${orderNoLabel(source.orderNo)} 상자`
    : boxLabel(source);
}

function orderNosOf(
  sources: ConsolidationProgressSource[],
  shipmentId?: string
): string[] | null {
  const ordered = [
    ...sources.filter((source) => source.shipmentId === shipmentId),
    ...sources.filter((source) => source.shipmentId !== shipmentId),
  ];
  if (ordered.some((source) => !source.orderNo)) return null;

  return ordered.flatMap((source) => (source.orderNo ?? '').split(', '));
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

function PendingButton({
  pending,
  disabled,
  onClick,
  children,
}: {
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      className="relative"
      disabled={disabled}
      aria-busy={pending}
      onClick={onClick}
    >
      <span className={pending ? 'invisible' : undefined}>{children}</span>
      {pending && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
          />
        </span>
      )}
    </Button>
  );
}

function AutoMergeWaiting({ nextCheckAt }: { nextCheckAt: number | null }) {
  const [startedAt] = useState(Date.now);
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    if (nextCheckAt === null) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [nextCheckAt]);

  const waiting = nextCheckAt !== null && now < nextCheckAt;
  const overdue = nextCheckAt !== null && now >= nextCheckAt + 120_000;
  const seconds = Math.max(0, Math.ceil(((nextCheckAt ?? now) - now) / 1000));
  const scheduled = nextCheckAt === null ? null : new Date(nextCheckAt);
  const time = scheduled
    ? `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}`
    : '';
  const percent = waiting
    ? Math.min(
        100,
        Math.max(0, ((now - startedAt) / (nextCheckAt - startedAt)) * 100)
      )
    : 100;

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-base font-semibold text-blue-700">
        {!overdue && (
          <span
            aria-hidden="true"
            className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700 motion-reduce:animate-none"
          />
        )}
        {overdue
          ? '예상보다 오래 걸리고 있어요'
          : waiting
            ? '자동으로 합치는 중이에요'
            : '지금 확인하고 있어요'}
      </p>
      <p className="text-sm text-zinc-700">
        {overdue
          ? `${time}에 확인하기로 했는데 아직 안 합쳐졌어요.`
          : waiting
            ? `서버가 ${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초 뒤(${time})에 다시 확인하고 바로 합쳐요.`
            : '곧 합쳐져요. 보통 1분 안에 끝나요.'}
      </p>
      {waiting && (
        <>
          <div
            role="progressbar"
            aria-label="다음 합포장 확인까지 대기"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-1 overflow-hidden rounded-full bg-blue-100"
          >
            <div
              className="h-full bg-blue-700 transition-[width] motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-sm text-zinc-700">
            더 누를 건 없어요. 합쳐지면 이 화면이 저절로 바뀌어요.
          </p>
        </>
      )}
      {overdue && <StallBoardLink />}
    </div>
  );
}

const NEXT_STEP_HINT: Record<NextStepKey, Record<NextStepState, string>> = {
  plan: {
    done: '끝났어요',
    current: '아래 상자 작업의 계획 확정 버튼으로 해요',
    later: '',
  },
  waybill: {
    done: '끝났어요',
    current: '아래 운송장 이력에서 발급해요',
    later: '계획 확정 뒤',
  },
  batch: {
    done: '끝났어요',
    current: '출고 배치 화면에서 이 상자를 넣어요',
    later: '운송장 발급 뒤',
  },
};

export interface MergedTarget {
  status: string;
  waybills: Array<{ status: string }>;
  workItems: Array<{ status: string }>;
}

function MergedPanel({
  sources,
  target,
}: {
  sources: ConsolidationProgressSource[];
  target: MergedTarget | undefined;
}) {
  const orderNos = orderNosOf(sources);
  const heading =
    (orderNos && mergedHeading(orderNos)) ??
    `상자 ${sources.length}개가 새 상자 하나로 합쳐졌어요`;
  const steps = target ? nextStepsAfterMerge(target) : [];

  return (
    <section className="overflow-hidden rounded-lg border border-green-300">
      <div className="bg-green-50 px-5 py-4">
        <p className="text-base font-semibold">{heading}</p>
        <p className="mt-1 text-sm text-zinc-700">
          {orderNos
            ? '두 주문 화면 어디서 보든 같은 상자예요. 아래 순서대로 이어서 하면 돼요.'
            : '아래 순서대로 이어서 하면 돼요.'}
        </p>
      </div>

      {steps.length > 0 && (
        <div className="p-5">
          <p className="text-sm font-semibold">다음 할 일</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {steps.map((step, index) => (
              <li
                key={step.key}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2',
                  step.state === 'current'
                    ? 'border-green-300 bg-green-50'
                    : 'bg-white'
                )}
              >
                <span
                  className={cn(
                    'text-sm',
                    step.state === 'current' ? 'font-semibold' : 'font-medium',
                    step.state === 'later' && 'text-muted-foreground'
                  )}
                >
                  {`${index + 1}. ${step.title}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {NEXT_STEP_HINT[step.key][step.state]}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function RetiredNotice() {
  return (
    <section className="rounded-lg border bg-zinc-50 p-5">
      <p className="text-base font-semibold">
        합쳐져서 지금은 쓰지 않는 상자예요
      </p>
      <p className="mt-1 text-sm text-zinc-700">
        상품은 새 상자에 담겼어요. 송장 이력은 아래에 그대로 남아 있어요.
      </p>
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
  const [confirmExclude, setConfirmExclude] = useState(false);
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

  const onExclude = async (voidWaybill: boolean) => {
    if (!current?.batchId) {
      return;
    }

    try {
      await exclude.mutateAsync({
        batchId: current.batchId,
        shipmentId: current.shipmentId,
        reason: EXCLUDE_REASON,
        voidWaybill,
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

  const orderNos = orderNosOf(progress.sources, shipmentId);
  const heading = orderNos && mergingHeading(orderNos);
  const ownsStep = !current || current.shipmentId === shipmentId;
  const stepBox = current ? boxName(current) : '이 상자';

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
  const automaticVoid =
    current?.workItemStatus === 'withdrawing' && current.voidOnWithdrawal;

  const canVoid =
    canRun(useVoidWaybill) &&
    !!current?.waybillId &&
    current.waybillStatus === 'registered';

  const earliestCheck = Math.min(
    ...progress.sources.flatMap((source) =>
      source.nextCheckAt ? [new Date(source.nextCheckAt).getTime()] : []
    )
  );
  const nextCheckAt = Number.isFinite(earliestCheck) ? earliestCheck : null;

  return (
    <section className="overflow-hidden rounded-lg border border-blue-200">
      <div className="bg-blue-50 px-5 py-4">
        {heading ? (
          <>
            <p className="text-base font-semibold">{heading}</p>
            <p className="mt-1 text-sm text-zinc-700">
              {progress.sources.length === 2
                ? '끝날 때까지 두 상자 모두 출고되지 않아요'
                : `끝날 때까지 상자 ${progress.sources.length}개 모두 출고되지 않아요`}
            </p>
          </>
        ) : (
          <>
            <p className="text-base font-semibold">합포장 진행 중</p>
            <p className="mt-1 text-sm text-zinc-700">
              {`상자 ${progress.sources.length}개를 하나로 합치는 중이에요`}
            </p>
            <p className="text-sm text-zinc-700">
              끝날 때까지 이 상자는 출고되지 않아요
            </p>
          </>
        )}
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
                  담당:{' '}
                  {entry.step === 'void' && automaticVoid ? '자동' : entry.who}
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

        {confirmExclude && current && (
          <ExcludeShipmentDialog
            trackingNo={current.trackingNo}
            defaultVoidWaybill
            onClose={() => setConfirmExclude(false)}
            onConfirm={(checked) => void onExclude(checked)}
          />
        )}

        {exception === null && step === 'exclude' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-blue-700">지금 할 일</p>
              <p className="mt-0.5 text-base font-semibold">
                {ownsStep
                  ? '이 상자를 배치에서 빼 주세요'
                  : `${stepBox}를 배치에서 빼 주세요`}
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                {`${batchName ? `${batchName} 배치` : '배치'}에 들어 있어요. 빼면 창고에서 담아 둔 상품을 되돌리는 작업이 생겨요.`}
              </p>
            </div>
            {canExclude && (
              <PendingButton
                pending={exclude.isPending}
                disabled={busy}
                onClick={() => setConfirmExclude(true)}
              >
                배치에서 빼기
              </PendingButton>
            )}
          </div>
        )}

        {automaticVoid && (
          <p className="text-sm text-muted-foreground">
            상품을 다 꺼내면 송장이 자동으로 무효화돼요
          </p>
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
                {ownsStep
                  ? '기존 운송장을 취소해 주세요'
                  : `${stepBox}의 운송장을 취소해 주세요`}
              </p>
              <p className="mt-1 text-sm text-zinc-700">
                {`${current ? boxLabel(current) : '이 상자'}의 송장은 더 쓸 수 없어요. 합쳐진 상자에 새로 발급해요.`}
              </p>
            </div>
            {canVoid && (
              <PendingButton
                pending={voidWaybill.isPending}
                disabled={busy}
                onClick={() => void onVoid()}
              >
                운송장 취소
              </PendingButton>
            )}
          </div>
        )}

        {exception === null && !overall.gaveUp && step === 'auto' && (
          <AutoMergeWaiting key={nextCheckAt} nextCheckAt={nextCheckAt} />
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

export function ConsolidationProgressPanel({
  shipmentId,
  mergedFromShipmentId,
  target,
  children,
}: {
  shipmentId: string;
  mergedFromShipmentId?: string;
  target?: MergedTarget;
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const own = useConsolidationProgress(shipmentId);
  const via = useConsolidationProgress(mergedFromShipmentId ?? '');

  const fromSource =
    mergedFromShipmentId &&
    via.data?.status === 'completed' &&
    via.data.targetShipmentId === shipmentId
      ? via.data
      : null;
  const data = own.data ?? fromSource;
  const status = data?.status;
  const previousStatus = useRef(status);

  useEffect(() => {
    if (
      previousStatus.current === 'pending' &&
      status === 'completed' &&
      data
    ) {
      const orderNos = orderNosOf(data.sources, shipmentId);
      const heading = orderNos && mergedHeading(orderNos);

      toast.success(
        heading?.replace(' 새 상자 하나로', '') ??
          `상자 ${data.sources.length}개가 합쳐졌어요`
      );

      const shipmentIds = new Set([
        shipmentId,
        ...data.sources.map((source) => source.shipmentId),
        ...(data.targetShipmentId ? [data.targetShipmentId] : []),
      ]);

      void queryClient.invalidateQueries({
        queryKey: orderQueryKeys.fulfillments,
      });
      void queryClient.invalidateQueries({
        queryKey: orderQueryKeys.fulfillmentOrders,
      });
      shipmentIds.forEach((id) => {
        void queryClient.invalidateQueries({
          queryKey: orderQueryKeys.shipment(id),
        });
      });
    }

    previousStatus.current = status;
  }, [status, data, shipmentId, queryClient]);

  const superseded =
    data?.status === 'completed' &&
    data.sources.some((source) => source.shipmentId === shipmentId);

  let panel: ReactNode = null;

  if (data?.status === 'completed') {
    panel =
      data.targetShipmentId === shipmentId ? (
        <MergedPanel sources={data.sources} target={target} />
      ) : (
        <RetiredNotice />
      );
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
