import type {
  InboundShipmentBox,
  InboundShipmentDetail,
  InboundShipmentLine,
} from '@/lib/types/dto/inbound-shipment';

export function box(over: Partial<InboundShipmentBox> = {}): InboundShipmentBox {
  return {
    id: 'b1',
    label: 'A1',
    sortKey: 1,
    origin: 'list',
    disposition: 'stock',
    forwardNote: null,
    status: 'open',
    receivedAt: null,
    countedQty: 0,
    ...over,
  };
}

export function line(over: Partial<InboundShipmentLine> = {}): InboundShipmentLine {
  return {
    id: 'l1',
    rowNumber: 2,
    kind: 'sku',
    skuId: 's1',
    sku: { code: 'C1', name: '샘플' },
    expectedQty: 10,
    resolution: 'barcode',
    issues: [],
    coversBoxLabels: ['A1'],
    aiCandidates: null,
    barcodeCandidates: [],
    raw: {},
    countedQty: 0,
    difference: { state: 'pending', counted: 0, expected: 10 },
    ...over,
  };
}

export function shipment(over: Partial<InboundShipmentDetail> = {}): InboundShipmentDetail {
  return {
    id: 'sh1',
    warehouseId: 'w1',
    status: 'draft',
    name: '샘플 선적',
    expectedArrival: null,
    boxCount: 0,
    lineCount: 0,
    createdAt: '2026-11-16T00:00:00.000Z',
    sourceFileId: null,
    sourceFileName: null,
    memo: null,
    closedReason: null,
    closedAt: null,
    boxes: [],
    lines: [],
    summary: {
      boxesReceived: 0,
      boxesTotalStock: 0,
      forwardBoxes: 0,
      addedBoxes: 0,
      shortLines: 0,
      overLines: 0,
      notArrivedLines: 0,
      unplannedCounts: 0,
    },
    unplannedItems: [],
    ...over,
  };
}
