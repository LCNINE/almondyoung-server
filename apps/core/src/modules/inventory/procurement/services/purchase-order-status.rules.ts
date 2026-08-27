import { ConflictError } from '@app/shared';

/**
 * drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다.
 * `cancelled` 은 #724 항목 7 에서 추가된 값이다 — 이 함수는 아직 그 상태로부터의
 * 전이를 별도로 다루지 않고, 아래 catch-all 이 `created` 와 동일하게 거부한다
 * (취소된 발주는 입고 완료로 전이할 수 없다는 점에서 이미 올바른 동작이다).
 */
export type PurchaseOrderHeaderStatus = 'created' | 'confirmed' | 'received' | 'cancelled';

/**
 * 헤더 status 는 라인에서 파생된다(`refreshHeaderStatus`). 사람이 직접 쓸 수 있는 값은
 * 종결(`received`) 하나뿐이고, 그것도 전 라인이 종결(`ordered`/`unavailable`)돼
 * 헤더가 `confirmed` 로 파생된 발주에서만 가능하다.
 *
 * `created` 거부와 `received` 거부는 같은 술어의 두 얼굴이다 — 전자는 아직 발주하지
 * 않은 라인을 입고 처리하는 것을 막고, 후자는 #724 항목 3(#735)이 심사 게이트를
 * 걷어내며 열린 역방향 전이를 막는다.
 *
 * **두 얼굴이면 문장도 둘이어야 한다.** 한 문장을 돌려쓰던 때는 이미 전 라인이 실행된
 * 발주에게 "라인을 먼저 실행하라" 고 답했다 — 원인과 반대되는 안내였다.
 */
export function assertReceivedTransition(current: PurchaseOrderHeaderStatus): void {
  if (current === 'confirmed') return;
  if (current === 'received') {
    throw new ConflictError('Purchase order is already received; it cannot be received again');
  }
  throw new ConflictError(
    `Cannot mark purchase order as received from status '${current}' — some lines are not executed yet`,
  );
}
