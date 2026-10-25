import type { SupplierQueueShipment } from '@/lib/types/dto/fulfillment';

export interface UnfulfillableRow {
  shipmentLineId: string;
  salesOrderId: string;
  orderNo: string;
  skuName: string;
  supplierSku: string | null;
  qty: number;
  reason: string;
  reportedAt: string | null;
}

function reportedTime(at: string | null): number {
  return at === null ? Number.POSITIVE_INFINITY : new Date(at).getTime();
}

/** 「못 보냄」 탭(N11) — 넘긴 상자에서 입점사가 사유를 적은 라인만, 알린 시각 오래된 순(시각 없는 줄은 맨 뒤) */
export function unfulfillableRows(shipments: SupplierQueueShipment[]): UnfulfillableRow[] {
  const rows: UnfulfillableRow[] = [];
  for (const s of shipments) {
    for (const l of s.lines) {
      if (l.unfulfillableReason === null) continue;
      rows.push({
        shipmentLineId: l.shipmentLineId,
        salesOrderId: s.salesOrderId,
        orderNo: s.orderNo,
        skuName: l.skuName,
        supplierSku: l.supplierSku,
        qty: l.qty,
        reason: l.unfulfillableReason,
        reportedAt: l.unfulfillableReportedAt,
      });
    }
  }
  return rows.sort((a, b) => reportedTime(a.reportedAt) - reportedTime(b.reportedAt));
}
