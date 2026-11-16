import type { InboundShipmentBoxView } from '@/lib/types/dto/inbound-shipment';

type BoxState = 'open' | 'received' | 'forward';

/** 맨 위 상태 표기 — 스펙 §9 «열림/확정» */
const STATE_LABEL: Record<BoxState, string> = {
  open: '열림',
  received: '확정',
  forward: '전달용',
};

/** 센 방법 — «센 것»과 «리스트대로»를 관리자가 늘 구별할 수 있게 둘 다 적는다 */
const METHOD_LABEL = { counted: '센 것', list: '리스트대로' } as const;

/** 열린 상자의 한 줄 — 스펙 §9 */
const OPEN_NOTICE = '아직 확정 전';

export type BoxDrawerRows = {
  header: {
    title: string;
    shipmentName: string;
    state: BoxState;
    stateLabel: string;
    receivedAt: string | null;
    /** 상태 아래 한 줄 — 열린 상자만 «아직 확정 전» */
    notice: string | null;
  };
  lines: {
    lineId: string;
    product: string;
    sku: string | null;
    expected: string;
    /** 이 상자에서 센 수량 — 열린 상자이거나 집계가 없으면 null(0 을 지어내지 않는다) */
    counted: number | null;
    method: 'counted' | 'list' | null;
    /** 센 수량 칸 — null 이면 칸이 없다(열린 상자), 확정된 상자에 집계가 없으면 «—» */
    countText: string | null;
    methodLabel: string | null;
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
        stateLabel: STATE_LABEL.forward,
        receivedAt: formatSeoulTime(box.receivedAt),
        notice: null,
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
      stateLabel: received ? STATE_LABEL.received : STATE_LABEL.open,
      receivedAt: formatSeoulTime(box.receivedAt),
      notice: received ? null : OPEN_NOTICE,
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
        counted: count?.countedQty ?? null,
        method: count?.method ?? null,
        countText: received
          ? count
            ? count.countedQty.toLocaleString('ko-KR')
            : '—'
          : null,
        methodLabel: count ? METHOD_LABEL[count.method] : null,
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
