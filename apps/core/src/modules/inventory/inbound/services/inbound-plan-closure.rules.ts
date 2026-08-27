/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type InboundItemStatus = 'pending' | 'applied' | 'receiving' | 'confirmed' | 'short_closed';

/**
 * 아이템이 더 이상 입고를 기다리지 않는가.
 *
 * `applied`/`receiving` 는 inventory 전체에서 코드 참조 0건인 죽은 값이라 종결로 치지
 * 않는다 — 누군가 되살리면 안 받은 계획이 조용히 닫힌다(#724 항목 7).
 */
export function isItemClosed(status: InboundItemStatus): boolean {
  return status === 'confirmed' || status === 'short_closed';
}

/**
 * 계획이 닫히는가. 아이템이 하나도 없으면 닫지 않는다 — 계획 생성과 첫 아이템 추가
 * 사이의 과도 상태를 종결로 오해하면 라인 실행 도중에 발주가 received 로 밀린다.
 */
export function isPlanClosed(itemStatuses: readonly InboundItemStatus[]): boolean {
  return itemStatuses.length > 0 && itemStatuses.every(isItemClosed);
}
