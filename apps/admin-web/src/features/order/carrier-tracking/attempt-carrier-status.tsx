'use client';

import { useEffect, useState } from 'react';
import { useCan } from '@/hooks/use-permission';
import { useShipmentCarrierTracking } from '@/lib/services/orders/carrier-tracking';
import type { CarrierTrackingItem } from '@/lib/api/domains/orders/carrier-tracking.client';
import { useOperatorNames } from '@/features/order/fulfillments/detail/operation-operator';
import { CarrierConfirmDialog } from './carrier-confirm-dialog';
import { CarrierTrackingActions } from './carrier-tracking-actions';
import {
  attentionText,
  confirmationText,
  lastCheckText,
  nextStepText,
  normalText,
} from './carrier-tracking-copy';

/** 상자 상세의 출고 기록 한 건에 붙는 택배사 상태 */
export function AttemptCarrierStatus({
  shipmentId,
  attemptId,
}: {
  shipmentId: string;
  attemptId: string;
}) {
  const read = useCan(['fulfillment.order.read']);
  const recall = useCan(['fulfillment.dispatch.recall']);
  const q = useShipmentCarrierTracking(
    shipmentId,
    read.status === 'ready' && read.allowed
  );
  const item = q.data?.items.find((row) => row.dispatchAttemptId === attemptId);
  const actorName = useOperatorNames(
    (item?.confirmations ?? []).map((row) => row.actorId)
  );
  const [confirming, setConfirming] = useState<CarrierTrackingItem | null>(
    null
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const failed = q.isError && (
    <p role="alert" className="text-xs text-destructive">
      택배사 상태를 불러오지 못했어요.
      {item ? ' 조금 전 내용이에요. ' : ' '}
      <button
        type="button"
        className="underline"
        onClick={() => void q.refetch()}
      >
        다시 확인
      </button>
    </p>
  );
  if (!item) return failed || null;
  const attention = attentionText(item, now);

  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
      {failed}
      {attention ? (
        <p className="break-keep font-medium text-destructive">{attention}</p>
      ) : (
        <p className="break-keep">{normalText(item, now)}</p>
      )}
      <p className="break-keep text-muted-foreground">
        {lastCheckText(item, now)}
      </p>
      {item.raised && (
        <p className="break-keep">
          {nextStepText(item.kind, recall.status === 'ready' && recall.allowed)}
        </p>
      )}
      {item.confirmations.map((row) => (
        <p key={row.id} className="break-words text-muted-foreground">
          확인 기록: {confirmationText(row, actorName(row.actorId))}
        </p>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <CarrierTrackingActions item={item} onConfirm={setConfirming} />
      </div>
      {confirming && (
        <CarrierConfirmDialog
          opened={confirming}
          latest={item}
          now={now}
          actorName={actorName}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
