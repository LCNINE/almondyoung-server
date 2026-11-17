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
  isShortPickSettled,
  shortPickOutcomeMessage,
  shortPickRejectionMessage,
  useFulfillmentOperation,
  useReportShipmentShortPick,
} from '@/lib/services/orders';
import type {
  OutboundBatchV2,
  ShipmentAdminDetail,
  ShipmentShortPickOperation,
  ShipmentShortPickReason,
} from '@/lib/types/dto/fulfillment';
import { operationStatusLabel } from '../../../fulfillments/detail/shipment-action-copy';
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
  const [note, setNote] = useState('');
  const [shortPickOperation, setShortPickOperation] =
    useState<ShipmentShortPickOperation | null>(null);
  const retry = useWarehouseCommandRetry();
  const operation = useFulfillmentOperation(
    shortPickOperation?.operationId ?? ''
  );
  const workItem = batch.workItems.find((item) => item.id === workItemId);
  const line = shipment.lines.find((item) => item.id === shipmentLineId);
  const picking = batch.picking;
  const session = batch.inventorySession;
  const operationStatus =
    operation.data?.status ?? shortPickOperation?.operationStatus;
  const commandRetained = retry.hasPending('short-pick');
  const operationCompleted =
    operationStatus === 'completed' || operationStatus === 'succeeded';

  const submit = async () => {
    if (!workItem || !line || !picking || !session) return;
    const payload = {
      workItemId,
      expectedWorkItemLeaseVersion: workItem.leaseVersion,
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
            !isShortPickSettled(response) &&
            isRecoverableOperation(response.operationStatus),
        }
      );
      setShortPickOperation(result);
      const message = shortPickOutcomeMessage(result);
      if (message) {
        if (message.tone === 'success') toast.success(message.text);
        else toast.info(message.text);
        onClose();
      } else if (result.operationStatus === 'completed') {
        toast.success('결품 처리를 마쳤어요.');
        onClose();
      } else {
        toast.info('결품 처리를 접수했어요. 처리 결과를 확인하고 있어요.');
      }
    } catch (error) {
      toast.error(shortPickRejectionMessage(error) ?? getServerDenyMessage(error));
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>결품 보고</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded border p-3 text-xs">
            <p>상자 {shipment.id.slice(0, 8)}</p>
            <p>
              {line ? (line.skuName ?? '상품') : '상품'} · 주문 수량{' '}
              {line?.qty ?? '?'}개
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
              <p className="text-xs text-muted-foreground">
                아직 집지 않은 수량 중 로케이션에 없는 것만 적어요. 이미 집은
                상품의 파손은 결품이 아니에요.
              </p>
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
            <Label>메모 (선택)</Label>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {shortPickOperation && (
            <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/20">
              <p className="font-medium">
                처리 상태: {operationStatusLabel(operationStatus ?? 'pending')}
              </p>
              {isRecoverableOperation(operationStatus) && (
                <p>
                  완료를 확인할 때까지 같은 요청으로 다시 시도할 수 있어요.
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
                !picking ||
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
