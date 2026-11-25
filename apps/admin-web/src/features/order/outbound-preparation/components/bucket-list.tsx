'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { Can } from '@/components/auth/can';
import { replenishmentSkuHref } from '@/features/inventory/replenishment/suggestion-model';
import { useCanOpen } from '@/hooks/use-permission';
import { splitShareText } from '@/features/order/fulfillments/detail/consolidation-sheet-model';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StockPriorityBadge } from '@/features/order/stock-priority/stock-priority-badge';
import { stockGivenText } from '@/features/order/stock-priority/stock-priority-copy';
import {
  StockPriorityCancelDialog,
  StockPriorityDialog,
} from '@/features/order/stock-priority/stock-priority-dialog';
import {
  useCancelStockPriority,
  useCreateShipmentConsolidation,
  useRunOutboundPreparation,
  useSetStockPriority,
  useSplitShipment,
} from '@/lib/services/orders';
import type { PreparationBucketDto } from '@/lib/types/dto/fulfillment';
import {
  batchReturnNextStep,
  batchReturnText,
  bulkSelectableShipments,
  isShortLine,
  lineSplitText,
  orderAgeOf,
  PREPARATION_BATCH_LIMIT,
  plannedOrderText,
  SELECTABLE_BUCKETS,
  type ShipmentGroup,
  shipmentGroupOf,
  shortPickText,
  showsShipmentDetailLink,
  splitOptionName,
  splitQuantities,
} from '../preparation-model';
import { kstToday } from '@/features/order/matching/lib/date-key';
import { incomingCopy, shortageLineText } from '../blocked-copy';
import { BUCKET_LABELS } from './bucket-table';
import { NeedsInfoList } from './needs-info-list';
import { ProfileSplitDialog } from './profile-split-dialog';

