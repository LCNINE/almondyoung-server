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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  getServerDenyMessage,
  isRecoverableOperation,
  useFulfillmentOperation,
  useReportShipmentShortPick,
} from '@/lib/services/orders';
import type {
  OutboundBatchV2,
  ShipmentAdminDetail,
  ShipmentShortPickOperation,
  ShipmentShortPickReason,
} from '@/lib/types/dto/fulfillment';
import { useWarehouseCommandRetry } from '../../../outbound-batches/warehouse-command-retry';
import { ServerDenyFeedback } from '../../../operation-access-feedback';

interface Props {
  batch: OutboundBatchV2;
  shipment: ShipmentAdminDetail;
  workItemId: string;
  shipmentLineId: string;
  sourceLocationId: string;
  onClose: () => void;
}

export function ShortPickDialog({
  batch,
  shipment,
  workItemId,
  shipmentLineId,
  sourceLocationId,
  onClose,
}: Props) {
  const mutation = useReportShipmentShortPick();
  const [reason, setReason] =
    useState<ShipmentShortPickReason>('inventory_shortage');
  const [shortQty, setShortQty] = useState(1);
  const [caseId, setCaseId] = useState('');
  const [note, setNote] = useState('');
  const [shortPickOperation, setShortPickOperation] =
    useState<ShipmentShortPickOperation | null>(null);
  const retry = useWarehouseCommandRetry();
  const operation = useFulfillmentOperation(
    shortPickOperation?.operationId ?? ''
  );
  const workItem = batch.workItems.find((item) => item.id === workItemId);
  const line = shipment.lines.find((item) => item.id === shipmentLineId);
  const plan = batch.pickingPlan;
  const session = batch.inventorySession;
  const operationStatus =
    operation.data?.status ?? shortPickOperation?.operationStatus;
  const commandRetained = retry.hasPending('short-pick');
  const operationCompleted =
    operationStatus === 'completed' || operationStatus === 'succeeded';

  const submit = async () => {
    if (!workItem || !line || !plan || !session) return;
    const payload = {
      workItemId,
      expectedWorkItemLeaseVersion: workItem.leaseVersion,
      planId: plan.id,
      expectedPlanVersion: plan.version,
      sessionId: session.id,
      expectedSessionVersion: session.version,
      expectedManifestVersion: shipment.manifestVersion,
      lines: [
        {
          shipmentLineId,
          sourceLocationId,
          expectedLineVersion: line.lineVersion,
          shortQty,
        },
      ],
      reason,
      csCaseId: caseId.trim() || undefined,
      note: note.trim() || undefined,
    };
    try {
      const result = await retry.execute(
        'short-pick',
        payload,
        (data, idempotencyKey) =>
          mutation.mutateAsync({
            shipmentId: shipment.id,
            data,
            idempotencyKey,
          }),
        {
          retainAfterResponse: (response) =>
            isRecoverableOperation(response.operationStatus),
        }
      );
      setShortPickOperation(result);
      if (result.operationStatus === 'completed') {
        toast.success('short-pick 작업이 완료되었습니다.');
        onClose();
      } else {
        toast.info(
          'short-pick 작업을 접수했습니다. 원래 요청과 키를 보존하며 서버 상태를 확인합니다.'
        );
      }
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Short-pick 보고</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded border p-3 font-mono text-xs">
            <p>
              work item {workItemId} · lease v{workItem?.leaseVersion ?? '?'}
            </p>
            <p>
              plan {plan?.id ?? '—'} · v{plan?.version ?? '?'}
            </p>
            <p>
              session {session?.id ?? '—'} · v{session?.version ?? '?'}
            </p>
            <p>
              shipment {shipment.id} · manifest v{shipment.manifestVersion}
            </p>
            <p>
              line {shipmentLineId} · v{line?.lineVersion ?? '?'} · source{' '}
              {sourceLocationId}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>부족 수량</Label>
              <Input
                type="number"
                min={1}
                value={shortQty}
                onChange={(event) => setShortQty(Number(event.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label>사유</Label>
              <Select
                value={reason}
                onValueChange={(value) =>
                  setReason(value as ShipmentShortPickReason)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inventory_shortage">재고 부족</SelectItem>
                  <SelectItem value="item_damaged">상품 파손</SelectItem>
                  <SelectItem value="quality_defect">품질 불량</SelectItem>
                  <SelectItem value="expired_stock">유효기간 만료</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>CS case ID (선택)</Label>
            <Input
              value={caseId}
              onChange={(event) => setCaseId(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>메모 (선택)</Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {shortPickOperation && (
            <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/20">
              <p className="font-medium">
                작업 상태: {operationStatus ?? 'pending'}
              </p>
              <p className="font-mono">
                operation {shortPickOperation.operationId}
              </p>
              {isRecoverableOperation(operationStatus) && (
                <p>
                  완료 확인 전까지 원래 payload와 Idempotency-Key를 보존합니다.
                  아래 버튼은 같은 요청과 키로만 재시도합니다.
                </p>
              )}
              {operation.data?.lastError && (
                <p className="text-destructive">{operation.data.lastError}</p>
              )}
              {operation.isError && (
                <ServerDenyFeedback
                  error={operation.error}
                  fallback="작업 상태를 조회하지 못했습니다."
                />
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {shortPickOperation ? '닫기' : '취소'}
          </Button>
          {!operationCompleted && (
            <Button
              variant="destructive"
              onClick={submit}
              disabled={
                !workItem ||
                !line ||
                !plan ||
                !session ||
                shortQty < 1 ||
                mutation.isPending
              }
            >
              {mutation.isPending
                ? '서버 확인 중…'
                : commandRetained
                  ? '동일 키로 안전 재시도'
                  : '보고'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
