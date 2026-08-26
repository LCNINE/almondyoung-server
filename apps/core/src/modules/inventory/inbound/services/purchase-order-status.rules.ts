import { ConflictError } from '@app/shared';

/** drizzle enum 컬럼은 문자열 유니온이다. TS enum 멤버로 비교하지 않는다. */
export type PurchaseOrderHeaderStatus = 'created' | 'confirmed' | 'received';

/**
 * 헤더 status 는 라인에서 파생된다(`refreshHeaderStatus`). 사람이 직접 쓸 수 있는 값은
 * 종결(`received`) 하나뿐이고, 그것도 전 라인이 종결(`ordered`/`unavailable`)돼
 * 헤더가 `confirmed` 로 파생된 발주에서만 가능하다.
 *
 * `created` 거부와 `received` 거부는 같은 술어의 두 얼굴이다 — 전자는 아직 발주하지
 * 않은 라인을 입고 처리하는 것을 막고, 후자는 #724 항목 3(#735)이 심사 게이트를
 * 걷어내며 열린 역방향 전이를 막는다.
 */
export function assertReceivedTransition(current: PurchaseOrderHeaderStatus): void {
  if (current === 'confirmed') return;
  throw new ConflictError(
    `Cannot mark purchase order as received from status '${current}' — every line must be executed first`,
  );
}
