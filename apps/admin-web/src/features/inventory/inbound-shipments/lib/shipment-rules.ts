import type { InboundShipmentBox, InboundShipmentDetail } from '@/lib/types/dto/inbound-shipment';

export function forwardBoxes(shipment: InboundShipmentDetail): InboundShipmentBox[] {
  return shipment.boxes.filter((b) => b.disposition === 'forward').sort((a, b) => a.sortKey - b.sortKey);
}

/** 상자 띠의 «SKU 줄 N개는 재고로 안 들어옵니다». */
export function skuLineCountInBox(shipment: InboundShipmentDetail, boxLabel: string): number {
  return shipment.lines.filter((l) => l.kind === 'sku' && l.coversBoxLabels.includes(boxLabel)).length;
}

/** 안내용 — 서버 판정을 대신하지 않는다. */
export function confirmReadiness(
  shipment: InboundShipmentDetail,
  acknowledged: ReadonlySet<string>,
): {
  enabled: boolean;
  unresolvedStockLines: number;
  unacknowledgedForwardBoxIds: string[];
  acknowledgedForwardBoxIds: string[];
} {
  const forward = forwardBoxes(shipment);
  const acknowledgedForwardBoxIds = forward.filter((b) => acknowledged.has(b.id)).map((b) => b.id);
  const unacknowledgedForwardBoxIds = forward.filter((b) => !acknowledged.has(b.id)).map((b) => b.id);

  const stockLabels = new Set(shipment.boxes.filter((b) => b.disposition === 'stock').map((b) => b.label));
  const unresolvedStockLines = shipment.lines.filter(
    (l) =>
      l.kind === 'unresolved' &&
      (l.coversBoxLabels.length === 0 || l.coversBoxLabels.some((label) => stockLabels.has(label))),
  ).length;

  return {
    enabled: shipment.status === 'draft' && unresolvedStockLines === 0 && unacknowledgedForwardBoxIds.length === 0,
    unresolvedStockLines,
    unacknowledgedForwardBoxIds,
    acknowledgedForwardBoxIds,
  };
}

export function shipmentActions(shipment: InboundShipmentDetail): {
  confirm: boolean;
  cancel: boolean;
  close: boolean;
  reopen: boolean;
} {
  const { status } = shipment;
  return {
    confirm: status === 'draft',
    cancel: status === 'draft' || (status === 'expected' && shipment.summary.boxesReceived === 0),
    close: status === 'expected' || status === 'receiving',
    reopen: status === 'closed' && shipment.closedReason !== null,
  };
}

export function boxDispositionEditable(shipment: InboundShipmentDetail, box: InboundShipmentBox): boolean {
  return shipment.status !== 'closed' && shipment.status !== 'canceled' && box.status === 'open';
}

export function defaultShipmentName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return base.slice(0, 255);
}

export function defaultWarehouseId(warehouses: Array<{ id: string; type: string }>): string | null {
  const local = warehouses.filter((w) => w.type !== 'overseas');
  return local.length === 1 ? local[0].id : null;
}

export const CLOSE_REASON_MAX = 500;

/** 끝내기 사유 — 앞뒤 공백을 뺀 1~500자. 서버가 같은 규칙으로 다시 판정한다. */
export function normalizeCloseReason(input: string): { ok: true; reason: string } | { ok: false } {
  const reason = input.trim();
  return reason.length >= 1 && reason.length <= CLOSE_REASON_MAX ? { ok: true, reason } : { ok: false };
}
