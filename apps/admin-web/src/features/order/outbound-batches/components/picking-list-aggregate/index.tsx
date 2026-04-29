'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useOutboundBatchPickingList } from '@/lib/services/orders';
import type { PickingListAggregateItem } from '@/lib/types/dto/fulfillment';

interface Props {
  batchId: string;
}

export function PickingListAggregate({ batchId }: Props) {
  const { data: items = [], isLoading } = useOutboundBatchPickingList(batchId);

  if (isLoading) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">피킹 목록 로딩 중...</p>;
  }

  if (items.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">피킹 항목이 없습니다.</p>;
  }

  return (
    <div className="overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU명</TableHead>
            <TableHead className="text-right">총 수량</TableHead>
            <TableHead className="text-right">피킹 완료</TableHead>
            <TableHead className="text-right">FO 수</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item: PickingListAggregateItem) => {
            const pickedQty = item.fulfillmentOrderItems.reduce(
              (sum, foi) => sum + foi.pickedQty,
              0
            );
            return (
              <TableRow key={item.skuId}>
                <TableCell className="font-medium">{item.skuName}</TableCell>
                <TableCell className="text-right">{item.totalQty}</TableCell>
                <TableCell className="text-right">{pickedQty}</TableCell>
                <TableCell className="text-right">
                  {item.fulfillmentOrderItems.length}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
