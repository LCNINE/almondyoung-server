import type { CustomerReturnStatus } from '../customer-return/customer-return.types';

/**
 * 청구(반품) 상태 목록의 단 하나의 정의 (K6 PR3a). 청구 수량 조각과 서비스가 모두 이것을 읽는다.
 * 옛 반품·교환 요청 표의 상태 목록은 K8 PR 10 이 표 읽기와 함께 걷었다. 교환(K8 PR11)도 `customer_returns` 행이라
 * 같은 상태 목록으로 이미 센다.
 *
 * 반품 예정 기록(`customer_returns`, K8 PR5)의 상태. 진행 중 ∪ 소진이 «취소되지 않은 반품»이다.
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
