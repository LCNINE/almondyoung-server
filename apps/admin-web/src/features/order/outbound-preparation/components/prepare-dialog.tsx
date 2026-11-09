'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { cn } from '@/lib/utils/ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getServerDenyMessage,
  useRunOutboundPreparation,
} from '@/lib/services/orders';
import type { PreparationShipmentDto } from '@/lib/types/dto/fulfillment';
import { PICKING_METHOD_LABELS } from '@/lib/utils/picking-method';
import { plannedOrderText } from '../preparation-model';
import {
  type PreparationFailure,
  type PreparationInput,
  type PreparationProgress,
} from '@/lib/services/orders/outbound-preparation-runner';

export function PrepareDialog({
  input,
  shipments,
  source,
  onClose,
}: {
  input: PreparationInput;
  shipments: PreparationShipmentDto[];
  source: 'ready' | 'resume' | 'mergeable';
  onClose: () => void;
}) {
  const mutation = useRunOutboundPreparation();
  const [progress, setProgress] = useState<PreparationProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const unmounted = useRef(false);
  const completedStages = useRef(
    new Map<string, { planned: boolean; waybilled: boolean }>()
  );

  useEffect(() => {
    unmounted.current = false;

    return () => {
      unmounted.current = true;
    };
  }, []);

  const run = async (failure?: PreparationFailure) => {
    if (unmounted.current || running.current) {
      return;
    }

    running.current = true;
    setBusy(true);

    const previous = progress;
    const completed = failure
      ? (completedStages.current.get(failure.shipmentId) ?? {
          planned: failure.stage !== 'plan',
          waybilled: failure.stage === 'batch' || failure.stage === 'join',
        })
      : { planned: false, waybilled: false };

    const update = (next: PreparationProgress) => {
      if (unmounted.current) {
        return;
      }

      if (!failure || !previous) {
        setProgress(next);

        return;
      }

      completedStages.current.set(failure.shipmentId, {
        planned: completed.planned || next.planned > 0,
        waybilled: completed.waybilled || next.waybilled > 0,
      });
      setProgress({
        ...next,
        total: previous.total,
        planned: previous.planned + (completed.planned ? 0 : next.planned),
        waybilled:
          previous.waybilled + (completed.waybilled ? 0 : next.waybilled),
        joined: previous.joined + next.joined,
        batchId: next.batchId ?? previous.batchId,
        batchName: next.batchName ?? previous.batchName,
        failures: [
          ...previous.failures.filter(
            (item) => item.shipmentId !== failure.shipmentId
          ),
          ...next.failures,
        ],
      });
    };

    try {
      const next = await mutation.mutateAsync({
        ...input,
        shipmentIds: failure ? [failure.shipmentId] : input.shipmentIds,
        existingBatchId: failure ? (previous?.batchId ?? undefined) : undefined,
        onProgress: update,
        assertActive: () => {
          if (unmounted.current) {
            throw new Error('화면을 떠나 출고 준비를 중단했어요.');
          }
        },
      });

      update(next);
    } catch (error) {
      if (unmounted.current) {
        return;
      }

      setProgress(previous);
      toast.error(
        getServerDenyMessage(error, '출고 준비를 처리하지 못했어요.')
      );
    } finally {
      running.current = false;

      if (!unmounted.current) {
        setBusy(false);
      }
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !running.current) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-[560px]"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {!progress
              ? source === 'mergeable'
                ? `합칠 수 있는 ${shipments.length}건을 따로 출고 준비할까요?`
                : `${source === 'resume' ? '이어서 처리' : '완전출고'} ${shipments.length}건을 출고 준비할까요?`
              : busy
                ? '출고 준비 중이에요'
                : progress.joined === progress.total
                  ? `${progress.total}상자 출고 준비를 마쳤어요`
                  : `${progress.total}상자 중 ${progress.joined}상자를 준비했어요`}
          </DialogTitle>
          <DialogDescription>
            {!progress
              ? '상자 확정, 송장 발급, 출고 배치에 담기까지 한 번에 해요.'
              : busy
                ? '상자가 많으면 1분 가까이 걸릴 수 있어요. 창을 닫지 말아 주세요.'
                : progress.batchId && progress.joined > 0
                  ? `송장 ${progress.waybilled}장을 발급했고, 출고 배치 "${progress.batchName}"에 담았어요. 이제 이 배치로 피킹을 시작하면 돼요.`
                  : '출고 배치에 담은 상자가 없어요.'}
          </DialogDescription>
        </DialogHeader>
        {progress ? (
          <div className="space-y-3">
            <ul
              className="space-y-1.5 text-sm"
              role="status"
              aria-live="polite"
            >
              <Step
                label="상자 확정"
                count={progress.planned}
                total={progress.total}
                active={busy && progress.stage === 'plan'}
              />
              <Step
                label="송장 발급"
                count={progress.waybilled}
                total={progress.total}
                active={busy && progress.stage === 'waybill'}
              />
              <Step
                label="출고 배치에 담기"
                count={progress.joined}
                total={progress.total}
                active={
                  busy &&
                  (progress.stage === 'batch' || progress.stage === 'join')
                }
              />
            </ul>
            {progress.retrying && (
              <p className="text-xs text-muted-foreground">
                연결이 잠깐 끊겨서 다시 시도하고 있어요.
              </p>
            )}
            {progress.failures.length > 0 && (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                <p className="text-sm font-semibold">
                  {progress.failures.length}상자는 준비하지 못했어요
                </p>
                {progress.failures.map((failure) => {
                  const shipment = shipments.find(
                    (item) => item.shipmentId === failure.shipmentId
                  );

                  return (
                    <div
                      key={failure.shipmentId}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div>
                        <p className="font-medium">
                          {plannedOrderText(
                            shipment ?? {
                              shipmentId: failure.shipmentId,
                              orderNos: [],
                            }
                          )}
                        </p>
                        <p className="text-muted-foreground">
                          {failure.message}
                        </p>
                      </div>
                      {/* 확정 오류도 [다시 시도]를 남긴다(스펙 §5.1) — 상자에서 고친 뒤 이 창에서 이어 간다. */}
                      <div className="flex shrink-0 gap-2">
                        {!failure.retryable && (
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              href={`/order/fulfillments?shipmentId=${encodeURIComponent(failure.shipmentId)}`}
                            >
                              상자 보기
                            </Link>
                          </Button>
                        )}
                        <Can run={useRunOutboundPreparation}>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void run(failure)}
                          >
                            다시 시도
                          </Button>
                        </Can>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm">
            피킹 방식: {PICKING_METHOD_LABELS[input.pickingMethod]}
            {input.pickingMethod === 'multi_order' &&
              ` · 카트 용량 ${input.cartCapacity}`}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {progress ? '닫기' : '취소'}
          </Button>
          {!progress && (
            <Can run={useRunOutboundPreparation}>
              <Button disabled={busy} onClick={() => void run()}>
                시작
              </Button>
            </Can>
          )}
          {progress?.batchId && !busy && (
            <Button asChild>
              <Link
                href={`/order/outbound-batches?batchId=${encodeURIComponent(progress.batchId)}`}
              >
                출고 배치 열기
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  label,
  count,
  total,
  active,
}: {
  label: string;
  count: number;
  total: number;
  active: boolean;
}) {
  const done = count === total;

  return (
    <li
      className={cn(
        'flex items-center gap-1.5',
        done || active
          ? 'font-semibold text-foreground'
          : 'text-muted-foreground'
      )}
    >
      {done ? (
        <Check className="size-4" aria-hidden />
      ) : active ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <span className="size-4" aria-hidden />
      )}
      {label} {count}/{total}
    </li>
  );
}
