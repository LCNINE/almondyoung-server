/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type PurchaseOrderHeaderStatus = 'created' | 'confirmed' | 'received' | 'cancelled';

/**
 * 종결 상태는 되돌아오지 않는다. 파생(`refreshHeaderStatus`)도, 라인 실행도, 입고도
 * 이 둘을 만나면 손대지 않는다. `received` 는 입고 경로가, `cancelled` 는 사람이 소유한다.
 */
export function isTerminal(status: PurchaseOrderHeaderStatus): boolean {
  return status === 'received' || status === 'cancelled';
}

/**
 * 계획이 닫힌 시점에 발주를 종결할 수 있는가 (3층 파생).
 *
 * 전 라인이 종결(`ordered`/`unavailable`)됐어야 한다 — `requested` 가 남아 있으면
 * 아직 살 것이 남은 발주다. 이미 종결된 발주는 건드리지 않는다.
 */
export function canDeriveReceived(input: {
  current: PurchaseOrderHeaderStatus;
  hasRequestedLine: boolean;
}): boolean {
  if (isTerminal(input.current)) return false;
  return !input.hasRequestedLine;
}
