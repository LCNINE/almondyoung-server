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
