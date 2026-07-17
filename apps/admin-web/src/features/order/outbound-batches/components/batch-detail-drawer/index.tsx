'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { usePermission } from '@/hooks/use-permission';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FULFILLMENT_SCOPES,
  getServerDenyMessage,
  useAddShipmentToBatch,
  useClaimBatchPacker,
  useClaimBatchPicker,
  useCreatePickingPlan,
  useExcludeShipmentFromBatch,
  useHandoffBatchWorkItem,
  useOutboundBatchEligibleShipments,
  useOutboundBatchV2,
} from '@/lib/services/orders';
import type { PickingStrategyName } from '@/lib/types/dto/fulfillment';
import { BatchStatusBadge } from '../batch-status-badge';
import { useWarehouseCommandRetry } from '../../warehouse-command-retry';

interface Props {
  batchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STRATEGY_LABELS: Record<PickingStrategyName, string> = {
  discrete: '개별 피킹',
  aggregate_then_sort: '합산 후 분류',
  pick_to_tote: 'Tote 피킹',
};

export function BatchDetailDrawer({ batchId, open, onOpenChange }: Props) {
  const { hasScope, isPermissionLoading } = usePermission();
  const { data: batch, isLoading, refetch } = useOutboundBatchV2(batchId);
  const { data: eligible = [] } = useOutboundBatchEligibleShipments(batchId);
  const addShipment = useAddShipmentToBatch();
  const excludeShipment = useExcludeShipmentFromBatch();
  const claimPicker = useClaimBatchPicker();
  const claimPacker = useClaimBatchPacker();
  const handoff = useHandoffBatchWorkItem();
  const createPlan = useCreatePickingPlan();
  const [strategy, setStrategy] = useState<PickingStrategyName | ''>('');
  const [targetWorkerId, setTargetWorkerId] = useState('');
  const [reason, setReason] = useState('shift_handoff');
  const retry = useWarehouseCommandRetry();
  const canOperateWarehouse =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);

  const supportedStrategies =
    batch?.warehouse?.supportedPickingStrategies ?? [];
  const shipmentIds = useMemo(
    () =>
      batch?.workItems
        .filter((item) => !item.exclusionReason)
        .map((item) => item.shipmentId) ?? [],
    [batch]
  );

