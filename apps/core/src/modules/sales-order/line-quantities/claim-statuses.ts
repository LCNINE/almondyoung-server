import type { CustomerReturnStatus } from '../customer-return/customer-return.types';

/**
 * 청구(반품·교환) 상태 목록의 단 하나의 정의 (K6 PR3a). 청구 수량 조각과 서비스가 모두 이것을 읽는다.
 *
 * - 진행 중 반품은 `claimable` 에서 빠진다 — 같은 물건을 두 번 청구하지 못하게.
 * - 완료 반품은 소진이다 — 물건이 돌아왔으니 다시 청구할 수 없다.
 * - 진행 중 교환도 빠진다. 완료 교환은 아무것도 빼지 않는다 — 고객이 새 물건을 받았으니 그 물건을 다시 청구할 수 있다.
 * - `rejected`·`cancelled` 는 반품·교환 모두 아무것도 빼지 않는다.
 */
export const ACTIVE_RETURN_STATUSES = [
  'requested',
  'approved',
  'collection_pending',
  'collected',
  'inspected',
  'refund_pending',
] as const;

export const CONSUMED_RETURN_STATUSES = ['completed'] as const;

/** 반품과 같은 여섯 값 — 뜻이 달라 이름을 따로 둔다(한쪽만 바뀔 때 다른 쪽이 딸려 바뀌지 않게 고칠 자리). */
export const ACTIVE_EXCHANGE_STATUSES = ACTIVE_RETURN_STATUSES;

/**
 * 반품 예정 기록(`customer_returns`, K8 PR5)의 상태 — 옛 반품 요청 표와 값이 달라 따로 둔다. 둘의 합집합이 «취소되지 않은 반품»이다.
 * - 진행 중(expected~refund_pending)은 `claimable` 에서 빠지고, 라인의 `returnHeld`(취소 상한에서 뺀다)에 든다.
 * - 정산(settled)은 소진이다 — 물건이 돌아왔고 돈도 돌려줬다. `returnHeld` 에도 남는다(다시 취소할 수 없다).
 * - `cancelled` 는 아무것도 빼지 않는다.
 */
export const CUSTOMER_RETURN_ACTIVE_STATUSES = [
  'expected',
  'arrived',
  'inspected',
  'held',
  'refund_pending',
] as const satisfies readonly CustomerReturnStatus[];

export const CUSTOMER_RETURN_CONSUMED_STATUSES = ['settled'] as const satisfies readonly CustomerReturnStatus[];
