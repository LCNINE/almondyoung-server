/** 선적 입고 순수 규칙 — DB·Nest 를 모른다 (spec §6.2, §6.4). */

import { BadRequestError } from '@app/shared';
import { expandBoxLabel } from './inbound-shipment-list.parser';

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

/** 앱이 넣거나 스캔한 상자 이름 하나를 정규화한다 — 범위·추측 표기는 400 (spec §8.1·§8.7). */
export function normalizeSingleBoxLabel(input: string): string {
  const { labels, issue } = expandBoxLabel(input);
  if (issue !== null || labels.length !== 1) throw new BadRequestError(`상자 이름 하나를 넣어 주세요: ${input}`);
  return labels[0];
}

export type LineDifference =
  | { state: 'pending'; counted: number; expected: number | null }
  | { state: 'not_arrived'; counted: number; expected: number | null }
  | { state: 'match' | 'short' | 'over'; counted: number; expected: number };

/**
 * 줄의 예정·실제 차이 (spec §8.4·§8.5). 실제 = 유효 집계 합.
 * 줄이 덮는 상자가 **전부** 확정됐을 때만 모자람·남음을 판정하고, 그 전엔 진행 중(`pending`).
 * 사람이 닫은 선적(`manuallyClosed`)에서 열린 상자가 남은 줄은 «안 옴»(`not_arrived`) — 더 오지 않는다.
 * 예정 수량이 없으면(미확인 줄 잔재 등) 판정하지 않는다. 덮는 상자가 없는 줄도 판정하지 않는다.
 * `coveredBoxStatuses` 는 입고용 상자만 넘긴다 — 전달용 상자는 확정되지 않으므로 «안 옴»이 아니다.
 */
export function lineDifference(
  expectedQty: number | null,
  liveCounts: number[],
  coveredBoxStatuses: ('open' | 'received')[],
  manuallyClosed: boolean,
): LineDifference {
  const counted = liveCounts.reduce((sum, n) => sum + n, 0);
  if (expectedQty === null || coveredBoxStatuses.length === 0) {
    return { state: 'pending', counted, expected: expectedQty };
  }
  if (coveredBoxStatuses.some((s) => s === 'open')) {
    return { state: manuallyClosed ? 'not_arrived' : 'pending', counted, expected: expectedQty };
  }
  if (counted === expectedQty) return { state: 'match', counted, expected: expectedQty };
  return { state: counted < expectedQty ? 'short' : 'over', counted, expected: expectedQty };
}

/**
 * 확정 취소가 커널 `cancelLine` 을 부를 순서 — SKU 순, 같은 SKU 면 회차 라인 id 순.
 * `cancelLine` 의 원장 역분개는 (sku, 창고) advisory 락을 라인마다 하나씩 잡는다. 도착(`recordArrival`)은
 * 같은 락을 SKU 순으로 미리 잡으므로, 취소도 SKU 순으로 잡아야 두 선적 사이에 잠금 순환(40P01)이 생기지 않는다.
 */
export function orderReceiptLinesForCancel<T extends { receiptLineId: string; skuId: string }>(lines: T[]): T[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...lines].sort((a, b) => cmp(a.skuId, b.skuId) || cmp(a.receiptLineId, b.receiptLineId));
}
