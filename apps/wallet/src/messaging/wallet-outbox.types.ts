/**
 * wallet 아웃박스 적재 입력 (ADR-0029 §5-1, Task 6-C-3)
 *
 * 상태 전이(`StateTransitionService`)가 도메인 트랜잭션에 실어 보내는 이벤트의 모양이다.
 * 전에는 `{ eventType: string; payload: Record<string, unknown> }` 이었다 — 이름과 payload 가
 * 서로 무관해서, `payment.intent.captured` 에 환불 payload 를 담아도 컴파일됐다.
 *
 * 이제 **판별 유니온**이다. 계열 안에서는 payload 타입이 하나이므로(9개 intent 이벤트가
 * `PaymentIntentEventPayload`, 2개 refund 이벤트가 `GatewayRefundEventPayload`) 계열만 좁히면
 * 공용 `StreamPublisher.enqueue<K>` 의 타입 도출이 캐스팅 없이 통과한다.
 *
 * **`aggregateType` 이 없다.** 옛 로컬 테이블은 행마다 그 값을 들고 있었고 호출자가
 * `'PaymentGateway'` 를 넘겼는데, 공용 경로에서는 계약(`PAYMENT_STREAM.aggregateType`)이
 * 소유한다 — 스트림이 정하는 사실을 호출자마다 다시 적으면 갈라질 수 있다.
 */

import type {
  GatewayRefundEventPayload,
  PaymentIntentEventPayload,
  PAYMENT_STREAM,
} from '@packages/event-contracts/streams';

type PaymentStreamEventName = keyof typeof PAYMENT_STREAM.events;

/**
 * 계열 이름 목록. **계약 키에서 좁혀 둔 것**이라 오타는 컴파일에서 걸리고,
 * 계약에서 이벤트가 사라지면 여기서 먼저 깨진다.
 */
export const PAYMENT_INTENT_EVENT_NAMES = [
  'payment.intent.created',
  'payment.intent.authorized',
  'payment.intent.succeeded',
  'payment.intent.captured',
  'payment.intent.partially_captured',
  'payment.intent.failed',
  'payment.intent.canceled',
  'payment.intent.awaiting_deposit',
  'payment.intent.refund_requested',
  'payment.intent.refund_request_rejected',
] as const satisfies readonly PaymentStreamEventName[];

/**
 * `gateway.refund.succeeded` **하나뿐이다.** `GatewayEventType` 상수에는
 * `gateway.refund.failed` 도 있지만 계약에 없고 적재하는 곳도 없다 — `satisfies` 가 그것을
 * 컴파일에서 잡았다. 계약에 없는 이름을 여기 적으면 소비자가 검증을 켜는 순간 DLQ 가 된다.
 */
export const GATEWAY_REFUND_EVENT_NAMES = [
  'gateway.refund.succeeded',
] as const satisfies readonly PaymentStreamEventName[];

export type PaymentIntentEventName = (typeof PAYMENT_INTENT_EVENT_NAMES)[number];
export type GatewayRefundEventName = (typeof GATEWAY_REFUND_EVENT_NAMES)[number];

interface WalletOutboxAppendBase {
  aggregateId: string;
  /** 생략하면 `aggregateId`. 옛 `buildOutboxInsertValues` 와 같은 폴백이다. */
  partitionKey?: string;
  /**
   * 넘기면 `unique(topic, event_type, idempotency_key)` 가 같은 사실의 두 번째 적재를 막는다.
   * 생략하면 중복 방어가 없다 — 옛 로컬 테이블에는 그 제약이 아예 없었으므로, 생략이 곧
   * 옛 동작이다.
   */
  idempotencyKey?: string;
}

export type WalletOutboxAppendInput = WalletOutboxAppendBase &
  (
    | { eventType: PaymentIntentEventName; payload: PaymentIntentEventPayload }
    | { eventType: GatewayRefundEventName; payload: GatewayRefundEventPayload }
  );

export function isPaymentIntentAppend(
  event: WalletOutboxAppendInput,
): event is WalletOutboxAppendBase & { eventType: PaymentIntentEventName; payload: PaymentIntentEventPayload } {
  return (PAYMENT_INTENT_EVENT_NAMES as readonly string[]).includes(event.eventType);
}

export function isGatewayRefundAppend(
  event: WalletOutboxAppendInput,
): event is WalletOutboxAppendBase & { eventType: GatewayRefundEventName; payload: GatewayRefundEventPayload } {
  return (GATEWAY_REFUND_EVENT_NAMES as readonly string[]).includes(event.eventType);
}
