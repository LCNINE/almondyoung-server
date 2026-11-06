'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
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
import { plannedOrderText } from '../../waybill-issue/waybill-issue-model';
import {
  RETRY_DELAYS_MS,
  type PreparationFailure,
  type PreparationInput,
  type PreparationProgress,
} from '../run-outbound-preparation';

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
            {progress
              ? '출고 준비 진행 상황'
              : source === 'mergeable'
                ? `합칠 수 있는 ${shipments.length}건을 따로 출고 준비할까요?`
                : `${source === 'resume' ? '이어서 처리' : '완전출고'} ${shipments.length}건을 출고 준비할까요?`}
          </DialogTitle>
          <DialogDescription>
            계획 확정 → 한진 송장 발급 → 배치 생성까지 한 번에 해요.
          </DialogDescription>
        </DialogHeader>
        {progress ? (
          <div className="space-y-3">
            <div
              className="space-y-2 text-sm font-semibold text-foreground"
              role="status"
              aria-live="polite"
            >
              <p>
                계획 확정 {progress.planned} / {progress.total}
              </p>
              <p>
                송장 발급 {progress.waybilled} / {progress.total}
              </p>
              {progress.batchId && (
                <p>
                  배치 "{progress.batchName}" 생성, {progress.joined}건 담음
                </p>
              )}
              {progress.retrying && <p>재시도 중이에요</p>}
            </div>
            {progress.retrying && (
              <p className="text-xs text-muted-foreground">
                잠시 뒤 다시 확인해요. 재시도 간격:{' '}
                {RETRY_DELAYS_MS.map((delay) => `${delay / 1000}초`).join(', ')}
              </p>
            )}
            {progress.failures.length > 0 && (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                <p className="text-sm font-semibold">
                  실패 {progress.failures.length}건
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
                배치로 가기
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
