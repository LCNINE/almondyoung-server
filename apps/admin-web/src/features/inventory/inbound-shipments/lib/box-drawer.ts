import type { InboundShipmentBoxView } from '@/lib/types/dto/inbound-shipment';

export type BoxDrawerRows = {
  header: {
    title: string;
    shipmentName: string;
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

/** 서울 시각 `YYYY-MM-DD HH:mm`. */
export function formatSeoulTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function expectedText(
  labels: string[],
  expectedQty: number | null
): string {
  const total = expectedQty === null ? '—' : expectedQty.toLocaleString('ko-KR');
  if (labels.length <= 1) return expectedQty === null ? '' : total;
  return `${labels[0]}~${labels[labels.length - 1]} 합계 ${total}`;
}

/** 서랍이 그리는 값 전부. 화면은 이 결과를 그리기만 한다. */
export function boxDrawerRows(box: InboundShipmentBoxView): BoxDrawerRows {
  const title = `${box.shipmentName} · 상자 ${box.label}`;
  const received = box.status === 'received';
  if (box.disposition === 'forward') {
    return {
      header: {
        title,
        shipmentName: box.shipmentName,
        state: 'forward',
        receivedAt: formatSeoulTime(box.receivedAt),
      },
      lines: [],
      unplanned: [],
      forwardNote: box.forwardNote,
    };
  }
  return {
    header: {
      title,
      shipmentName: box.shipmentName,
      state: received ? 'received' : 'open',
      receivedAt: formatSeoulTime(box.receivedAt),
    },
    lines: box.lines.map((l) => {
      const count = received
        ? box.counts.find((c) => c.lineId === l.lineId)
        : undefined;
      return {
        lineId: l.lineId,
        product: l.option ? `${l.productName} ${l.option}` : l.productName,
        sku: l.sku ? `${l.sku.code} ${l.sku.name}` : null,
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
