'use client';

import { toast } from 'sonner';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { getServerDenyMessage } from '@/lib/api/server-error';
import type { CarrierTrackingItem } from '@/lib/api/domains/orders/carrier-tracking.client';
import {
  useConfirmCarrierTracking,
  useRecheckCarrierTracking,
} from '@/lib/services/orders/carrier-tracking';
import { recheckResult } from './carrier-tracking-copy';

/** 한 송장에서 할 수 있는 일 — 다시 조회와 확인 기록 */
export function CarrierTrackingActions({
  item,
  onConfirm,
}: {
  item: CarrierTrackingItem;
  onConfirm: (item: CarrierTrackingItem) => void;
}) {
  const recheck = useRecheckCarrierTracking();

  const run = async () => {
    try {
      const { items } = await recheck.mutateAsync(item.dispatchAttemptId);
      const result = recheckResult(
        item,
        items.find((row) => row.dispatchAttemptId === item.dispatchAttemptId),
        new Date()
      );
      toast[result.tone](result.text);
    } catch (error) {
      toast.error(getServerDenyMessage(error, '다시 조회하지 못했어요.'));
    }
  };

  return (
    <>
      <Can run={useRecheckCarrierTracking}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={recheck.isPending}
          onClick={() => void run()}
        >
          {recheck.isPending ? '묻는 중…' : '지금 다시 조회'}
        </Button>
      </Can>
      {item.kind !== null && (
        <Can run={useConfirmCarrierTracking}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onConfirm(item)}
          >
            확인 기록
          </Button>
        </Can>
      )}
    </>
  );
}
