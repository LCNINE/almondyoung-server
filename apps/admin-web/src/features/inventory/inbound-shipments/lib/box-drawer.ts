import type { InboundShipmentBoxView } from '@/lib/types/dto/inbound-shipment';

export type BoxDrawerRows = {
  header: {
    title: string;
    state: 'open' | 'received' | 'forward';
    receivedAt: string | null;
  };
  lines: {
    lineId: string;
    product: string;
    sku: string | null;
    expected: string;
    counted: number | null;
    method: 'counted' | 'list' | null;
  }[];
  unplanned: { skuCode: string; skuName: string; counted: number }[];
  forwardNote: string | null;
};

function expectedText(
  labels: string[],
  expectedQty: number | null
): string {
  const total = expectedQty === null ? '' : expectedQty.toLocaleString('ko-KR');
  if (labels.length <= 1) return total;
  return `${labels[0]}~${labels[labels.length - 1]} 합계 ${total}`;
}

/** 서랍이 그리는 값 전부. 화면은 이 결과를 그리기만 한다. */
export function boxDrawerRows(box: InboundShipmentBoxView): BoxDrawerRows {
  const received = box.status === 'received';
  if (box.disposition === 'forward') {
    return {
      header: {
        title: box.label,
        state: 'forward',
        receivedAt: box.receivedAt,
      },
      lines: [],
      unplanned: [],
      forwardNote: box.forwardNote,
    };
  }
  return {
    header: {
      title: box.label,
      state: received ? 'received' : 'open',
      receivedAt: box.receivedAt,
    },
    lines: box.lines.map((l) => {
      const count = received
        ? box.counts.find((c) => c.lineId === l.lineId)
        : undefined;
      return {
        lineId: l.lineId,
        product: l.sku?.name ?? l.productName,
        sku: l.sku?.code ?? null,
        expected: expectedText(l.coversBoxLabels, l.expectedQty),
        counted: received ? (count?.countedQty ?? 0) : null,
        method: received ? (count?.method ?? 'counted') : null,
      };
    }),
    unplanned: box.counts
      .filter((c) => c.lineId === null)
      .map((c) => ({
        skuCode: c.skuCode ?? '',
        skuName: c.skuName ?? '',
        counted: c.countedQty,
      })),
    forwardNote: null,
  };
}
