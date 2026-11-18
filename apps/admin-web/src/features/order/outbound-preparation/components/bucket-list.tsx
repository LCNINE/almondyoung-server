'use client';

import Link from 'next/link';
import { Fragment } from 'react';
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
} from '@/lib/services/orders';
import type { PreparationBucketDto } from '@/lib/types/dto/fulfillment';
import {
  bulkSelectableShipments,
  lineSplitText,
  PREPARATION_BATCH_LIMIT,
  plannedOrderText,
  shortPickText,
} from '../preparation-model';
import { BUCKET_LABELS } from './bucket-table';

export function BucketList({
  bucket,
  selectedIds,
  busy,
  onToggle,
  onToggleAll,
  onMerge,
  canPrepare,
  onPrepareSeparately,
}: {
  bucket: PreparationBucketDto;
  selectedIds: string[];
  busy: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onMerge: (id: string) => void;
  canPrepare: boolean;
  onPrepareSeparately: () => void;
}) {
  const selected = new Set(selectedIds);
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
        {BUCKET_LABELS[bucket.bucket]} 내역 · {selectedIds.length}건 선택
      </h2>
      {bucket.bucket === 'mergeable' && (
        <Can run={useRunOutboundPreparation}>
          <Button
            size="sm"
            disabled={busy || !canPrepare || selectedIds.length === 0}
            onClick={onPrepareSeparately}
          >
            따로 보내기
          </Button>
        </Can>
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
              <TableHead className="w-10">
                <Checkbox
                  aria-label={selectAllLabel}
                  checked={allChecked}
                  disabled={busy || selectable.length === 0}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                />
              </TableHead>
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
                {index === 0 && shipment.shortPick && (
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell colSpan={6} className="text-sm font-semibold">
                      결품으로 돌아온 상자{' '}
                      {bucket.shortPickCount ?? shortPicks.length}건 — 자리
                      수량을 확인한 뒤 하나씩 골라 주세요
                    </TableCell>
                  </TableRow>
                )}
                {index > 0 &&
                  !shipment.shortPick &&
                  bucket.shipments[index - 1].shortPick && (
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={6} className="text-sm font-semibold">
                        그 밖의 상자
                      </TableCell>
                    </TableRow>
                  )}
                <TableRow>
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
                    ) : (
                      shipment.itemSummary
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {shipment.totalQty}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {shipment.shortPick?.length ? (
                      <>
                        <span className="block font-medium text-foreground">
                          {shortPickText(shipment.shortPick)}
                        </span>
                        {shipment.reason && (
                          <span className="block">{shipment.reason}</span>
                        )}
                      </>
                    ) : (
                      (shipment.reason ?? '-')
                    )}
                  </TableCell>
                  <TableCell>
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
                    {(bucket.bucket === 'needs_info' ||
                      (bucket.bucket === 'resume' && shipment.reason)) && (
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          href={`/order/fulfillments?shipmentId=${encodeURIComponent(shipment.shipmentId)}`}
                        >
                          상자 상세
                        </Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
