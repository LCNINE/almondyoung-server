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
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';

function truncateId(id: string) {
  return `${id.substring(0, 8)}…`;
}

export function ItemsTab({ fo }: { fo: FulfillmentOrderDetail }) {
  return (
    <div className="flex flex-col gap-6 py-4">
      {/* FOI 테이블 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">풀필먼트 오더 아이템 (FOI)</h3>
        {fo.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">아이템 없음</p>
        ) : (
          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>FOI ID</TableHead>
                  <TableHead>SKU ID</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead className="text-right">예약</TableHead>
                  <TableHead className="text-right">피킹</TableHead>
                  <TableHead className="text-right">출고</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>판매 라인</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fo.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {truncateId(item.id)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(item.skuId)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">
                      {item.reservedQty < item.qty ? (
                        <Badge variant="destructive" className="tabular-nums">
                          {item.reservedQty}
                        </Badge>
                      ) : (
                        item.reservedQty
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.pickedQty}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.shippedQty}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {item.salesOrderLineId ? truncateId(item.salesOrderLineId) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* 예약 테이블 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">재고 예약 (Reservations)</h3>
        {fo.reservations.length === 0 ? (
          <p className="text-sm text-muted-foreground">예약 없음</p>
        ) : (
          <div className="overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>예약 ID</TableHead>
                  <TableHead>FOI ID</TableHead>
                  <TableHead>SKU ID</TableHead>
                  <TableHead>창고 ID</TableHead>
                  <TableHead className="text-right">수량</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fo.reservations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {truncateId(r.id)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.fulfillmentOrderItemId ? truncateId(r.fulfillmentOrderItemId) : '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(r.skuId)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateId(r.warehouseId)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {r.status}
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
