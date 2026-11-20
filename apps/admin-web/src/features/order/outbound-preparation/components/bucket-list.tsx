'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Can } from '@/components/auth/can';
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
import {
  useCreateShipmentConsolidation,
  useRunOutboundPreparation,
  useSplitShipment,
} from '@/lib/services/orders';
import type { PreparationBucketDto } from '@/lib/types/dto/fulfillment';
import {
  batchReturnNextStep,
  batchReturnText,
  bulkSelectableShipments,
  lineSplitText,
  PREPARATION_BATCH_LIMIT,
  plannedOrderText,
  SELECTABLE_BUCKETS,
  type ShipmentGroup,
  shipmentGroupOf,
  shortPickText,
  showsShipmentDetailLink,
} from '../preparation-model';
import { incomingText, shortageLineText } from '../blocked-copy';
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
  const selected = new Set(selectedIds);
  const choosable = SELECTABLE_BUCKETS.has(bucket.bucket);
  const columns = choosable ? 6 : 5;
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
          재고가 들어오면 자동으로 확보돼 완전출고·부분출고로 넘어가요. 따로
          누를 것은 없어요.
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
                  <TableCell>
                    {bucket.bucket === 'partial' && shipment.lines?.length ? (
                      <ul role="list" className="space-y-1 whitespace-normal">
                        {shipment.lines.map((line, index) => (
                          <li key={index}>
                            <span className="block">{line.name}</span>
                            <span className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              {lineSplitText(line)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : bucket.bucket === 'unavailable' &&
                      shipment.lines?.some((line) => line.stock) ? (
                      <ul role="list" className="space-y-1 whitespace-normal">
                        {shipment.lines.map((line, index) => (
                          <li key={index}>
                            <span className="block">{line.name}</span>
                            {line.stock && (
                              <span className="block text-xs tabular-nums text-muted-foreground">
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
                    {shipment.totalQty}
                  </TableCell>
                  <TableCell className="min-w-72 whitespace-normal text-sm text-muted-foreground">
                    <ReasonCell bucket={bucket.bucket} shipment={shipment} />
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
    </section>
  );
}

function ReasonCell({
  bucket,
  shipment,
}: {
  bucket: PreparationBucketDto['bucket'];
  shipment: PreparationBucketDto['shipments'][number];
}) {
  const nextStep = batchReturnNextStep(bucket, shipment);
  const blocked = blockedReason(bucket, shipment);

  if (!shipment.shortPick?.length && !shipment.batchReturn) {
    return blocked ?? <>{shipment.reason ?? '-'}</>;
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
    </>
  );
}

// 출고불가는 모자란 상품이 언제·어디서 오는지, 정보 부족은 고칠 것과 고치는 곳
function blockedReason(
  bucket: PreparationBucketDto['bucket'],
  shipment: PreparationBucketDto['shipments'][number]
) {
  if (bucket === 'needs_info' && shipment.needsInfo?.length) {
    return <NeedsInfoList issues={shipment.needsInfo} />;
  }

  const lines = (shipment.lines ?? []).filter((line) => line.stock);

  if (bucket !== 'unavailable' || lines.length === 0) {
    return null;
  }

  return (
    <ul role="list" className="space-y-1">
      {lines.map((line, index) => (
        <li key={index} className="break-keep">
          {lines.length > 1 && (
            <span className="font-medium text-foreground">{line.name}: </span>
          )}
          {line.stock && incomingText(line.stock)}
        </li>
      ))}
    </ul>
  );
}
