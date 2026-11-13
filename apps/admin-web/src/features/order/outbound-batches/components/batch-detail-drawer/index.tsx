'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { usePermissionCheck } from '@/hooks/use-permission';
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
  getServerDenyMessage,
  parseServerError,
  useAddShipmentToBatch,
  useClaimBatchPacker,
  useClaimBatchPicker,
  useExcludeShipmentFromBatch,
  useHandoffBatchWorkItem,
  useOutboundBatchEligibleShipments,
  useOutboundBatchV2,
  usePickingHandoff,
} from '@/lib/services/orders';
import type {
  OutboundBatchV2,
  PickingStrategyName,
} from '@/lib/types/dto/fulfillment';
import { ExcludeShipmentDialog } from '../exclude-shipment-dialog';
import { BatchStatusBadge } from '../batch-status-badge';
import { useWarehouseCommandRetry } from '../../warehouse-command-retry';
import { PICKING_METHOD_LABELS } from '@/lib/utils/picking-method';
import { useOperatorNames } from '@/features/order/fulfillments/detail/operation-operator';
import {
  HandoffDialog,
  type HandoffClaim,
  type HandoffTarget,
} from './handoff-dialog';

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
  const { canRun } = usePermissionCheck();
  const { data: batch, isLoading, refetch } = useOutboundBatchV2(batchId);
  const { data: eligible = [] } = useOutboundBatchEligibleShipments(batchId);
  const addShipment = useAddShipmentToBatch();
  const excludeShipment = useExcludeShipmentFromBatch();
  const claimPicker = useClaimBatchPicker();
  const claimPacker = useClaimBatchPacker();
  const handoff = useHandoffBatchWorkItem();
  const pickingHandoff = usePickingHandoff();
  const [excluding, setExcluding] = useState<{
    id: string;
    shipmentId: string;
    trackingNo?: string | null;
  } | null>(null);
  const [handingOff, setHandingOff] = useState<{
    claim: HandoffClaim;
    itemId: string;
  } | null>(null);
  const [handoffSubmitting, setHandoffSubmitting] = useState(false);
  const retry = useWarehouseCommandRetry();
  const workerName = useOperatorNames(
    (batch?.workItems ?? []).flatMap((item) => [
      item.pickerClaim.workerId,
      item.packerClaim.workerId,
    ])
  );
  const canAdd = canRun(useAddShipmentToBatch);
  const canClaimPicker = canRun(useClaimBatchPicker);
  const canClaimPacker = canRun(useClaimBatchPacker);
  const canHandoff = canRun(useHandoffBatchWorkItem);
  const canHandoffPicker = canRun(usePickingHandoff);
  // 창을 연 뒤 상자가 바뀔 수 있어 언제나 서버가 마지막으로 준 상태로 넘긴다
  const handoffItem = handingOff
    ? batch?.workItems.find((item) => item.id === handingOff.itemId)
    : undefined;
  const handoffOwner =
    handingOff && handoffItem
      ? handoffOwnerOf(handingOff.claim, handoffItem, !!batch?.inventorySession)
      : null;
  useEffect(() => {
    if (handingOff && batch && !handoffOwner) setHandingOff(null);
  }, [handingOff, batch, handoffOwner]);
  const canExclude = canRun(useExcludeShipmentFromBatch);
  const canWorkItemAction =
    canClaimPicker ||
    canClaimPacker ||
    canHandoff ||
    canHandoffPicker ||
    canExclude;

  const command = async <T,>(
    action: string,
    payload: T,
    run: (payload: T, key: string) => Promise<unknown>,
    successMessage = '명령을 접수했습니다. 서버 상태를 다시 확인합니다.'
  ): Promise<boolean> => {
    try {
      await retry.execute(action, payload, run);
      toast.success(successMessage);
      await refetch();
      return true;
    } catch (error) {
      const { code, status } = parseServerError(error);
      toast.error(
        status === 404
          ? '이미 끝났거나 배치에서 빠진 상자예요. 목록을 다시 불러왔어요.'
          : ((code && COMMAND_ERROR_MESSAGE[code]) ??
              getServerDenyMessage(error))
      );
      await refetch();
      return false;
    }
  };

  const handOff = async (target: HandoffTarget, reason: string) => {
    if (!handingOff || !handoffItem) return;
    const { claim } = handingOff;
    const item = handoffItem;
    const sessionId = batch?.inventorySession?.id;
    const word = claim === 'picker' ? '피킹' : '포장';
    // 상자 버전·받는 사람·사유가 다르면 다른 명령이다 — 거절된 앞 명령의 내용을 다시 보내지 않게 키에 넣는다
    const action = `handoff:${claim}:${item.id}:${item.leaseVersion}:${target.id}:${reason}`;
    const message = `${target.label}에게 ${word}을 넘겼어요.`;
    setHandoffSubmitting(true);
    const done =
      claim === 'picker' && sessionId
        ? await command(
            action,
            {
              batchId,
              sessionId,
              workItemId: item.id,
              shipmentId: item.shipmentId,
              targetWorkerId: target.id,
              expectedLeaseVersion: item.leaseVersion,
              reason,
            },
            (data, idempotencyKey) =>
              pickingHandoff.mutateAsync({ data, idempotencyKey }),
            message
          )
        : await command(
            action,
            {
              batchId,
              workItemId: item.id,
              data: {
                expectedLeaseVersion: item.leaseVersion,
                claimType: 'packer' as const,
                targetWorkerId: target.id,
                reason,
              },
            },
            (payload, idempotencyKey) =>
              handoff.mutateAsync({ ...payload, idempotencyKey }),
            message
          );
    setHandoffSubmitting(false);
    if (done) setHandingOff(null);
  };

  if (!open) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {excluding && (
        <ExcludeShipmentDialog
          trackingNo={excluding.trackingNo}
          defaultVoidWaybill={false}
          onClose={() => setExcluding(null)}
          onConfirm={(voidWaybill) =>
            void command(
              `exclude:${excluding.id}`,
              {
                batchId,
                shipmentId: excluding.shipmentId,
                reason: '잘못 넣은 상자',
                voidWaybill,
              },
              (payload, idempotencyKey) =>
                excludeShipment.mutateAsync({ ...payload, idempotencyKey })
            )
          }
        />
      )}
      {handingOff && handoffItem && handoffOwner && (
        <HandoffDialog
          claim={handingOff.claim}
          itemLabel={orderLabel(handoffItem)}
          ownerId={handoffOwner}
          ownerName={workerName(handoffOwner) || '이름을 모르는 작업자'}
          submitting={handoffSubmitting}
          onClose={() => setHandingOff(null)}
          onConfirm={(target, reason) => void handOff(target, reason)}
        />
      )}
      <SheetContent className="w-full overflow-auto sm:max-w-[900px]">
        <SheetHeader>
          <SheetTitle>V2 배치 상세</SheetTitle>
        </SheetHeader>
        {isLoading || !batch ? (
          <p className="px-4 text-sm text-muted-foreground">
            서버 스냅샷을 불러오는 중…
          </p>
        ) : (
          <div className="flex flex-col gap-6 px-4 pb-6">
            <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-muted-foreground">배치</p>
                <p className="font-medium">{batch.name || batch.batchNumber}</p>
                <p className="font-mono text-xs text-muted-foreground">{batch.batchNumber}</p>
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
              <h3 className="font-medium">피킹</h3>
              <p className="text-sm text-muted-foreground">
                이 배치는 <b>{PICKING_METHOD_LABELS[batch.pickingMethod]}</b>{' '}
                방식입니다.
                {batch.cartCapacity !== null &&
                  ` 바구니 ${batch.cartCapacity}개.`}{' '}
                전략은 방식에서 자동으로 결정됩니다.
              </p>
              {batch.picking && (
                <p>
                  <b>{STRATEGY_LABELS[batch.picking.strategy]}</b> · 시작{' '}
                  {new Date(batch.picking.startedAt).toLocaleString('ko-KR')}
                </p>
              )}
            </section>

            <Separator />
            <section className="space-y-3">
              <h3 className="font-medium">추가할 수 있는 상자</h3>
              {eligible.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  추가할 수 있는 상자가 없습니다. 출고주문에서 계획 확정과 운송장 발급을 마친 상자만 나와요.
                </p>
              ) : (
                <div className="max-h-48 overflow-auto rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>주문 · 상품</TableHead>
                        <TableHead>운송장</TableHead>
                        <TableHead className="text-right">수량</TableHead>
                        {canAdd && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eligible.map((item) => (
                        <TableRow key={item.shipmentId}>
                          <TableCell>
                            <Link
                              className="font-medium hover:underline"
                              href={`/order/fulfillments?shipmentId=${item.shipmentId}`}
                              title={`상자 ${item.shipmentId} · manifest v${item.manifestVersion} / reservation v${item.reservationVersion}`}
                            >
                              {item.displayOrderNo ? `#${item.displayOrderNo}` : '주문번호 없음'}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {item.itemSummary}
                            </p>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.trackingNo}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.totalQty}
                          </TableCell>
                          {canAdd && (
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
              <div className="flex items-center gap-1">
                <h3 className="font-medium">상자별 작업 목록</h3>
                <HelpTip label="상자별 작업 목록 안내">
                  <p>배치에 넣은 상자별 작업 목록이에요.</p>
                  <p>작업자가 앱에서 송장을 찍으면 그 상자를 맡아요(claim).</p>
                  <p>결과는 서버가 갱신한 뒤에 보여요.</p>
                </HelpTip>
              </div>
              <div className="overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>주문 · 상품</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead>피킹 담당</TableHead>
                      <TableHead>포장 담당</TableHead>
                      {canWorkItemAction && (
                        <TableHead>
                          <span className="flex items-center gap-1">
                            작업
                            <HelpTip label="작업 버튼 안내">
                              <p>보통은 창고 앱에서 송장을 찍으면 담당이 자동으로 정해져요.</p>
                              <p>맡기 버튼은 앱을 못 쓸 때만 눌러요.</p>
                              <p>넘기기는 근무 교대처럼 맡은 사람이 끝까지 못 할 때 다른 작업자에게 넘기는 거예요.</p>
                              <p>배치에서 빼기는 상자를 잘못 넣었을 때 써요.</p>
                            </HelpTip>
                          </span>
                        </TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.workItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <p
                            className="font-medium"
                            title={`상자 ${item.shipmentId} · 작업 ${item.id} · lease v${item.leaseVersion}`}
                          >
                            {item.displayOrderNo ? `#${item.displayOrderNo}` : '주문번호 없음'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.itemSummary}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.recoveryReason ? 'destructive' : 'outline'
                            }
                          >
                            {item.recoveryReason
                              ? '복구 필요'
                              : (WORK_ITEM_STATUS_LABEL[item.status] ?? item.status)}
                          </Badge>
                          {item.exclusionReason && (
                            <p className="text-xs text-destructive">
                              제외: {item.exclusionReason}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs" title={item.pickerClaim.workerId ?? undefined}>
                          {claimText(item.pickerClaim, workerName)}
                        </TableCell>
                        <TableCell className="text-xs" title={item.packerClaim.workerId ?? undefined}>
                          {claimText(item.packerClaim, workerName)}
                        </TableCell>
                        {canWorkItemAction && (
                          <TableCell>
                            <div className="flex min-w-52 flex-wrap gap-1">
                              {!hasWorkItemAction(item.status) && (
                                <span className="text-xs text-muted-foreground">
                                  {item.status === 'completed'
                                    ? '끝난 상자라 할 작업이 없어요'
                                    : '지금은 할 수 있는 작업이 없어요'}
                                </span>
                              )}
                              {canClaimPicker && PICKER_CLAIMABLE.includes(item.status) && (
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
                                내가 피킹 맡기
                              </Button>
                              )}
                              {canClaimPacker && PACKER_CLAIMABLE.includes(item.status) && (
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
                                내가 포장 맡기
                              </Button>
                              )}
                              {canHandoffPicker &&
                                handoffOwnerOf(
                                  'picker',
                                  item,
                                  !!batch.inventorySession
                                ) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setHandingOff({
                                        claim: 'picker',
                                        itemId: item.id,
                                      })
                                    }
                                  >
                                    피킹 넘기기
                                  </Button>
                                )}
                              {canHandoff &&
                                handoffOwnerOf(
                                  'packer',
                                  item,
                                  !!batch.inventorySession
                                ) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setHandingOff({
                                        claim: 'packer',
                                        itemId: item.id,
                                      })
                                    }
                                  >
                                    포장 넘기기
                                  </Button>
                                )}
                              {canExclude &&
                                EXCLUDABLE.includes(item.status) && (
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => setExcluding(item)}
                                  >
                                    배치에서 빼기
                                  </Button>
                                )}
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

/** 누르면 열리고(폰) 마우스를 올려도 열린다(PC) */
function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className="text-muted-foreground hover:text-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        // 올려서 이미 열린 걸 클릭이 다시 닫지 않게 — 닫기는 바깥을 누르면 된다
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <CircleHelp className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 space-y-1 text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}

const WORK_ITEM_STATUS_LABEL: Record<string, string> = {
  queued: '대기',
  picking: '피킹 중',
  ready_to_pack: '포장 대기',
  packing: '검수 중',
  completed: '완료',
  short_pick_recovery: '결품 처리 중',
  excluded: '빠짐',
  withdrawing: '빠지는 중',
};

// 서버 판정(core outbound-batch-orchestrator 의 assertClaimable·handoff, WITHDRAWABLE_WORK_ITEM_STATUSES)과 같은 범위
const PICKER_CLAIMABLE = ['queued', 'picking'];
const PACKER_CLAIMABLE = ['ready_to_pack', 'packing'];
const EXCLUDABLE = ['queued', 'picking', 'ready_to_pack', 'packing'];

function hasWorkItemAction(status: string): boolean {
  return [...PICKER_CLAIMABLE, ...PACKER_CLAIMABLE].includes(status);
}

type WorkItem = OutboundBatchV2['workItems'][number];

function orderLabel(item: WorkItem): string {
  return item.displayOrderNo ? `#${item.displayOrderNo}` : '주문번호 없음';
}

/**
 * 넘길 수 있으면 지금 맡은 사람. 피킹은 들고 있는 재고도 함께 옮기므로 재고 작업이 시작된 배치에서만 넘긴다
 * (서버: 피킹은 picking 상태, 포장은 packing 상태에서 맡은 사람이 있을 때만).
 */
function handoffOwnerOf(
  claim: HandoffClaim,
  item: WorkItem,
  hasInventorySession: boolean
): string | null {
  if (claim === 'picker') {
    return item.status === 'picking' && hasInventorySession
      ? item.pickerClaim.workerId
      : null;
  }
  return item.status === 'packing' ? item.packerClaim.workerId : null;
}

/** 맡은 사람이 있으면 이름을 쓴다 — 이름을 모르면(직원 목록을 볼 권한이 없으면) 상태만 */
function claimText(
  claim: WorkItem['pickerClaim'],
  workerName: (id: string | null | undefined) => string
): string {
  const state = CLAIM_STATE_LABEL[claim.state] ?? claim.state;
  const name = workerName(claim.workerId);
  if (claim.state === 'unclaimed' || !name) return state;
  return claim.state === 'active' ? name : `${name} (${state})`;
}

const COMMAND_ERROR_MESSAGE: Record<string, string> = {
  WORK_ITEM_NOT_CLAIMABLE: '지금 단계에서는 맡을 수 없는 상자예요. 목록을 다시 불러왔어요.',
  WORK_ITEM_HANDOFF_REQUIRED: '다른 작업자가 맡고 있어요. 그 작업자에게 넘겨받아 주세요.',
  WORK_ITEM_CLAIM_NOT_ACTIVE: '포장 중인 담당자가 없어서 넘길 수 없어요.',
  WORK_ITEM_STALE_LEASE_VERSION: '그사이 상자 상태가 바뀌었어요. 목록을 다시 불러왔어요.',
  WORKER_ACTIVE_CLAIM_EXISTS: '받을 작업자가 다른 상자를 맡고 있어요. 그 상자를 끝내거나 넘긴 뒤 다시 해 주세요.',
  PICKING_HANDOFF_NOT_ACTIVE: '피킹 중인 담당자가 없어서 넘길 수 없어요. 목록을 다시 불러왔어요.',
  PICKING_HANDOFF_STALE: '그사이 상자 상태가 바뀌었어요. 목록을 다시 불러왔어요.',
};

const CLAIM_STATE_LABEL: Record<string, string> = {
  unclaimed: '아직 없음',
  active: '맡음',
  expired: '시간 지남',
  released: '놓음',
};
