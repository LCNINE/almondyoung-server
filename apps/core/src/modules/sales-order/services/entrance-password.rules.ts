export interface EntrancePasswordUpdate {
  shouldWrite: boolean;
  value?: string;
}

/**
 * 리플레이 안전 규칙. Medusa 는 주문일 +14일에 비번을 지우는 통과점이므로,
 * 그 뒤 리플레이된 이벤트에는 비번이 없다. core 가 SoT 이므로
 * "이벤트에 없다"를 "지워라"로 해석하면 안 된다.
 *
 * ⚠️ 현재 프로덕션 호출부 없음 (Task 5, 2026-08-21 조사 결과)
 *
 * `OrderCreated` 컨슈머(`consumers/order-events.consumer.ts#handleOrderCreated`)가 리플레이로
 * 기존 주문(`existing`)을 만나면 `salesOrdersService.createFromEvent` 자체를 호출하지 않는다 —
 * ADR-0010 grant 재시도만 수행하는 순수 멱등 스킵이고, entrancePassword 를 포함한 그 어떤 컬럼도
 * 갱신하는 경로가 없다. 즉 이 함수가 방어하려는 "리플레이가 기존 값을 지운다" 시나리오를
 * 실제로 트리거할 update 경로 자체가 core 에 아직 없다.
 *
 * `sales-orders.service.ts#create()` 의 최초 insert 경로는 신규 행이라 `existing` 이 항상
 * `null` 이므로, 그 경로는 이 함수를 거치지 않고 `dto.entrancePassword ?? null` 을 직접 쓴다
 * (호출해도 되지만 existing=null 분기만 타므로 이 함수의 존재 이유인 "덮어쓰지 않기" 분기는
 * 실질적으로 검증되지 않는다). 이 함수는 core 가 기존 주문의 entrancePassword 를 갱신하는
 * update 경로를 갖추게 될 때(Task 6/7 후보, 또는 향후 OrderCreated 리플레이 처리 확장) 쓰라고
 * 미리 만들어 둔 것이다 — 지금은 export 상태로만 존재하고 호출부가 없다.
 */
export function resolveEntrancePasswordUpdate(input: {
  incoming: string | undefined;
  existing: string | null;
}): EntrancePasswordUpdate {
  if (input.incoming === undefined) return { shouldWrite: false };
  return { shouldWrite: true, value: input.incoming };
}
