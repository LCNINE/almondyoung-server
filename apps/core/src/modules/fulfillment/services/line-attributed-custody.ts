import type { BatchInventoryCustodyType } from './batch-inventory-session.service';

/**
 * 줄에 귀속된 보관 — 어느 박스 줄의 몫인지 아는 보관(집은 몫). `AT_SOURCE`·`BULK_CART` 는 줄을 모른다.
 * 배정 변경(`BoxAllocationManager`), 불변식 I3(`FulfillmentInvariantService`), 세션 복구가 같은 정의를 쓴다.
 *
 * `RETURN_PENDING` 은 넣지 않는다(PR 3, 스펙 §13): 되돌림 바구니 키(줄 없음)이고, 바구니로 옮기는 이벤트가 그 순간
 * 배정을 같은 수만큼 줄였으므로 어느 배정과도 견주지 않는다. `SETTLED` 는 발송된 줄의 몫이라 남는다.
 */
export const LINE_ATTRIBUTED_CUSTODY_TYPES: readonly BatchInventoryCustodyType[] = [
  'WORKER',
  'TOTE',
  'SORTING',
  'PACKING',
  'PACKED',
  'SETTLED',
];

export const LINE_ATTRIBUTED_CUSTODY: ReadonlySet<string> = new Set<string>(LINE_ATTRIBUTED_CUSTODY_TYPES);
