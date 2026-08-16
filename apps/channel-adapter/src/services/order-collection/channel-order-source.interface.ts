import {
  OrderCancelledPayload,
  OrderRefundCreatedPayload,
  SalesChannel,
  ShippingAddress,
} from '@packages/event-contracts/streams';

export const CHANNEL_ORDER_SOURCE = Symbol('CHANNEL_ORDER_SOURCE');

/**
 * 채널 주문 source — 채널 API 를 **채널 원어 스냅샷**으로 옮기는 것까지가 전부다 (ADR-0031, 후보 2).
 *
 * 이 port 가 좁은 것이 요점이다. 전에는 provider 가 완성된 `OrderCreatedPayload` 를 요구했고,
 * 그래서 새 채널을 붙이려면 Core 계약 전체(orderId 발급 · 주소 정규화 · 식별 해석 · 격리 정책)를
 * 다시 구현해야 했다. 더 나쁜 것은 **식별 해석을 걸 자리가 없었다**는 점이다 — Medusa 는 metadata
 * 를 동기로 읽으면 끝이지만 네이버·쿠팡은 Core 조회가 필요하다.
 *
 * 이제 그 공통 부분은 `ChannelOrderTranslator` 가 갖고, source 는 채널이 실제로 말하는 것만 낸다.
 */

/** 채널이 판정할 수 있는 결제 상태. "그래서 판매주문을 만들 것인가" 는 수집 module 의 정책이다. */
export type ChannelPaymentState =
  /** 결제 실패 위험을 벗어났다 — Core 판매주문 후보. (CONTEXT §Payment Accepted) */
  | 'accepted'
  /** 아직 아니다. 지금은 수집하지 않지만 나중에 `accepted` 가 될 수 있다. */
  | 'pending'
  /** 취소/환불 등으로 끝났다. 새 판매주문을 만들지 않는다. */
  | 'terminal';

export interface ChannelOrderLineSnapshot {
  /** provider 소유의 주문 라인 식별자. 발송처리 명령이 이 값을 되돌려준다. */
  channelOrderItemId: string;
  /** provider 소유의 리스팅/상품 식별자. `lineIdentity: 'mapped'` 채널의 조회 키다. */
  channelProductId?: string;
  /**
   * `lineIdentity: 'embedded'` 채널이 자기 안에 심어둔 우리 식별자. source 가 꺼내는 자리는
   * 채널마다 다르지만(Medusa variant metadata, 네이버 판매자관리코드 …), 없을 때 무엇을 할지의
   * **정책**은 수집 module 이 갖는다.
   */
  embeddedVariantId?: string;
  embeddedMasterId?: string;
  embeddedVersionId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  fulfillmentKind?: 'physical' | 'digital';
  requiresShipping?: boolean;
}

interface LifecycleObservationBase {
  /** 같은 관측을 두 번 세지 않기 위한 채널 내 안정 키. 예: `cancelled`, `refund:<refundId>`. */
  eventKey: string;
  rawEvent: Record<string, unknown>;
}

/**
 * 이미 수집된 주문에 대한 사후 사건 관측. `eventType` 과 `payload` 가 짝을 이루는 판별 유니온이다
 * — 취소 항목에 환불 payload 를 담는 조합이 컴파일되지 않는다.
 *
 * `orderId` 는 없다. 채널은 Core 판매주문 ID 를 모르고, 수집 module 이 매핑에서 채운다.
 */
export type LifecycleObservation = LifecycleObservationBase &
  (
    | { eventType: 'OrderCancelled'; payload: Omit<OrderCancelledPayload, 'orderId'> }
    | { eventType: 'OrderRefundCreated'; payload: Omit<OrderRefundCreatedPayload, 'orderId'> }
  );

export interface ChannelOrderSnapshot {
  externalOrderId: string;
  /** 증분 수집의 watermark 근거. 채널이 말하는 마지막 변경 시각. */
  sourceUpdatedAt: string;
  paymentState: ChannelPaymentState;
  displayOrderNo?: string;
  /** 내부 user-service 사용자 UUID. 비-로그인 채널이나 미링크 고객은 null. */
  customerId: string | null;
  email?: string;
  walletIntentId?: string;
  lines: ChannelOrderLineSnapshot[];
  amounts: {
    total: number;
    subtotal: number;
    shipping: number;
    discount: number;
    /** 포인트는 할인이 아니라 결제수단이라 `total` 에 포함돼 있다. */
    points?: number;
    currency: string;
  };
  shippingAddress: ShippingAddress;
  createdAt: string;
  lifecycle: LifecycleObservation[];
  /** 격리 시 운영자가 볼 채널 원본. */
  raw: Record<string, unknown>;
}

export interface ChannelOrderSource {
  readonly channel: SalesChannel;
  fetchOrders(since: Date | null): Promise<ChannelOrderSnapshot[]>;
}

/** 격리 건을 운영자가 재처리할 수 있는 source. 단건 조회를 제공한다. */
export interface ReplayableChannelOrderSource extends ChannelOrderSource {
  fetchOrder(externalOrderId: string): Promise<ChannelOrderSnapshot | null>;
}

export function isReplayableSource(source: ChannelOrderSource): source is ReplayableChannelOrderSource {
  return typeof (source as ReplayableChannelOrderSource).fetchOrder === 'function';
}
