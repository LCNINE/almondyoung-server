import {
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderRefundCreatedPayload,
  OrderItem,
  SalesChannel,
  ShippingAddress,
} from '@packages/event-contracts/streams';

export const CHANNEL_ORDER_PROVIDER = Symbol('CHANNEL_ORDER_PROVIDER');
export const CHANNEL_PRODUCT_IDENTIFICATION_FAILED = 'channel_product_identification_failed' as const;
export const COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED = 'collected_order_modification_not_accepted' as const;

export type OrderCollectionFailureReason =
  | typeof CHANNEL_PRODUCT_IDENTIFICATION_FAILED
  | typeof COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED;

export interface OrderCollectionFailureItem {
  externalOrderId: string;
  sourceUpdatedAt: string;
  reason: OrderCollectionFailureReason;
  affectedLineIds: string[];
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
  };
  modifiedAt: string;
}

export interface FetchOrdersResult {
  orders: OrderFetchItem[];
  failures: OrderCollectionFailureItem[];
  lifecycleEvents?: OrderLifecycleEventItem[];
}

export type OrderFetchOutcome =
  | { kind: 'order'; order: OrderFetchItem }
  | { kind: 'failure'; failure: OrderCollectionFailureItem };

export interface ReplayableChannelOrderProvider extends ChannelOrderProvider {
  fetchOrder(externalOrderId: string): Promise<OrderFetchOutcome | null>;
}

export interface ChannelOrderProvider {
  // 유일한 구현(`TranslatingOrderProvider`)과 `ChannelOrderSource` 가 이미 `SalesChannel` 이다.
  // 여기만 `string` 이라 호출부가 캐스팅을 강요당했다 (#656).
  readonly channel: SalesChannel;
  fetchOrders(since: Date | null): Promise<FetchOrdersResult>;
}
