'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getServerDenyMessage,
  parseServerError,
  useForceShipmentDispatch,
} from '@/lib/services/orders';
import { OperationReasonFields } from '../../../fulfillments/detail/operation-reason-fields';
import {
  canSubmitOperationReason,
  toOperationReasonPayload,
  type OperationReasonValue,
} from '../../../fulfillments/detail/operation-reasons';
import { inspectionServerDenyMessage } from '../../inspection-view-model';
import { useWarehouseCommandRetry } from '../../../outbound-batches/warehouse-command-retry';

interface Props {
  shipmentId: string;
  onClose: () => void;
}

export function ForceShipmentDialog({ shipmentId, onClose }: Props) {
  const mutation = useForceShipmentDispatch();
  const [reasonValue, setReasonValue] = useState<OperationReasonValue>({
    otherText: '',
    note: '',
  });
  const [showErrors, setShowErrors] = useState(false);
  const retry = useWarehouseCommandRetry();

  const submit = async () => {
    if (!canSubmitOperationReason('force_dispatch', reasonValue)) {
      setShowErrors(true);
      return;
    }
    const payload = toOperationReasonPayload('force_dispatch', reasonValue);
    try {
      await retry.execute('force-dispatch', payload, (data, idempotencyKey) =>
        mutation.mutateAsync({ shipmentId, data, idempotencyKey })
      );
      toast.success(
        '강제 출고를 접수했어요. 출고 상세에서 처리 결과를 확인해 주세요.'
      );
      onClose();
    } catch (error) {
      const parsed = parseServerError(error);
      toast.error(
        inspectionServerDenyMessage(parsed) ?? getServerDenyMessage(error)
      );
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>강제 출고</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            상자 {shipmentId.slice(0, 8)}
          </p>
          <OperationReasonFields
            type="force_dispatch"
            value={reasonValue}
            onChange={setReasonValue}
            showErrors={showErrors}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? '서버 확인 중…'
              : retry.hasPending('force-dispatch')
                ? '원래 명령 재시도'
                : '강제 출고'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