  const command = async <T,>(
    action: string,
    payload: T,
    run: (payload: T, key: string) => Promise<unknown>
  ) => {
    try {
      await retry.execute(action, payload, run);
      toast.success('명령을 접수했습니다. 서버 상태를 다시 확인합니다.');
      await refetch();
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  if (!open) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[900px] overflow-auto sm:max-w-[900px]">
        <SheetHeader>
          <SheetTitle>V2 배치 상세</SheetTitle>
        </SheetHeader>
        {isLoading || !batch ? (
          <p className="mt-4 text-sm text-muted-foreground">
            서버 스냅샷을 불러오는 중…
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-muted-foreground">배치</p>
                <p className="font-medium">{batch.name || batch.batchNumber}</p>
              </div>
              <div>
                <p className="text-muted-foreground">상태</p>
                <BatchStatusBadge status={batch.status} />
              </div>
              <div>
                <p className="text-muted-foreground">창고</p>
                <p>{batch.warehouse?.name || batch.warehouseId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">수량</p>
                <p>
                  {batch.totalItems} 라인 / {batch.totalQty}개
                </p>
              </div>
            </div>

            <section className="space-y-3">
              <h3 className="font-medium">피킹 계획</h3>
              {canOperateWarehouse && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label>창고 지원 전략</Label>
                    <Select
                      value={strategy}
                      onValueChange={(value) =>
                        setStrategy(value as PickingStrategyName)
                      }
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="전략 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {supportedStrategies.map((item) => (
                          <SelectItem key={item} value={item}>
                            {STRATEGY_LABELS[item]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    disabled={
                      !strategy ||
                      shipmentIds.length === 0 ||
                      createPlan.isPending
                    }
                    onClick={() =>
                      command(
                        'plan',
                        {
                          batchId,
                          strategy: strategy as PickingStrategyName,
                          shipmentIds,
                        },
                        (data, idempotencyKey) =>
                          createPlan.mutateAsync({ data, idempotencyKey })
                      )
                    }
                  >
                    {retry.hasPending('plan')
                      ? '원래 명령 재시도'
                      : '계획 생성'}
                  </Button>
                </div>
              )}
              {canOperateWarehouse && supportedStrategies.length === 0 && (
                <p className="text-sm text-destructive">
                  이 창고가 지원하는 피킹 전략이 없습니다. 계획을 만들 수
                  없습니다.
                </p>
              )}
              {batch.pickingPlan && (
                <div className="rounded border p-3 text-sm">
                  <p>
                    <b>{STRATEGY_LABELS[batch.pickingPlan.strategy]}</b> ·{' '}
                    {batch.pickingPlan.status} · v{batch.pickingPlan.version}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    plan {batch.pickingPlan.id}
                  </p>
                </div>
              )}
            </section>

            <Separator />
            <section className="space-y-3">
              <h3 className="font-medium">Eligible shipment</h3>
              {eligible.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  추가할 수 있는 shipment가 없습니다.
                </p>
              ) : (
                <div className="max-h-48 overflow-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Shipment</TableHead>
                        <TableHead>Waybill</TableHead>
                        <TableHead className="text-right">수량</TableHead>
                        {canOperateWarehouse && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eligible.map((item) => (
                        <TableRow key={item.shipmentId}>
                          <TableCell>
                            <Link
                              className="font-mono text-xs hover:underline"
                              href={`/order/fulfillments?shipmentId=${item.shipmentId}`}
                            >
                              {item.shipmentId}
                            </Link>
                            <p className="text-[10px] text-muted-foreground">
                              manifest v{item.manifestVersion} / reservation v
                              {item.reservationVersion}
                            </p>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.trackingNo}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.totalQty}
                          </TableCell>
                          {canOperateWarehouse && (
                            <TableCell>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  command(
                                    `add:${item.shipmentId}`,
                                    { batchId, shipmentId: item.shipmentId },
                                    (data, idempotencyKey) =>
                                      addShipment.mutateAsync({
                                        ...data,
                                        idempotencyKey,
                                      })
                                  )
                                }
                              >
                                추가
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            <Separator />
            <section className="space-y-3">
              <div>
                <h3 className="font-medium">Work item queue</h3>
                <p className="text-xs text-muted-foreground">
                  claim/handoff 결과는 서버 스냅샷이 갱신된 뒤 표시됩니다.
                  Picker handoff는 plan/session custody가 필요한 피킹
                  작업대에서만 실행하며, 여기서는 packer handoff만 제공합니다.
                </p>
              </div>
              {canOperateWarehouse && (
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>handoff 대상 작업자</Label>
                    <Input
                      value={targetWorkerId}
                      onChange={(event) =>
                        setTargetWorkerId(event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>사유</Label>
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                </div>
              )}
              <div className="overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shipment / item</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>Picker</TableHead>
                      <TableHead>Packer</TableHead>
                      {canOperateWarehouse && <TableHead>작업</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.workItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p className="font-mono text-xs">{item.shipmentId}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {item.id} · lease v{item.leaseVersion}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.recoveryReason ? 'destructive' : 'outline'
                            }
                          >
                            {item.recoveryReason
                              ? 'recovery_required'
                              : item.status}
                          </Badge>
                          {item.exclusionReason && (
                            <p className="text-xs text-destructive">
                              제외: {item.exclusionReason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {item.pickerClaim.state}
                          <br />
                          {item.pickerClaim.workerId || '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {item.packerClaim.state}
                          <br />
                          {item.packerClaim.workerId || '—'}
                        </TableCell>
                        {canOperateWarehouse && (
                          <TableCell>
                            <div className="flex min-w-52 flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  command(
                                    `picker:${item.id}`,
                                    {
                                      batchId,
                                      workItemId: item.id,
                                      data: {
                                        expectedLeaseVersion: item.leaseVersion,
                                      },
                                    },
                                    (payload, idempotencyKey) =>
                                      claimPicker.mutateAsync({
                                        ...payload,
                                        idempotencyKey,
                                      })
                                  )
                                }
                              >
                                Picker claim
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  command(
                                    `packer:${item.id}`,
                                    {
                                      batchId,
                                      workItemId: item.id,
                                      data: {
                                        expectedLeaseVersion: item.leaseVersion,
                                      },
                                    },
                                    (payload, idempotencyKey) =>
                                      claimPacker.mutateAsync({
                                        ...payload,
                                        idempotencyKey,
                                      })
                                  )
                                }
                              >
                                Packer claim
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={
                                  !targetWorkerId.trim() || !reason.trim()
                                }
                                onClick={() =>
                                  command(
                                    `handoff:packer:${item.id}`,
                                    {
                                      batchId,
                                      workItemId: item.id,
                                      data: {
                                        expectedLeaseVersion: item.leaseVersion,
                                        claimType: 'packer' as const,
                                        targetWorkerId: targetWorkerId.trim(),
                                        reason: reason.trim(),
                                      },
                                    },
                                    (payload, idempotencyKey) =>
                                      handoff.mutateAsync({
                                        ...payload,
                                        idempotencyKey,
                                      })
                                  )
                                }
                              >
                                Packer handoff
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  command(
                                    `exclude:${item.id}`,
                                    {
                                      batchId,
                                      shipmentId: item.shipmentId,
                                      reason:
                                        reason.trim() || 'operator_excluded',
                                    },
                                    (payload, idempotencyKey) =>
                                      excludeShipment.mutateAsync({
                                        ...payload,
                                        idempotencyKey,
                                      })
                                  )
                                }
                              >
                                제외
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <Separator />
            <section className="space-y-2">
              <h3 className="font-medium">Custody / inventory session</h3>
              {!batch.inventorySession ? (
                <p className="text-sm text-muted-foreground">
                  피킹 시작 전입니다.
                </p>
              ) : (
                <div className="rounded border p-3 text-sm">
                  <p>
                    session{' '}
                    <span className="font-mono">
                      {batch.inventorySession.id}
                    </span>{' '}
                    · {batch.inventorySession.status} · v
                    {batch.inventorySession.version}
                  </p>
                  <p>
                    handed-in {batch.inventorySession.handedInQty} / settled{' '}
                    {batch.inventorySession.settledQty} / returned{' '}
                    {batch.inventorySession.returnedQty} / shortage{' '}
                    {batch.inventorySession.shortageQty}
                  </p>
                  {batch.inventorySession.balances.map((balance) => (
                    <p
                      key={balance.id}
                      className="font-mono text-xs text-muted-foreground"
                    >
                      {balance.custodyType}:{balance.custodyRef || '—'} ←{' '}
                      {balance.sourceLocationId || '—'} · {balance.skuId} ×{' '}
                      {balance.quantity}
                    </p>
                  ))}
                </div>
              )}
              {batch.toteAssignments.map((tote) => (
                <div key={tote.id} className="rounded border p-2 text-xs">
                  <Badge variant="secondary">TOTE {tote.toteStatus}</Badge>{' '}
                  <span className="font-mono">{tote.toteBarcode}</span> →
                  shipment {tote.shipmentId}
                </div>
              ))}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
