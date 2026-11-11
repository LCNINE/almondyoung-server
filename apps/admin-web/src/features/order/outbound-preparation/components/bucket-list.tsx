'use client';

import Link from 'next/link';
import { Can } from '@/components/auth/can';
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
  PREPARATION_BATCH_LIMIT,
  plannedOrderText,
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
  const selectable = bucket.shipments.slice(0, PREPARATION_BATCH_LIMIT);
  const selectAllLabel =
    bucket.shipments.length > PREPARATION_BATCH_LIMIT
      ? `앞 ${PREPARATION_BATCH_LIMIT}건 선택`
      : '전체 선택';
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
                  disabled={busy || bucket.shipments.length === 0}
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
            {bucket.shipments.map((shipment) => (
              <TableRow key={shipment.shipmentId}>
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
                </TableCell>
                <TableCell>{shipment.itemSummary}</TableCell>
                <TableCell className="tabular-nums">
                  {shipment.totalQty}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {shipment.reason ?? '-'}
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
                  {bucket.bucket === 'needs_info' && (
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
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
