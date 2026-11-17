import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { InboundShipmentDetail } from '@/lib/types/dto/inbound-shipment';

/** 리스트에 없던 물건 — 상자 순. */
export function UnplannedTab({
  shipment,
}: {
  shipment: InboundShipmentDetail;
}) {
  const order = new Map(shipment.boxes.map((b) => [b.id, b.sortKey]));
  const items = [...shipment.unplannedItems].sort(
    (a, b) =>
      (order.get(a.boxId) ?? 0) - (order.get(b.boxId) ?? 0) ||
      a.skuCode.localeCompare(b.skuCode)
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>상자</TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>이름</TableHead>
          <TableHead className="text-right">센 수량</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={4}
              className="text-center text-muted-foreground"
            >
              리스트에 없던 물건이 없습니다.
            </TableCell>
          </TableRow>
        ) : (
          items.map((i) => (
            <TableRow key={`${i.boxId}:${i.skuId}`}>
              <TableCell>{i.boxLabel}</TableCell>
              <TableCell>{i.skuCode}</TableCell>
              <TableCell>{i.skuName}</TableCell>
              <TableCell className="text-right">{i.countedQty}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
