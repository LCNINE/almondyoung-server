import {
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderModifiedCancelRequest,
  OrderModifiedPayload,
  OrderRefundCreatedPayload,
  OrderItem,
  SalesChannel,
  ShippingAddress,
} from '@packages/event-contracts/streams';
import type { AffectedLine } from '@packages/domain-types';

export const CHANNEL_ORDER_PROVIDER = Symbol('CHANNEL_ORDER_PROVIDER');
export const CHANNEL_PRODUCT_IDENTIFICATION_FAILED = 'channel_product_identification_failed' as const;
export const COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED = 'collected_order_modification_not_accepted' as const;
/**
 * 수집 처리 중 주문 하나가 실패했다 (#1016 1번 행). 식별 실패와 달리 원인이 데이터·계약·일시 오류 무엇이든
 * 될 수 있어 `failed_stage`·`last_error` 가 원인을 들고, 상한까지 자동 재시도한다.
 */
export const ORDER_COLLECTION_PROCESSING_FAILED = 'order_collection_processing_failed' as const;

export type OrderCollectionFailureReason =
  | typeof CHANNEL_PRODUCT_IDENTIFICATION_FAILED
  | typeof COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED
  | typeof ORDER_COLLECTION_PROCESSING_FAILED;

/** 주문 하나가 실패한 단계. 격리 행의 `failed_stage` 값이다. */
export type OrderProcessingStage = 'fetch' | 'translate' | 'enqueue_order' | 'enqueue_lifecycle';

/**
 * 주문 하나의 처리 실패 (#1016 1번 행). 한 주문의 실패가 채널 폴링 전체를 멈추지 않도록 provider·오케스트레이터가
 * throw 대신 이 항목으로 기록한다. `input` 은 실패한 그 입력 — 원인이 행 안에서 보이게 하려는 것이고 되살릴 때는 쓰지 않는다.
 */
export interface OrderProcessingFailureItem {
  externalOrderId: string;
  /** 워터마크 근거. 조회 실패면 채널이 알려 준 변경 시각이다. */
  sourceUpdatedAt: string;
  stage: OrderProcessingStage;
  error: string;
  input: Record<string, unknown>;
}

export interface OrderCollectionFailureItem {
  externalOrderId: string;
  sourceUpdatedAt: string;
  reason: OrderCollectionFailureReason;
  affectedLineIds: string[];
  /**
   * 라인별 실패 사유 (#674). `channel_product_identification_failed` 에서만 채워진다 —
   * `collected_order_modification_not_accepted` 는 식별 문제가 아니라 사유가 없다.
   *
   * `reason` 을 쪼개지 않고 여기 담는 이유: 사유는 **라인 단위**인데 `reason` 은 주문당 한
   * 칸이라, 거기 넣으면 라인이 여럿일 때 나머지 사유가 유실된다. 또 `reason` 은
   * `uq_order_collection_failure` 의 일부라 값이 바뀌면 같은 주문에 행이 하나 더 생긴다.
   */
  affectedLines?: AffectedLine[];
  rawOrder: Record<string, unknown>;
}

export type OrderLifecycleEventType = 'OrderCancelled' | 'OrderRefundCreated';

export type OrderLifecycleEventPayload =
  | Omit<OrderCancelledPayload, 'orderId'>
  | Omit<OrderRefundCreatedPayload, 'orderId'>;

interface OrderLifecycleEventBase {
  externalOrderId: string;
  sourceUpdatedAt: string;
  eventKey: string;
  rawEvent: Record<string, unknown>;
}

/**
 * **판별 유니온이다** (Task 6-C-3). 전에는 `eventType` 과 `payload` 가 각자 유니온이라
 * 서로 무관했고, `eventType: 'OrderCancelled'` 인 항목에 환불 payload 를 담아도 컴파일됐다.
 * 두 생산자(`medusa-order.provider.ts`)는 원래부터 짝을 맞춰 만들고 있었으므로 이 좁힘은
 * 실동작을 바꾸지 않고, 그 사실을 타입에 적을 뿐이다.
 *
 * 공용 아웃박스 `enqueue<K>` 가 이벤트 키에서 payload 타입을 도출하므로 이 상관관계가
 * 없으면 소비 지점에서 `as` 캐스팅이 필요해진다 — 계약이 잡아 줄 것을 캐스팅으로 덮는 것은
 * ADR-0029 가 없애려는 실패 모드 그 자체다.
 */
export type OrderLifecycleEventItem = OrderLifecycleEventBase &
  (
    | { eventType: 'OrderCancelled'; payload: Omit<OrderCancelledPayload, 'orderId'> }
    | { eventType: 'OrderRefundCreated'; payload: Omit<OrderRefundCreatedPayload, 'orderId'> }
  );

export interface OrderFetchItem {
  externalOrderId: string;
  sourceUpdatedAt: string;
  eligibleForOrderCreation?: boolean;
  createPayload: OrderCreatedPayload;
  changes: {
    items: OrderItem[];
    shippingAddress: ShippingAddress;
    totalAmount: number;
    cancelRequests?: OrderModifiedCancelRequest[];
  };
  modifiedAt: string;
  /**
   * 수집된 주문의 해시가 바뀌면 `OrderModified` 로 그대로 나가는 스냅샷 (#1016 5번 행).
   * `changes`(해시 입력)와 따로 둔다 — 해시 입력은 배포 직후 오격리를 막으려고 모양을 고정했다.
   */
  modification: OrderModifiedPayload['snapshot'];
}

export interface FetchOrdersResult {
  orders: OrderFetchItem[];
  failures: OrderCollectionFailureItem[];
  lifecycleEvents?: OrderLifecycleEventItem[];
  /** 조회·번역 단계에서 실패한 주문 (#1016 1번 행). 오케스트레이터가 처리 실패 행으로 기록하고 지나간다. */
  processingFailures?: OrderProcessingFailureItem[];
  /**
   * 이번 폴이 **끝까지 훑은 닫힌 조회 창**의 끝 (`WindowedChannelOrderSource`).
   *
   * 항목이 하나도 없을 때만 쓰인다 — 그때 워터마크를 여기까지 전진시키지 않으면 같은 닫힌 창을
   * 영원히 다시 묻는다. 열린 질의를 쓰는 source(Medusa)는 이 필드를 내지 않으며, 그 경로의
   * 워터마크 계산은 이 필드가 없던 때와 완전히 같다.
   */
  completedWindowEnd?: Date | null;
}

export type OrderFetchOutcome =
  | { kind: 'order'; order: OrderFetchItem }
  | { kind: 'failure'; failure: OrderCollectionFailureItem };

export interface ReplayableChannelOrderProvider extends ChannelOrderProvider {
  fetchOrder(externalOrderId: string): Promise<OrderFetchOutcome | null>;
}

/** 즉시 끌어오기(#1016 5번 행, 스펙 §9.1)가 받는 것 — 폴링과 같은 처리를 태우려면 lifecycle 도 함께 필요하다. */
export interface OrderSyncFetch {
  outcome: OrderFetchOutcome;
  lifecycle: OrderLifecycleEventItem[];
}

export interface SyncableChannelOrderProvider extends ChannelOrderProvider {
  fetchOrderForSync(externalOrderId: string): Promise<OrderSyncFetch | null>;
}

export interface ChannelOrderProvider {
  // 유일한 구현(`TranslatingOrderProvider`)과 `ChannelOrderSource` 가 이미 `SalesChannel` 이다.
  // 여기만 `string` 이라 호출부가 캐스팅을 강요당했다 (#656).
  readonly channel: SalesChannel;
  fetchOrders(since: Date | null): Promise<FetchOrdersResult>;
}
