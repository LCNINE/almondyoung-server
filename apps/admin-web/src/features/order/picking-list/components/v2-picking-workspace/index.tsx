'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePermission } from '@/hooks/use-permission';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getServerDenyMessage,
  FULFILLMENT_SCOPES,
  useAggregateBulkCartScan,
  useAggregateCartHandoff,
  useAggregateSortScan,
  useAssignTote,
  useCompletePickingV2,
  useDiscretePickingScan,
  useOutboundBatchV2,
  usePickingHandoff,
  useRegisterTote,
  useReleaseTote,
  useShipmentDetail,
  useStartPickingV2,
  useToteHandoff,
  useToteScan,
} from '@/lib/services/orders';
import { ShortPickDialog } from '../short-pick-dialog';
import { useWarehouseCommandRetry } from '../../../outbound-batches/warehouse-command-retry';

export function V2PickingWorkspace() {
  const { hasScope, isPermissionLoading } = usePermission();
  const [batchIdInput, setBatchIdInput] = useState('');
  const [batchId, setBatchId] = useState('');
  const { data: batch, isLoading, refetch } = useOutboundBatchV2(batchId);
  const [workItemId, setWorkItemId] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [cartId, setCartId] = useState('');
  const [toteBarcode, setToteBarcode] = useState('');
  const [targetWorkerId, setTargetWorkerId] = useState('');
  const [reason, setReason] = useState('shift_handoff');
  const retry = useWarehouseCommandRetry();
  const [shortPickOpen, setShortPickOpen] = useState(false);
  const canOperateWarehouse =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.operate]);
  const canReportShortPick =
    !isPermissionLoading && !!hasScope([FULFILLMENT_SCOPES.reopen]);

  const start = useStartPickingV2();
  const discreteScan = useDiscretePickingScan();
  const pickingHandoff = usePickingHandoff();
  const complete = useCompletePickingV2();
  const aggregateCollect = useAggregateBulkCartScan();
  const aggregateSort = useAggregateSortScan();
  const aggregateHandoff = useAggregateCartHandoff();
  const registerTote = useRegisterTote();
  const assignTote = useAssignTote();
  const toteScan = useToteScan();
  const toteHandoff = useToteHandoff();
  const releaseTote = useReleaseTote();

  const workItem = batch?.workItems.find((item) => item.id === workItemId);
  const allocation = batch?.pickingPlan?.allocations.find(
    (item) => item.id === allocationId
  );
  const { data: shipment } = useShipmentDetail(workItem?.shipmentId ?? '');
  const plan = batch?.pickingPlan;
  const session = batch?.inventorySession;
  const strategy = plan?.strategy;
  const busy = [
    start,
    discreteScan,
    pickingHandoff,
    complete,
    aggregateCollect,
    aggregateSort,
    aggregateHandoff,
    registerTote,
    assignTote,
    toteScan,
    toteHandoff,
    releaseTote,
  ].some((mutation) => mutation.isPending);
  const assignment = batch?.toteAssignments.find(
    (item) => item.shipmentId === workItem?.shipmentId
  );
  const otherWorkItem = batch?.workItems.find(
    (item) => item.id !== workItemId && !item.exclusionReason
  );

  const relevantAllocations = useMemo(() => {
    if (!batch?.pickingPlan) return [];
    if (!workItem) return batch.pickingPlan.allocations;
    const lineIds = new Set(shipment?.lines.map((line) => line.id) ?? []);
    return batch.pickingPlan.allocations.filter(
      (item) => lineIds.size === 0 || lineIds.has(item.shipmentLineId)
    );
  }, [batch?.pickingPlan, shipment?.lines, workItem]);

  const command = async <T,>(
    action: string,
    payload: T,
    run: (payload: T, key: string) => Promise<unknown>
  ) => {
    try {
      await retry.execute(action, payload, run);
      toast.success('명령을 접수했습니다. 확정 상태를 다시 불러옵니다.');
      await refetch();
    } catch (error) {
      toast.error(getServerDenyMessage(error));
    }
  };

  const context =
    plan && session && workItem
      ? {
          batchId,
          planId: plan.id,
          sessionId: session.id,
          workItemId: workItem.id,
          shipmentId: workItem.shipmentId,
        }
      : null;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label>V2 batch ID</Label>
          <Input
            className="w-96"
            value={batchIdInput}
            onChange={(event) => setBatchIdInput(event.target.value)}
            placeholder="서버가 발급한 outbound batch ID"
          />
        </div>
        <Button
          onClick={() => setBatchId(batchIdInput.trim())}
          disabled={!batchIdInput.trim()}
        >
          조회
        </Button>
      </div>
      {isLoading && (
        <p className="text-sm text-muted-foreground">
          배치 스냅샷을 불러오는 중…
        </p>
      )}
      {batch && (
        <>
          <Card className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <b>{batch.name || batch.batchNumber}</b>
              <Badge>{batch.status}</Badge>
              {plan && (
                <Badge variant="secondary">
                  {plan.strategy} · {plan.status} · v{plan.version}
                </Badge>
              )}
            </div>
            <p className="font-mono text-xs text-muted-foreground">
              batch {batch.id} / plan {plan?.id ?? '미생성'} / inventory session{' '}
              {session?.id ?? '미시작'}
            </p>
            {canOperateWarehouse && plan && !session && (
              <Button
                disabled={start.isPending}
                onClick={() =>
                  command(
                    'start',
                    { batchId, planId: plan.id },
                    (data, idempotencyKey) =>
                      start.mutateAsync({ data, idempotencyKey })
                  )
                }
              >
                {retry.hasPending('start')
                  ? '원래 키로 시작 재시도'
                  : '피킹 시작'}
              </Button>
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-3 p-4">
              <h3 className="font-semibold">실행 context</h3>
              <div className="space-y-1">
                <Label>Work item / shipment</Label>
                <Select
                  value={workItemId}
                  onValueChange={(value) => {
                    setWorkItemId(value);
                    setAllocationId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="work item 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {batch.workItems
                      .filter((item) => !item.exclusionReason)
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.id} · {item.shipmentId}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Allocation / source</Label>
                <Select value={allocationId} onValueChange={setAllocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="allocation 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {relevantAllocations.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.skuId} · {item.sourceLocationId} · line{' '}
                        {item.shipmentLineId} × {item.quantity}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {canOperateWarehouse && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>처리 수량</Label>
                      <Input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(event) =>
                          setQuantity(Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Cart ID</Label>
                      <Input
                        value={cartId}
                        onChange={(event) => setCartId(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label>Tote barcode</Label>
                      <Input
                        value={toteBarcode}
                        onChange={(event) => setToteBarcode(event.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>대상 작업자</Label>
                      <Input
                        value={targetWorkerId}
                        onChange={(event) =>
                          setTargetWorkerId(event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>handoff/release 사유</Label>
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </div>
                </>
              )}
              {workItem && (
                <div className="rounded border p-2 font-mono text-xs">
                  <p>
                    lease v{workItem.leaseVersion} · picker{' '}
                    {workItem.pickerClaim.workerId ||
                      workItem.pickerClaim.state}
                  </p>
                  <p>
                    shipment manifest v{shipment?.manifestVersion ?? 'loading'}{' '}
                    / reservation v{shipment?.reservationVersion ?? 'loading'}
                  </p>
                </div>
              )}
            </Card>

            {(canOperateWarehouse || canReportShortPick) && (
              <Card className="space-y-3 p-4">
                <h3 className="font-semibold">
                  {canOperateWarehouse
                    ? strategy
                      ? `${strategy} 명령`
                      : '계획을 먼저 생성하세요'
                    : 'Short-pick'}
                </h3>
                {canOperateWarehouse && strategy === 'discrete' && (
                  <Button
                    disabled={!context || !allocation || busy}
                    onClick={() =>
                      context &&
                      allocation &&
                      command(
                        'discrete-scan',
                        {
                          ...context,
                          shipmentLineId: allocation.shipmentLineId,
                          skuId: allocation.skuId,
                          sourceLocationId: allocation.sourceLocationId,
                          quantity,
                          expectedLeaseVersion: workItem!.leaseVersion,
                        },
                        (data, idempotencyKey) =>
                          discreteScan.mutateAsync({ data, idempotencyKey })
                      )
                    }
                  >
                    Discrete scan
                  </Button>
                )}
                {canOperateWarehouse && strategy === 'aggregate_then_sort' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={
                        !plan || !session || !allocation || !cartId || busy
                      }
                      onClick={() =>
                        plan &&
                        session &&
                        allocation &&
                        command(
                          'aggregate-collect',
                          {
                            batchId,
                            planId: plan.id,
                            sessionId: session.id,
                            skuId: allocation.skuId,
                            sourceLocationId: allocation.sourceLocationId,
                            cartId,
                            quantity,
                          },
                          (data, idempotencyKey) =>
                            aggregateCollect.mutateAsync({
                              data,
                              idempotencyKey,
                            })
                        )
                      }
                    >
                      Source cart collect
                    </Button>
                    <Button
                      disabled={!context || !allocation || !cartId || busy}
                      onClick={() =>
                        context &&
                        allocation &&
                        command(
                          'aggregate-sort',
                          {
                            ...context,
                            shipmentLineId: allocation.shipmentLineId,
                            skuId: allocation.skuId,
                            cartId,
                            quantity,
                            expectedLeaseVersion: workItem!.leaseVersion,
                            destinationCustody: 'PACKING' as const,
                          },
                          (data, idempotencyKey) =>
                            aggregateSort.mutateAsync({ data, idempotencyKey })
                        )
                      }
                    >
                      Shipment sort
                    </Button>
                    <Button
                      disabled={
                        !plan || !session || !cartId || !targetWorkerId || busy
                      }
                      onClick={() =>
                        plan &&
                        session &&
                        command(
                          'cart-handoff',
                          {
                            batchId,
                            planId: plan.id,
                            sessionId: session.id,
                            expectedOwnerId:
                              workItem?.pickerClaim.workerId || '',
                            targetWorkerId,
                            cartId,
                            reason,
                          },
                          (data, idempotencyKey) =>
                            aggregateHandoff.mutateAsync({
                              data,
                              idempotencyKey,
                            })
                        )
                      }
                    >
                      Cart handoff
                    </Button>
                  </div>
                )}
                {canOperateWarehouse && strategy === 'pick_to_tote' && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!toteBarcode || busy}
                      onClick={() =>
                        command(
                          'tote-register',
                          { warehouseId: batch.warehouseId, toteBarcode },
                          (data, idempotencyKey) =>
                            registerTote.mutateAsync({ data, idempotencyKey })
                        )
                      }
                    >
                      Tote 등록
                    </Button>
                    <Button
                      disabled={!context || !toteBarcode || busy}
                      onClick={() =>
                        context &&
                        command(
                          'tote-assign',
                          {
                            ...context,
                            toteBarcode,
                            expectedLeaseVersion: workItem!.leaseVersion,
                          },
                          (data, idempotencyKey) =>
                            assignTote.mutateAsync({ data, idempotencyKey })
                        )
                      }
                    >
                      Tote 할당
                    </Button>
                    <Button
                      disabled={!context || !allocation || !toteBarcode || busy}
                      onClick={() =>
                        context &&
                        allocation &&
                        command(
                          'tote-scan',
                          {
                            ...context,
                            toteBarcode,
                            expectedLeaseVersion: workItem!.leaseVersion,
                            shipmentLineId: allocation.shipmentLineId,
                            skuId: allocation.skuId,
                            sourceLocationId: allocation.sourceLocationId,
                            quantity,
                          },
                          (data, idempotencyKey) =>
                            toteScan.mutateAsync({ data, idempotencyKey })
                        )
                      }
                    >
                      Tote scan
                    </Button>
                    <Button
                      disabled={
                        !context || !otherWorkItem || !toteBarcode || busy
                      }
                      onClick={() =>
                        context &&
                        otherWorkItem &&
                        command(
                          'tote-handoff',
                          {
                            ...context,
                            toteBarcode,
                            expectedLeaseVersion: workItem!.leaseVersion,
                            targetWorkItemId: otherWorkItem.id,
                            targetShipmentId: otherWorkItem.shipmentId,
                            targetExpectedLeaseVersion:
                              otherWorkItem.leaseVersion,
                            reason,
                          },
                          (data, idempotencyKey) =>
                            toteHandoff.mutateAsync({ data, idempotencyKey })
                        )
                      }
                    >
                      Tote handoff
                    </Button>
                    <Button
                      disabled={!context || !assignment || busy}
                      onClick={() =>
                        context &&
                        assignment &&
                        command(
                          'tote-release',
                          {
                            ...context,
                            toteBarcode: assignment.toteBarcode,
                            expectedLeaseVersion: workItem!.leaseVersion,
                            reason,
                          },
                          (data, idempotencyKey) =>
                            releaseTote.mutateAsync({ data, idempotencyKey })
                        )
                      }
                    >
                      Tote release
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {canOperateWarehouse && (
                    <>
                      <Button
                        variant="outline"
                        disabled={!context || !targetWorkerId || busy}
                        onClick={() =>
                          context &&
                          command(
                            'picking-handoff',
                            {
                              ...context,
                              targetWorkerId,
                              expectedLeaseVersion: workItem!.leaseVersion,
                              reason,
                            },
                            (data, idempotencyKey) =>
                              pickingHandoff.mutateAsync({
                                data,
                                idempotencyKey,
                              })
                          )
                        }
                      >
                        Strategy handoff
                      </Button>
                      <Button
                        disabled={!context || busy}
                        onClick={() =>
                          context &&
                          command(
                            'complete',
                            {
                              ...context,
                              expectedLeaseVersion: workItem!.leaseVersion,
                            },
                            (data, idempotencyKey) =>
                              complete.mutateAsync({ data, idempotencyKey })
                          )
                        }
                      >
                        Inspection-ready 완료
                      </Button>
                    </>
                  )}
                  {canReportShortPick && (
                    <Button
                      variant="destructive"
                      disabled={!context || !allocation || !shipment}
                      onClick={() => setShortPickOpen(true)}
                    >
                      Short-pick
                    </Button>
                  )}
                </div>
                {canOperateWarehouse && retry.pendingActions().length > 0 && (
                  <p className="text-xs text-destructive">
                    미확정 명령은 원래 payload와 idempotency key로 재시도됩니다:{' '}
                    {retry.pendingActions().join(', ')}
                  </p>
                )}
              </Card>
            )}
          </div>

          <Card className="space-y-2 p-4">
            <h3 className="font-semibold">서버 custody / balance</h3>
            {!session ? (
              <p className="text-sm text-muted-foreground">
                inventory session이 아직 없습니다.
              </p>
            ) : (
              <>
                <p className="text-sm">
                  {session.status} · v{session.version} · handed-in{' '}
                  {session.handedInQty} / settled {session.settledQty} /
                  returned {session.returnedQty} / shortage{' '}
                  {session.shortageQty}
                </p>
                {session.balances.map((balance) => (
                  <div
                    key={balance.id}
                    className="rounded border p-2 font-mono text-xs"
                  >
                    {balance.custodyType}:{balance.custodyRef || '—'} ← source{' '}
                    {balance.sourceLocationId || '—'} · {balance.skuId} ×{' '}
                    {balance.quantity}
                  </div>
                ))}
              </>
            )}
            {batch.toteAssignments.map((tote) => (
              <p key={tote.id} className="font-mono text-xs">
                TOTE {tote.toteBarcode} ({tote.toteStatus}) → {tote.shipmentId}
                {tote.releasedAt ? ' · released' : ''}
              </p>
            ))}
          </Card>
        </>
      )}
      {shortPickOpen &&
        canReportShortPick &&
        batch &&
        shipment &&
        allocation &&
        workItem && (
          <ShortPickDialog
            batch={batch}
            shipment={shipment}
            workItemId={workItem.id}
            shipmentLineId={allocation.shipmentLineId}
            sourceLocationId={allocation.sourceLocationId}
            onClose={() => {
              setShortPickOpen(false);
              refetch();
            }}
          />
        )}
    </div>
  );
}
