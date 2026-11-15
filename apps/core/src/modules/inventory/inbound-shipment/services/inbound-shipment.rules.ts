/** 선적 입고 순수 규칙 — DB·Nest 를 모른다 (spec §6.2, §6.4). */

export type LineKind = 'sku' | 'free' | 'unresolved';

export type ConfirmBlocker =
  | { code: 'unresolved_line'; lineId: string }
  | { code: 'mixed_disposition'; lineId: string }
  | { code: 'empty_box'; boxId: string };

export function confirmBlockers(
  boxes: { id: string; disposition: 'stock' | 'forward'; origin: 'list' | 'added' }[],
  lines: { id: string; kind: LineKind; boxIds: string[] }[],
): ConfirmBlocker[] {
  const dispositionOf = new Map(boxes.map((b) => [b.id, b.disposition]));
  const covered = new Set<string>();
  const blockers: ConfirmBlocker[] = [];

  for (const line of lines) {
    const dispositions = line.boxIds.map((id) => dispositionOf.get(id)).filter((d) => d !== undefined);
    line.boxIds.forEach((id) => covered.add(id));
    const hasStock = dispositions.includes('stock');
    const hasForward = dispositions.includes('forward');
    // 전달용 상자에만 얹힌 미확인 줄은 입고되지 않으므로 막지 않는다
    if (line.kind === 'unresolved' && (hasStock || dispositions.length === 0)) {
      blockers.push({ code: 'unresolved_line', lineId: line.id });
    }
    if (hasStock && hasForward) blockers.push({ code: 'mixed_disposition', lineId: line.id });
  }
  for (const box of boxes) {
    if (box.origin === 'list' && !covered.has(box.id)) blockers.push({ code: 'empty_box', boxId: box.id });
  }
  return blockers;
}

export function lineEditable(
  shipmentStatus: 'draft' | 'expected' | 'receiving' | 'closed' | 'canceled',
  coveredBoxStatuses: ('open' | 'received')[],
): boolean {
  if (shipmentStatus === 'draft') return true;
  if (shipmentStatus === 'expected' || shipmentStatus === 'receiving') {
    return coveredBoxStatuses.every((s) => s === 'open');
  }
  return false;
}

export type InboundShipmentStatus = 'draft' | 'expected' | 'receiving' | 'closed' | 'canceled';

/**
 * 상자 확정·취소 뒤 선적 상태 (spec §8.4). 초안·취소는 상자로 파생하지 않는다.
 * 재고 상자가 전부 받혔으면 `closed`, 하나라도 받혔으면 `receiving`, 하나도 없으면 `expected`.
 * 전달용 상자는 확정되지 않으므로 세지 않는다 — 전달용뿐인 선적은 저절로 닫히지 않는다.
 */
export function deriveShipmentStatus(
  current: InboundShipmentStatus,
  boxes: { disposition: 'stock' | 'forward'; status: 'open' | 'received' }[],
  manuallyClosed: boolean,
): InboundShipmentStatus {
  if (current === 'draft' || current === 'canceled') return current;
  if (manuallyClosed) return 'closed';
  const stock = boxes.filter((b) => b.disposition === 'stock');
  const received = stock.filter((b) => b.status === 'received').length;
  if (stock.length > 0 && received === stock.length) return 'closed';
  return received > 0 ? 'receiving' : 'expected';
}
