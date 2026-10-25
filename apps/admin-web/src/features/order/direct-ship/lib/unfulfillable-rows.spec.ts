import type { SupplierQueueLine, SupplierQueueShipment } from '@/lib/types/dto/fulfillment';
import { unfulfillableRows } from './unfulfillable-rows';

const line = (
  id: string,
  reason: string | null,
  reportedAt: string | null,
  extra: Partial<SupplierQueueLine> = {}
): SupplierQueueLine => ({
  shipmentLineId: id,
  skuId: `sku-${id}`,
  skuName: `상품-${id}`,
  supplierSku: null,
  qty: 1,
  unfulfillableReason: reason,
  unfulfillableReportedAt: reportedAt,
  ...extra,
});

const shipment = (id: string, orderNo: string, lines: SupplierQueueLine[]): SupplierQueueShipment => ({
  shipmentId: id,
  stage: 'forwarded',
  salesOrderId: `so-${id}`,
  orderNo,
  openedAt: '2026-10-20T00:00:00Z',
  handoffId: 'h-1',
  handoffAt: '2026-10-21T00:00:00Z',
  lines,
});

describe('unfulfillableRows', () => {
  it('사유 없는 라인은 뺀다', () => {
    const rows = unfulfillableRows([
      shipment('sh-1', 'A-1', [line('l-1', null, null), line('l-2', '품절', '2026-10-22T00:00:00Z')]),
    ]);
    expect(rows.map((r) => r.shipmentLineId)).toEqual(['l-2']);
  });

  it('두 상자에 걸친 라인을 알린 시각 오래된 순으로 놓고 주문 정보를 붙인다', () => {
    const rows = unfulfillableRows([
      shipment('sh-1', 'A-1', [
        line('l-1', '단종', '2026-10-23T09:00:00Z', { supplierSku: '00777', qty: 2 }),
        line('l-2', '품절', '2026-10-22T09:00:00Z'),
      ]),
      shipment('sh-2', 'B-2', [line('l-3', '파손', '2026-10-22T12:00:00Z')]),
    ]);
    expect(rows.map((r) => r.shipmentLineId)).toEqual(['l-2', 'l-3', 'l-1']);
    expect(rows[2]).toEqual({
      shipmentLineId: 'l-1',
      salesOrderId: 'so-sh-1',
      orderNo: 'A-1',
      skuName: '상품-l-1',
      supplierSku: '00777',
      qty: 2,
      reason: '단종',
      reportedAt: '2026-10-23T09:00:00Z',
    });
    expect(rows[1].orderNo).toBe('B-2');
  });

  it('알린 시각이 없는 사유 줄은 맨 뒤로', () => {
    const rows = unfulfillableRows([
      shipment('sh-1', 'A-1', [line('l-1', '품절', null), line('l-2', '품절', '2026-10-22T00:00:00Z')]),
    ]);
    expect(rows.map((r) => r.shipmentLineId)).toEqual(['l-2', 'l-1']);
  });

  it('빈 입력은 빈 배열', () => {
    expect(unfulfillableRows([])).toEqual([]);
  });
});
