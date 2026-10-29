import type { ReturnItem, ReturnView } from './types';

export function item(over: Partial<ReturnItem> = {}): ReturnItem {
  return {
    id: 'i1',
    skuId: 's1',
    skuName: 'SKU',
    skuCode: 'C1',
    qtyPerUnit: 1,
    expectedQty: 1,
    arrivedQty: 0,
    acceptedQty: 0,
    rejectedQty: 0,
    heldQty: 0,
    barcodes: ['880'],
    ...over,
  };
}

export function view(
  items: ReturnItem[],
  over: Partial<ReturnView> = {}
): ReturnView {
  return {
    id: 'r1',
    status: 'expected',
    reason: 'change_of_mind',
    feeBearer: 'customer',
    note: null,
    order: { orderNo: 'O-1' },
    warehouseId: 'w-1',
    csResolution: null,
    lines: items.map((it, n) => ({
      id: `l${n}`,
      productName: 'P',
      quantity: 1,
      missingQty: 0,
      items: [it],
    })),
    ...over,
  };
}
