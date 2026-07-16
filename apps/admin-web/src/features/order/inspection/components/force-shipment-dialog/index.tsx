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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  getServerDenyMessage,
  parseServerError,
  useForceShipmentDispatch,
} from '@/lib/services/orders';
import { inspectionServerDenyMessage } from '../../inspection-view-model';
import { useWarehouseCommandRetry } from '../../../outbound-batches/warehouse-command-retry';

interface Props {
  shipmentId: string;
  onClose: () => void;
}

export function ForceShipmentDialog({ shipmentId, onClose }: Props) {
  const mutation = useForceShipmentDispatch();
  const [reason, setReason] = useState('');
  const [caseId, setCaseId] = useState('');
  const [note, setNote] = useState('');
  const retry = useWarehouseCommandRetry();

  const submit = async () => {
    const payload = {
      reason: reason.trim(),
      csCaseId: caseId.trim() || undefined,
      note: note.trim() || undefined,
    };
    try {
      await retry.execute('force-dispatch', payload, (data, idempotencyKey) =>
        mutation.mutateAsync({ shipmentId, data, idempotencyKey })
      );
      toast.success(
        '강제 출고 명령을 접수했습니다. provider 반영 상태는 shipment에서 확인하세요.'
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
          <DialogTitle>Shipment 강제 출고</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="font-mono text-xs text-muted-foreground">
            {shipmentId}
          </p>
          <div className="space-y-1">
            <Label>사유</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>CS case ID</Label>
            <Input
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>메모</Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <p className="text-xs text-destructive">
            버튼 숨김은 편의 기능일 뿐이며 서버가 최종 authorization 경계입니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={!reason.trim() || mutation.isPending}
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
