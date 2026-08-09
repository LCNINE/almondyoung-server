/**
 * 아웃박스 발행 보류 게이트 (ADR-0029 §5-1, Task 6-C-2)
 *
 * **왜 이 port 가 필요한가.** core 로컬 디스패처는 `FULFILLMENT_WORKFLOW_MODE=maintenance`
 * 동안 fulfillment·shipment 계열 행을 **선택하지 않았다**(`outbox-dispatcher.service.ts:83`
 * 의 SQL 필터). 적재는 계속되고 발행만 멈추므로, 정비가 끝나면 쌓인 행이 그대로 나간다.
 * 공용 디스패처로 회수하면서 이 성질을 빠뜨리면 정비 중에도 이벤트가 나가기 시작한다 —
 * 6-C-2 에서 바뀌어도 되는 것은 재시도 의미론 하나뿐이므로, 이 성질은 옮겨야 한다.
 *
 * **왜 SQL 조각이 아니라 서술자인가.** 앱이 조건을 drizzle `SQL` 로 돌려주게 하면 앱이 다시
 * 아웃박스 *테이블*을 알아야 한다 — ADR §5-1 (B) 가 `libs/events` 로 모은 바로 그 지식이다.
 * 서술자만 받고 SQL 번역은 디스패처가 하면 그 앎이 새지 않고, 게이트를 DB 없이 단위 테스트할
 * 수 있다.
 */

/**
 * 지금 이 순간 발행을 보류할 행의 서술. 두 조건은 **OR** 로 합쳐진다 — 어느 하나에 걸리면
 * 보류다.
 */
export interface OutboxDispatchPause {
  /** 이 토픽의 행 전부를 보류한다. */
  topics?: string[];
  /** 이 접두사로 시작하는 `event_type` 의 행을 보류한다 (대소문자 무시). */
  eventTypePrefixes?: string[];
}

export interface OutboxDispatchGate {
  /**
   * 매 폴링마다 호출된다 — 모드가 런타임에 바뀔 수 있으므로 부팅 시 한 번이 아니다.
   * 보류할 것이 없으면 `null`.
   */
  pausedRows(): OutboxDispatchPause | null;
}

/** 앱이 게이트를 제공할 때 쓰는 DI 토큰. 제공하지 않으면 보류 없음. */
export const OUTBOX_DISPATCH_GATE = Symbol('OUTBOX_DISPATCH_GATE');
