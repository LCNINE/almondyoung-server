'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';
import { foItemStatusLabel } from '../../line-composition/line-composition-view';
import {
  blockedReasonLabel,
  reservationStatusLabel,
} from './fulfillment-labels';

export function InventoryTab({ fo }: { fo: FulfillmentOrderDetail }) {
  const itemById = new Map(fo.items.map((item) => [item.id, item]));
  const itemBySku = new Map(fo.items.map((item) => [item.skuId, item]));
  const productOf = (
    reservation: FulfillmentOrderDetail['reservations'][number]
  ) =>
    (reservation.fulfillmentOrderItemId
      ? itemById.get(reservation.fulfillmentOrderItemId)
      : undefined) ?? itemBySku.get(reservation.skuId);

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* blockedReasons */}
      {fo.blockedReasons.length > 0 && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>더 진행할 수 없는 이유</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {fo.blockedReasons.map((r, i) => (
                <li key={i}>{blockedReasonLabel(r)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* FOI별 예약 현황 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">상품별 재고 확보</h3>

        <div className="overflow-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상품</TableHead>
                <TableHead className="text-right">필요</TableHead>
                <TableHead className="text-right">확보</TableHead>
                <TableHead className="text-right">부족</TableHead>
                <TableHead className="text-right">출고</TableHead>
                <TableHead>상태</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fo.items.map((item) => {
                // 이미 출고했거나 취소한 수량은 더 확보할 필요가 없다
                const shortage = Math.max(
                  0,
                  item.qty -
                    item.reservedQty -
                    item.shippedQty -
                    (item.canceledQty ?? 0)
                );
                const hasShipped = item.shippedQty > 0;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">{item.skuName}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {item.skuCode}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.qty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.reservedQty}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {shortage > 0 ? (
                        <Badge variant="destructive" className="tabular-nums">
                          {shortage}
                        </Badge>
                      ) : (
                        <span>0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {hasShipped ? (
                        <Badge variant="secondary" className="tabular-nums">
                          {item.shippedQty}
                        </Badge>
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {foItemStatusLabel(item)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* 예약 현황 (from FO detail reservations) */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">
          재고 확보 기록
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            이 주문을 위해 창고 재고를 잡아 둔 기록이에요
          </span>
        </h3>
        {fo.reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            잡아 둔 재고가 없어요.
          </p>
        ) : (
          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>상품</TableHead>
                  <TableHead>창고</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fo.reservations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal">
                      {productOf(r)?.skuName ?? '상품'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.warehouseId === fo.warehouseId || !fo.warehouseId
                        ? (fo.warehouseName ?? '출고 창고')
                        : '다른 창고'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.quantity}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {reservationStatusLabel(r.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
