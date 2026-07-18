'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePermission } from '@/hooks/use-permission';
import {
  FULFILLMENT_SCOPES,
  getServerDenyMessage,
  useOutboundBatchV2,
  useShipmentDetail,
  useShipmentInspectionScan,
} from '@/lib/services/orders';
import { ForceShipmentDialog } from '../force-shipment-dialog';
import { useWarehouseCommandRetry } from '../../../outbound-batches/warehouse-command-retry';

export function InspectionSessionStarter() {
  const [batchIdInput, setBatchIdInput] = useState('');
  const [batchId, setBatchId] = useState('');
  const [shipmentId, setShipmentId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const retry = useWarehouseCommandRetry();
  const [forceOpen, setForceOpen] = useState(false);
  const { data: batch, isLoading, refetch } = useOutboundBatchV2(batchId);
  const { data: shipment } = useShipmentDetail(shipmentId);
  const scan = useShipmentInspectionScan();
  const { hasScope, isPermissionLoading } = usePermission();
  const mayForceDispatch =
    !isPermissionLoading &&
    Boolean(hasScope([FULFILLMENT_SCOPES.forceDispatch]));
  const workItem = batch?.workItems.find(
    (item) => item.shipmentId === shipmentId
  );
  const lineIds = useMemo(
    () => new Set(shipment?.lines.map((line) => line.id) ?? []),
    [shipment?.lines]
  );
  const balances =
    batch?.inventorySession?.balances.filter(
      (balance) => balance.shipmentLineId && lineIds.has(balance.shipmentLineId)
    ) ?? [];
  const inspectionReady =
    Boolean(workItem?.completedAt) &&
    balances.some((balance) => balance.custodyType === 'PACKING');

  const submitScan = async () => {
    const payload = {
      shipmentId,
      data: { barcode: barcode.trim(), quantity },
    };
    try {
      await retry.execute(
        'inspection-scan',
        payload,
        (original, idempotencyKey) =>
          scan.mutateAsync({
            shipmentId: original.shipmentId,
            data: original.data,
            idempotencyKey,
          })
      );
      toast.success(
        '검수 scan을 접수했습니다. 서버 집계 상태를 다시 확인합니다.'
      );
      setBarcode('');
      await refetch();
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>V2 batch ID</Label>
          <Input
            className="w-96"
            value={batchIdInput}
            onChange={(event) => setBatchIdInput(event.target.value)}
          />
        </div>
        <Button
          disabled={!batchIdInput.trim()}
          onClick={() => setBatchId(batchIdInput.trim())}
        >
          조회
        </Button>
      </div>
      {isLoading && (
        <p className="text-sm text-muted-foreground">
          inspection-ready 작업을 불러오는 중…
        </p>
      )}
      {batch && (
        <Card className="space-y-4 p-4">
          <div className="space-y-1">
            <Label>Shipment / inspection-ready work item</Label>
            <Select value={shipmentId} onValueChange={setShipmentId}>
              <SelectTrigger>
                <SelectValue placeholder="shipment 선택" />
              </SelectTrigger>
              <SelectContent>
                {batch.workItems.map((item) => (
                  <SelectItem key={item.id} value={item.shipmentId}>
                    {item.shipmentId} · {item.status}
                    {item.completedAt ? ' · picking complete' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {shipmentId && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={inspectionReady ? 'default' : 'destructive'}>
                  {inspectionReady ? 'inspection-ready' : 'custody 확인 필요'}
                </Badge>
                <Badge variant="outline">
                  shipment {shipment?.status ?? 'loading'}
                </Badge>
                <Badge variant="outline">
                  channel {shipment?.channelProjectionStatus ?? '—'}
                </Badge>
              </div>
              <div className="rounded border p-3 text-sm">
                <p className="font-mono text-xs">
                  session {batch.inventorySession?.id ?? '—'} · v
                  {batch.inventorySession?.version ?? '—'} / work item{' '}
                  {workItem?.id ?? '—'} · lease v{workItem?.leaseVersion ?? '—'}
                </p>
                {balances.length === 0 ? (
                  <p className="mt-2 text-muted-foreground">
                    이 shipment에 귀속된 session balance가 없습니다.
                  </p>
                ) : (
                  balances.map((balance) => (
                    <p key={balance.id} className="mt-1 font-mono text-xs">
                      custody {balance.custodyType}:{balance.custodyRef || '—'}{' '}
                      ← source {balance.sourceLocationId || '—'} ·{' '}
                      {balance.skuId} × {balance.quantity}
                    </p>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label>Barcode</Label>
                  <Input
                    value={barcode}
                    onChange={(event) => setBarcode(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>수량</Label>
                  <Input
                    className="w-24"
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(event) =>
                      setQuantity(Number(event.target.value))
                    }
                  />
                </div>
                <Button
                  disabled={
                    !inspectionReady ||
                    !barcode.trim() ||
                    quantity < 1 ||
                    scan.isPending
                  }
                  onClick={submitScan}
                >
                  {scan.isPending
                    ? '서버 확인 중…'
                    : retry.hasPending('inspection-scan')
                      ? '원래 명령 재시도'
                      : '검수 scan'}
                </Button>
                {mayForceDispatch && (
                  <Button
                    variant="destructive"
                    onClick={() => setForceOpen(true)}
                  >
                    강제 출고
                  </Button>
                )}
              </div>
              {!mayForceDispatch && !isPermissionLoading && (
                <p className="text-xs text-muted-foreground">
                  강제 출고는 {FULFILLMENT_SCOPES.forceDispatch} scope
                  보유자에게만 표시됩니다.
                </p>
              )}
            </>
          )}
        </Card>
      )}
      {forceOpen && shipmentId && (
        <ForceShipmentDialog
          shipmentId={shipmentId}
          onClose={() => {
            setForceOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
