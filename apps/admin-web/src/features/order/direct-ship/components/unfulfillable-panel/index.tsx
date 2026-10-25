'use client';

import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSupplierShipments } from '@/lib/services/orders';
import { unfulfillableRows } from '../../lib/unfulfillable-rows';

/** 「못 보냄」(N11) — 넘긴 상자에서 입점사가 못 보낸다고 알린 줄. 취소는 주문 화면에서 한다 */
export function UnfulfillablePanel({ supplierId }: { supplierId: string }) {
  const { data: shipments = [], isLoading } = useSupplierShipments(supplierId, 'forwarded');

  if (isLoading) return null;
  const rows = unfulfillableRows(shipments);
  if (rows.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">못 보냄으로 알린 줄이 없습니다.</div>;
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm text-muted-foreground">
        취소는 주문 화면에서 합니다. 이 줄을 취소해도 알릴 취소는 생기지 않습니다(입점사가 먼저 알려 왔습니다).
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>주문번호</TableHead>
            <TableHead>상품</TableHead>
            <TableHead>공급사 상품코드</TableHead>
            <TableHead className="text-right">수량</TableHead>
            <TableHead>사유</TableHead>
            <TableHead>알린 시각</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.shipmentLineId}>
              <TableCell>
                <Link
                  href={`/order/history?orderNo=${encodeURIComponent(r.orderNo)}`}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {r.orderNo}
                </Link>
              </TableCell>
              <TableCell>{r.skuName}</TableCell>
              <TableCell>{r.supplierSku ?? ''}</TableCell>
              <TableCell className="text-right">{r.qty}</TableCell>
              <TableCell>{r.reason}</TableCell>
              <TableCell>{r.reportedAt ? new Date(r.reportedAt).toLocaleString('ko-KR') : ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