export function BucketList({
  bucket,
  warehouseId,
  selectedIds,
  busy,
  onToggle,
  onToggleAll,
  onMerge,
  canPrepare,
  onPrepareSeparately,
}: {
  bucket: PreparationBucketDto;
  warehouseId: string;
  selectedIds: string[];
  busy: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onMerge: (id: string) => void;
  canPrepare: boolean;
  onPrepareSeparately: () => void;
}) {
  const [splitting, setSplitting] = useState<{
    shipmentId: string;
    orderText: string;
  } | null>(null);
  const [prioritizing, setPrioritizing] = useState<{
    shipmentId: string;
    orderText: string;
    cancel: boolean;
  } | null>(null);
  const selected = new Set(selectedIds);
  const choosable = SELECTABLE_BUCKETS.has(bucket.bucket);
  const showsRecipient = bucket.bucket === 'ready';
  const columns = 6 + (choosable ? 1 : 0) + (showsRecipient ? 1 : 0);
  const now = useNow();
  const today = kstToday(now);
  const shortPicks = bucket.shipments.filter((shipment) => shipment.shortPick);
  // 하나씩 고른 결품 상자만큼 전체 선택이 담을 수 있는 상자가 줄어든다
  const keptCount = shortPicks.filter((shipment) =>
    selected.has(shipment.shipmentId)
  ).length;
  const selectable = bulkSelectableShipments(bucket.shipments).slice(
    0,
    PREPARATION_BATCH_LIMIT - keptCount
  );
  const others = bucket.shipments.length - shortPicks.length;
  const returnedCount =
    bucket.batchReturnCount ??
    bucket.shipments.filter(
      (shipment) => shipmentGroupOf(shipment) === 'batch_return'
    ).length;
  // 앞 쪽에서 돌아온 상자가 끝나도, 묶음이 있는 분류면 첫 줄에 묶음 이름을 단다
  const hasReturns =
    (bucket.shortPickCount ?? shortPicks.length) + returnedCount > 0;
  const groupTitle: Record<ShipmentGroup, string> = {
    short_pick: `결품으로 돌아온 상자 ${
      bucket.shortPickCount ?? shortPicks.length
    }건 — 자리 수량을 확인한 뒤 하나씩 골라 주세요`,
    batch_return: `배치에서 빠져 돌아온 상자 ${returnedCount}건 — 뺀 이유를 보고 다시 준비해 주세요`,
    other: '그 밖의 상자',
  };
  const selectAllLabel = `${shortPicks.length > 0 ? '결품 상자 빼고 ' : ''}${
    others > PREPARATION_BATCH_LIMIT - keptCount
      ? `앞 ${PREPARATION_BATCH_LIMIT - keptCount}건 선택`
      : '전체 선택'
  }`;
  const allChecked =
    selectable.length > 0 &&
    selectable.every((shipment) => selected.has(shipment.shipmentId))
      ? true
      : selectedIds.length > 0
        ? 'indeterminate'
        : false;

  return (
    <section
      className="space-y-3"
      aria-label={`${BUCKET_LABELS[bucket.bucket]} 내역`}
    >
      <h2 className="text-sm font-semibold">
        {BUCKET_LABELS[bucket.bucket]} 내역
        {choosable && ` · ${selectedIds.length}건 선택`}
      </h2>
      {bucket.bucket === 'unavailable' && (
        <p className="text-sm text-muted-foreground">
          재고가 들어오면 먼저 주문한 순서로 자동으로 확보돼요.{' '}
          <Can
            run={useSetStockPriority}
            fallback="먼저 보내야 하는 주문은 우선할당할 수 있는 담당자에게 알려 주세요."
          >
            먼저 보내야 하는 주문은 «우선할당»을 누르면 다른 대기 주문이 잡은
            재고를 옮겨 와요.
          </Can>
        </p>
      )}
      {bucket.bucket === 'mergeable' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" asChild>
            <Link
              href={`/order/consolidation?warehouseId=${encodeURIComponent(warehouseId)}`}
            >
              합치러 가기
            </Link>
          </Button>
          <Can run={useRunOutboundPreparation}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canPrepare || selectedIds.length === 0}
              onClick={onPrepareSeparately}
            >
              고른 {selectedIds.length}건 따로 보내기
            </Button>
          </Can>
        </div>
      )}
      {bucket.count > PREPARATION_BATCH_LIMIT && (
        <p className="text-sm font-semibold text-foreground">
          한 번에 100건까지 처리해요
        </p>
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {choosable && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={selectAllLabel}
                    checked={allChecked}
                    disabled={busy || selectable.length === 0}
                    onCheckedChange={(checked) => onToggleAll(checked === true)}
                  />
                </TableHead>
              )}
              <TableHead>주문번호</TableHead>
              <TableHead>주문일</TableHead>
              {showsRecipient && <TableHead>받는 분</TableHead>}
              <TableHead>상품</TableHead>
              <TableHead>수량</TableHead>
              <TableHead>사유</TableHead>
              <TableHead>기능</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bucket.shipments.map((shipment, index) => (
              <Fragment key={shipment.shipmentId}>
                {(index === 0
                  ? hasReturns
                  : shipmentGroupOf(shipment) !==
                    shipmentGroupOf(bucket.shipments[index - 1])) && (
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell
                      colSpan={columns}
                      className="text-sm font-semibold"
                    >
                      {groupTitle[shipmentGroupOf(shipment)]}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  {choosable && (
                    <TableCell>
                      <Checkbox
                        aria-label={`${plannedOrderText(shipment)} 선택`}
                        checked={selected.has(shipment.shipmentId)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          onToggle(shipment.shipmentId, checked === true)
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="tabular-nums">
                    {plannedOrderText(shipment)}
                    {shipment.stockPriority && <StockPriorityBadge />}
                    {shipment.owner && (
                      <span className="mt-1 block w-fit rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground">
                        3PL · {shipment.owner.name}
                      </span>
                    )}
                    {shipment.split && (
                      <span className="block text-xs font-medium text-foreground">
                        {splitShareText(shipment.split)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    <OrderAgeCell orderedAt={shipment.orderedAt} now={now} />
                  </TableCell>
                  {showsRecipient && (
                    <TableCell className="whitespace-nowrap">
                      {shipment.recipient?.name ?? '-'}
                    </TableCell>
                  )}
                  <TableCell>
                    {bucket.bucket === 'partial' && shipment.lines?.length ? (
                      <PartialLines lines={shipment.lines} />
                    ) : bucket.bucket === 'unavailable' &&
                      shipment.lines?.some((line) => line.stock) ? (
                      <ul role="list" className="space-y-1 whitespace-normal">
                        {shipment.lines.map((line, index) => (
                          <li key={index}>
                            <LineName line={line} />
                            {isShortLine(line) && line.stock && (
                              <span className="block text-xs font-semibold tabular-nums text-red-600">
                                {shortageLineText({
                                  ...line,
                                  stock: line.stock,
                                })}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      shipment.itemSummary
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {bucket.bucket === 'partial' && shipment.lines?.length ? (
                      <>
                        <span className="block font-semibold">
                          {splitQuantities(shipment.lines).now}
                        </span>
                        <span className="block whitespace-nowrap text-xs text-muted-foreground">
                          전체 {shipment.totalQty}
                        </span>
                      </>
                    ) : (
                      shipment.totalQty
                    )}
                  </TableCell>
                  <TableCell className="min-w-72 whitespace-normal text-sm text-muted-foreground">
                    <ReasonCell
                      bucket={bucket.bucket}
                      shipment={shipment}
                      today={today}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {bucket.bucket === 'mergeable' && (
                        <Can run={useCreateShipmentConsolidation}>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onMerge(shipment.shipmentId)}
                          >
                            합치기
                          </Button>
                        </Can>
                      )}
                      {bucket.bucket === 'needs_info' &&
                        shipment.profileSplit && (
                          <Can run={useSplitShipment}>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                setSplitting({
                                  shipmentId: shipment.shipmentId,
                                  orderText: plannedOrderText(shipment),
                                })
                              }
                            >
                              배송 프로필별로 나누기
                            </Button>
                          </Can>
                        )}
                      {(bucket.bucket === 'unavailable' ||
                        bucket.bucket === 'partial') &&
                        !shipment.stockPriority && (
                          <Can run={useSetStockPriority}>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                setPrioritizing({
                                  shipmentId: shipment.shipmentId,
                                  orderText: plannedOrderText(shipment),
                                  cancel: false,
                                })
                              }
                            >
                              우선할당
                            </Button>
                          </Can>
                        )}
                      {shipment.stockPriority && (
                        <Can run={useCancelStockPriority}>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setPrioritizing({
                                shipmentId: shipment.shipmentId,
                                orderText: plannedOrderText(shipment),
                                cancel: true,
                              })
                            }
                          >
                            우선할당 취소
                          </Button>
                        </Can>
                      )}
                      {bucket.bucket === 'unavailable' && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href="/inventory/inbound">입고 화면</Link>
                        </Button>
                      )}
                      {showsShipmentDetailLink(bucket.bucket, shipment) && (
                        <Button size="sm" variant="outline" asChild>
                          <Link
                            href={`/order/fulfillments?shipmentId=${encodeURIComponent(shipment.shipmentId)}`}
                          >
                            상자 상세
                          </Link>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {splitting && (
        <ProfileSplitDialog
          key={splitting.shipmentId}
          shipmentId={splitting.shipmentId}
          orderText={splitting.orderText}
          split={
            bucket.shipments.find(
              (shipment) => shipment.shipmentId === splitting.shipmentId
            )?.profileSplit ?? null
          }
          onClose={() => setSplitting(null)}
        />
      )}
      {prioritizing &&
        (prioritizing.cancel ? (
          <StockPriorityCancelDialog
            shipmentId={prioritizing.shipmentId}
            orderText={prioritizing.orderText}
            onClose={() => setPrioritizing(null)}
          />
        ) : (
          <StockPriorityDialog
            shipmentId={prioritizing.shipmentId}
            orderText={prioritizing.orderText}
            onClose={() => setPrioritizing(null)}
          />
        ))}
    </section>
  );
}

// 모자란 줄은 빨갛게, 다 있는 줄은 흐리게 — 무엇이 모자라 막혔는지 상품 칸에서 바로 읽히게
function LineName({
  line,
}: {
  line: { name: string; qty: number; reservedQty: number };
}) {
  const { base, option } = splitOptionName(line.name);

  return (
    <span
      className={
        isShortLine(line)
          ? 'block min-w-0 break-keep font-semibold text-red-600'
          : 'block min-w-0 break-keep text-muted-foreground'
      }
    >
      {base}
      {option && (
        <>
          {' '}
          <span className="inline-block max-w-full truncate align-bottom">
            {option}
          </span>
        </>
      )}
    </span>
  );
}

// 부분출고 상자: 모자란 줄을 위로 모아 빨갛게, 다 있는 줄은 흐리게
function PartialLines({
  lines,
}: {
  lines: { name: string; qty: number; reservedQty: number }[];
}) {
  const short = lines.filter(isShortLine);
  const full = lines.filter((line) => !isShortLine(line));

  return (
    <div className="space-y-2 whitespace-normal">
      <div className="flex flex-wrap gap-1.5">
        {short.length > 0 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-950/40">
            {short.length}종 모자람 · {splitQuantities(short).wait}개
          </span>
        )}
        {full.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {full.length}종 다 있음
          </span>
        )}
      </div>
      <ul role="list" className="space-y-1">
        {short.map((line, index) => (
          <li
            key={`short-${index}`}
            className="flex items-baseline justify-between gap-3 rounded-md bg-red-50 px-2.5 py-1.5 ring-1 ring-inset ring-red-200 dark:bg-red-950/40 dark:ring-red-900"
          >
            <LineName line={line} />
            <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-red-600">
              {lineSplitText(line)}
            </span>
          </li>
        ))}
        {full.map((line, index) => (
          <li
            key={`full-${index}`}
            className="flex items-baseline justify-between gap-3 px-2.5 py-1"
          >
            <LineName line={line} />
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {line.qty}개 있음
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReasonCell({
  bucket,
  shipment,
  today,
}: {
  bucket: PreparationBucketDto['bucket'];
  shipment: PreparationBucketDto['shipments'][number];
  today: string;
}) {
  const nextStep = batchReturnNextStep(bucket, shipment);
  const replenishment = useCanOpen('/inventory/replenishment');
  const canOpenReplenishment =
    replenishment.status === 'ready' && replenishment.allowed;
  const blocked = blockedReason(bucket, shipment, canOpenReplenishment, today);
  const splitReason = (shipment.split?.reason || shipment.stockGiven) && (
    <>
      {shipment.stockGiven && (
        <span className="block break-keep text-xs text-foreground">
          {stockGivenText(shipment.stockGiven)}
        </span>
      )}
      {shipment.split?.reason && (
        <span className="block text-xs">
          나눈 이유 · {shipment.split.reason}
        </span>
      )}
    </>
  );

  if (!shipment.shortPick?.length && !shipment.batchReturn) {
    if (!splitReason) {
      return blocked ?? <>{shipment.reason ?? '-'}</>;
    }

    return (
      <>
        {blocked ??
          (shipment.reason && <span className="block">{shipment.reason}</span>)}
        {splitReason}
      </>
    );
  }

  return (
    <>
      {shipment.shortPick?.length ? (
        <span className="block font-medium text-foreground">
          {shortPickText(shipment.shortPick)}
        </span>
      ) : (
        shipment.batchReturn && (
          <span className="block font-medium text-foreground">
            {shipment.batchReturn.reason}
          </span>
        )
      )}
      {shipment.batchReturn && (
        <span className="block text-xs">
          {batchReturnText(shipment.batchReturn)}
        </span>
      )}
      {blocked ??
        (shipment.reason && <span className="block">{shipment.reason}</span>)}
      {nextStep && <span className="block text-foreground">{nextStep}</span>}
      {splitReason}
    </>
  );
}

// 출고불가·부분출고는 모자란 상품이 언제·어디서 오는지, 정보 부족은 고칠 것과 고치는 곳
function blockedReason(
  bucket: PreparationBucketDto['bucket'],
  shipment: PreparationBucketDto['shipments'][number],
  canOpenReplenishment: boolean,
  today: string
) {
  if (bucket === 'needs_info' && shipment.needsInfo?.length) {
    return <NeedsInfoList issues={shipment.needsInfo} />;
  }

  const lines = (shipment.lines ?? []).filter((line) => line.stock);

  if (
    (bucket !== 'unavailable' && bucket !== 'partial') ||
    lines.length === 0
  ) {
    return null;
  }

  // 사유가 같은 상품은 한 덩어리로 묶는다
  const groups = new Map<
    string,
    { state: string; action: string | null; lines: typeof lines }
  >();

  for (const line of lines) {
    if (!line.stock) continue;

    const { state, action } = incomingCopy(line.stock, today);
    const key = `${state}\n${action ?? ''}`;
    const group = groups.get(key) ?? { state, action, lines: [] };

    group.lines.push(line);
    groups.set(key, group);
  }

  const named = (shipment.lines?.length ?? 0) > 1;

  return (
    <ul role="list" className="space-y-2">
      {[...groups.values()].map((group, index) => (
        <li key={index} className="break-keep">
          {named && (
            <span className="block text-xs font-semibold text-red-600">
              {group.lines.map(shortLineName).join(' · ')}
            </span>
          )}
          <span className="block font-semibold text-foreground">
            {group.state}
          </span>
          {group.action && (
            <span className="block text-xs">{group.action}</span>
          )}
          {canOpenReplenishment &&
            group.lines.map(
              (line) =>
                line.stock?.skuId &&
                (line.stock.elsewhere?.onHand ?? 0) > 0 && (
                  <Link
                    key={line.stock.skuId}
                    href={replenishmentSkuHref(line.stock.skuId)}
                    className="block w-fit whitespace-nowrap text-xs text-primary underline underline-offset-2"
                  >
                    보충 제안에서 보기
                  </Link>
                )
            )}
        </li>
      ))}
    </ul>
  );
}

// 사유 칸에선 상품 칸에 이미 있는 상품명 대신 옵션만 짧게. 옵션이 없으면 이름 그대로
function shortLineName(line: { name: string }): string {
  const { option } = splitOptionName(line.name);

  return option ? option.slice(1, -1) : line.name;
}

// 경과 시간이 화면을 열어 둔 동안에도 흐르게 한다
function useNow() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);

    return () => clearInterval(id);
  }, []);

  return now;
}

function OrderAgeCell({
  orderedAt,
  now,
}: {
  orderedAt: string | null | undefined;
  now: Date;
}) {
  const age = orderAgeOf(orderedAt, now);

  if (!age) return <>-</>;

  return (
    <>
      <span className="block">{age.dateText}</span>
      <span
        className={
          age.long
            ? 'block text-xs font-semibold text-amber-700'
            : 'block text-xs text-muted-foreground'
        }
      >
        {age.waitText}
      </span>
    </>
  );
}
