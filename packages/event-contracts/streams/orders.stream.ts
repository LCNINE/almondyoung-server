/**
 * Orders Stream
 *
 * 주문 도메인 이벤트 스트림
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Common Types =====

export type FulfillmentKind = 'physical' | 'digital';

export interface OrderItem {
  /**
   * Provider-owned identity for one concrete order line/quantity.
   *
   * Optional during the expand phase because legacy/manual producers may not
   * have captured it. Producers must not substitute an internal line/order ID.
   */
  orderItemId?: string;
  skuId: string;
  masterId: string;
  versionId: string;
  variantId: string;
  productName: string;
  /** Provider-owned listing/product/option identity, independent of orderItemId. */
  channelProductId?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  // 물리/디지털 이행 의도를 downstream(WMS/FO)이 명시적으로 판단할 수 있도록 보존한다.
  // optional — 기존 외부 채널 이벤트(네이버/쿠팡)와의 호환을 위해 미지정 시 물리로 간주한다.
  fulfillmentKind?: FulfillmentKind;
  requiresShipping?: boolean;
}

export interface ShippingAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote?: string;
  /** 개인통관고유부호 — 해외직구(isOverseas) 상품 주문 시 필수 */
  personalCustomsCode?: string;
}

/**
 * 채널 어휘의 정본 (ADR-0031 결정 7). 타입·zod·런타임 검증이 전부 이 배열에서 파생되므로,
 * 채널을 늘릴 자리는 여기 하나다.
 */
export const SALES_CHANNELS = ['medusa', 'naver', 'coupang', '3pl'] as const;

export type SalesChannel = (typeof SALES_CHANNELS)[number];

export type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'timeout';

// ===== Event Payloads =====

/**
 * 주문 생성 이벤트
 */
export interface OrderCreatedPayload {
  orderId: string;
  externalOrderId?: string;
  /** 고객에게 보여주는 주문번호. Medusa display_id ("2332") 등. 알림/CS 표기용. */
  displayOrderNo?: string;
  salesChannel: SalesChannel;
  /**
   * 내부 user-service 사용자 UUID. 로그인 채널(medusa)은 Medusa customer.metadata.almond_user_id 에서 해석.
   * 비-로그인 외부 채널(Naver/Coupang) 또는 미링크 고객은 null. (core sales_orders.customer_id 는 nullable uuid)
   */
  customerId: string | null;
  email?: string;
  /** almond-payment(Wallet) 결제 인텐트 ID. Medusa 주문에만 존재; 다른 채널은 undefined. */
  walletIntentId?: string;

  items: OrderItem[];

  totalAmount: number;
  subtotalAmount: number;
  shippingAmount: number;
  discountAmount: number;
  /**
   * 포인트로 결제한 금액. 포인트는 할인이 아니라 결제수단이라 totalAmount 에 그대로 포함돼 있으므로,
   * 고객이 실제로 낸 현금은 totalAmount - pointsAmount 다. 미사용 주문/구 이벤트에는 없다.
   */
  pointsAmount?: number;
  currency: string;

  shippingAddress: ShippingAddress;

  status: OrderStatus;
  createdAt: string;
}

/**
 * 주문 수정 이벤트
 */
export interface OrderModifiedPayload {
  orderId: string;

  changes: {
    items?: OrderItem[];
    shippingAddress?: ShippingAddress;
    totalAmount?: number;
  };

  modifiedBy: string;
  modifiedAt: string;
  reason?: string;
}

/**
 * 주문 취소 이벤트
 */
export interface OrderCancelledPayload {
  /**
   * 발행자가 아는 주문 식별자. **채널 수집 경로에서는 core 의 `sales_orders.id` 가 아니다** —
   * channel-adapter 가 만든 id 이고 core 는 SO 를 만들 때 자체 PK 를 새로 발급한다 (#656).
   * 아래 채널 키가 있으면 그쪽이 정본이고, 이 값은 옛 메시지 폴백용으로만 남는다.
   */
  orderId: string;
  /** 채널 키 (#656). `OrderCreated` 와 같은 축이며, 소비자는 이 둘로 SO 를 찾는다. */
  salesChannel?: SalesChannel;
  externalOrderId?: string;
  reason: 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT';
  reasonDetail?: string;
  cancelledBy: string;
  cancelledAt: string;

  refundRequired: boolean;
  refundAmount?: number;

  /**
   * 부분 취소 범위 (네이버 개통). **생략 = 전체 취소** 이며, 이는 Core 의
   * `CancelSalesOrderDto.lines` 유무 규칙과 같은 축이다 (`sales-orders.service.ts:440`).
   * 값은 채널이 소유한 라인 식별자이고, Core 가 `sales_order_lines.channel_order_item_id`
   * 로 자기 PK 를 찾는다. 선택 필드라 이 필드를 모르는 옛 메시지도 계속 통과한다.
   */
  cancelledLines?: Array<{ channelOrderItemId: string; quantity: number }>;

  // 재고 복원 정보
  stockRestorationResults?: Array<{
    orderItemId: string;
    skuId: string;
    restoredQty: number;
    stockEventId?: string;
  }>;
}

/**
 * 주문 결제 완료 이벤트 (Medusa 전용)
 */
export interface OrderPaymentCompletedPayload {
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  capturedAt: string;
}

/**
 * 반품 요청 이벤트
 */
export interface OrderReturnRequestedPayload {
  orderId: string;
  returnId: string;

  items: Array<{
    orderItemId: string;
    skuId: string;
    quantity: number;
    reason: 'DEFECTIVE' | 'WRONG_ITEM' | 'CUSTOMER_CHANGED_MIND' | 'SIZE_NOT_FIT';
    reasonDetail?: string;
  }>;

  requestedBy: 'CUSTOMER' | 'ADMIN';
  requestedAt: string;
  note?: string;
}

/**
 * 환불 생성 이벤트
 */
export interface OrderRefundCreatedPayload {
  /** `OrderCancelledPayload.orderId` 와 같은 주의사항 — 채널 키가 정본이다 (#656). */
  orderId: string;
  /** 채널 키 (#656). */
  salesChannel?: SalesChannel;
  externalOrderId?: string;
  refundId: string;
  paymentId: string;

  amount: number;
  currency: string;
  reason: string;
  note?: string;

  createdBy: string;
  createdAt: string;
}

/**
 * 주문 병합 이벤트
 */
export interface OrderMergedPayload {
  targetOrderId: string;
  sourceOrderIds: string[];

  mergedBy: string;
  mergedAt: string;
  reason?: string;
}

// ===== Zod 스키마 정의 =====

const SalesChannelSchema = z.enum(SALES_CHANNELS);
const OrderStatusSchema = z.enum([
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'timeout',
]);

const OrderItemSchema = z.object({
  orderItemId: z.string().trim().min(1).optional(),
  skuId: z.string().min(1),
  masterId: z.string().min(1),
  versionId: z.string().min(1),
  variantId: z.string().min(1),
  productName: z.string().min(1),
  channelProductId: z.string().trim().min(1).optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
  totalPrice: z.number().nonnegative(),
  fulfillmentKind: z.enum(['physical', 'digital']).optional(),
  requiresShipping: z.boolean().optional(),
});

const ShippingAddressSchema = z.object({
  recipientName: z.string().min(1),
  phone: z.string(),
  postalCode: z.string(),
  roadAddress: z.string(),
  detailAddress: z.string(),
  deliveryNote: z.string().optional(),
  personalCustomsCode: z.string().optional(),
});

const OrderCreatedSchema = z.object({
  orderId: z.string().min(1),
  externalOrderId: z.string().optional(),
  displayOrderNo: z.string().optional(),
  salesChannel: SalesChannelSchema,
  customerId: z.string().min(1).nullable(),
  email: z.string().email().optional(),
  walletIntentId: z.string().optional(),
  items: z.array(OrderItemSchema),
  totalAmount: z.number().nonnegative(),
  subtotalAmount: z.number().nonnegative(),
  shippingAmount: z.number().nonnegative(),
  discountAmount: z.number().nonnegative(),
  pointsAmount: z.number().nonnegative().optional(),
  currency: z.string().min(1),
  shippingAddress: ShippingAddressSchema,
  status: OrderStatusSchema,
  createdAt: z.string().datetime(),
});

const OrderModifiedSchema = z.object({
  orderId: z.string().min(1),
  changes: z.object({
    items: z.array(OrderItemSchema).optional(),
    shippingAddress: ShippingAddressSchema.optional(),
    totalAmount: z.number().nonnegative().optional(),
  }),
  modifiedBy: z.string().min(1),
  modifiedAt: z.string().datetime(),
  reason: z.string().optional(),
});

const OrderCancelledSchema = z.object({
  orderId: z.string().min(1),
  // 채널 키 (#656) — optional 이라 이 필드를 모르는 옛 소비자도 계속 통과한다.
  salesChannel: SalesChannelSchema.optional(),
  externalOrderId: z.string().min(1).optional(),
  reason: z.enum(['CUSTOMER_REQUEST', 'OUT_OF_STOCK', 'PAYMENT_FAILED', 'ADMIN_CANCEL', 'TIMEOUT']),
  reasonDetail: z.string().optional(),
  cancelledBy: z.string().min(1),
  cancelledAt: z.string().datetime(),
  refundRequired: z.boolean(),
  refundAmount: z.number().nonnegative().optional(),
  cancelledLines: z
    .array(
      z.object({
        channelOrderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1)
    .optional(),
  stockRestorationResults: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        skuId: z.string().min(1),
        restoredQty: z.number().int().nonnegative(),
        stockEventId: z.string().optional(),
      }),
    )
    .optional(),
});

const OrderPaymentCompletedSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  capturedAt: z.string().datetime(),
});

const OrderReturnRequestedSchema = z.object({
  orderId: z.string().min(1),
  returnId: z.string().min(1),
  items: z.array(
    z.object({
      orderItemId: z.string().min(1),
      skuId: z.string().min(1),
      quantity: z.number().int().positive(),
      reason: z.enum(['DEFECTIVE', 'WRONG_ITEM', 'CUSTOMER_CHANGED_MIND', 'SIZE_NOT_FIT']),
      reasonDetail: z.string().optional(),
    }),
  ),
  requestedBy: z.enum(['CUSTOMER', 'ADMIN']),
  requestedAt: z.string().datetime(),
  note: z.string().optional(),
});

const OrderRefundCreatedSchema = z.object({
  orderId: z.string().min(1),
  // 채널 키 (#656).
  salesChannel: SalesChannelSchema.optional(),
  externalOrderId: z.string().min(1).optional(),
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  reason: z.string().min(1),
  note: z.string().optional(),
  createdBy: z.string().min(1),
  createdAt: z.string().datetime(),
});

const OrderMergedSchema = z.object({
  targetOrderId: z.string().min(1),
  sourceOrderIds: z.array(z.string().min(1)),
  mergedBy: z.string().min(1),
  mergedAt: z.string().datetime(),
  reason: z.string().optional(),
});

/**
 * Core → Channel Adapter 주문 취소 완료 이벤트
 *
 * orders.events.v1 / OrderCancelled 는 외부 채널(Medusa/Naver/Coupang) → Core 인바운드 이벤트.
 * 이 타입은 Core 가 취소를 완료한 뒤 Channel Adapter 에 전파하는 아웃바운드 이벤트.
 * 스트림: core.orders.events.v1
 */
export interface SalesOrderCancelledPayload {
  orderId: string;
  /** Core SalesOrder.channelOrderId (Medusa: 'order_xxx', Naver/Coupang: 채널 주문번호).
   *  채널어댑터가 wms_order_mappings를 조회할 때 사용한다. */
  channelOrderId?: string;
  reason: 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT';
  reasonDetail?: string;
  cancelledBy: string;
  cancelledAt: string;
  /** full: 전체취소 → Medusa cancelOrder 동기화 대상. partial: 부분취소 → Medusa 동기화 제외. */
  cancellationScope: 'full' | 'partial';
  refundRequired: boolean;
  refundAmount?: number;
  /** partial 시 취소된 라인 목록. full cancel에서는 undefined. */
  cancelledLines?: Array<{
    salesOrderLineId: string;
    quantity: number;
  }>;
  stockRestorationResults?: Array<{
    orderItemId: string;
    skuId: string;
    restoredQty: number;
    stockEventId?: string;
  }>;
}

const SalesOrderCancelledSchema = z.object({
  orderId: z.string().min(1),
  channelOrderId: z.string().optional(),
  reason: z.enum(['CUSTOMER_REQUEST', 'OUT_OF_STOCK', 'PAYMENT_FAILED', 'ADMIN_CANCEL', 'TIMEOUT']),
  reasonDetail: z.string().optional(),
  cancelledBy: z.string().min(1),
  cancelledAt: z.string().datetime(),
  cancellationScope: z.enum(['full', 'partial']),
  refundRequired: z.boolean(),
  refundAmount: z.number().nonnegative().optional(),
  cancelledLines: z
    .array(
      z.object({
        salesOrderLineId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .optional(),
  stockRestorationResults: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        skuId: z.string().min(1),
        restoredQty: z.number().int().nonnegative(),
        stockEventId: z.string().optional(),
      }),
    )
    .optional(),
});

// ===== Stream Config (타입 안전 버전) =====

export const ORDER_STREAM = stream({
  topic: 'orders.events.v1',
  partitions: 12,
  aggregateType: 'Order',
  events: {
    OrderCreated: event<'OrderCreated', OrderCreatedPayload>('OrderCreated', OrderCreatedSchema),
    OrderModified: event<'OrderModified', OrderModifiedPayload>('OrderModified', OrderModifiedSchema),
    OrderCancelled: event<'OrderCancelled', OrderCancelledPayload>('OrderCancelled', OrderCancelledSchema),
    OrderPaymentCompleted: event<'OrderPaymentCompleted', OrderPaymentCompletedPayload>(
      'OrderPaymentCompleted',
      OrderPaymentCompletedSchema,
    ),
    OrderReturnRequested: event<'OrderReturnRequested', OrderReturnRequestedPayload>(
      'OrderReturnRequested',
      OrderReturnRequestedSchema,
    ),
    OrderRefundCreated: event<'OrderRefundCreated', OrderRefundCreatedPayload>(
      'OrderRefundCreated',
      OrderRefundCreatedSchema,
    ),
    OrderMerged: event<'OrderMerged', OrderMergedPayload>('OrderMerged', OrderMergedSchema),
  },
});

/**
 * Core → Channel Adapter 스트림 (core.orders.events.v1)
 *
 * Core 가 발행하는 아웃바운드 주문 이벤트. orders.events.v1 (외부 채널 → Core 인바운드) 와 분리.
 */
export const CORE_ORDER_STREAM = stream({
  topic: 'core.orders.events.v1',
  partitions: 12,
  aggregateType: 'Order',
  events: {
    SalesOrderCancelled: event<'SalesOrderCancelled', SalesOrderCancelledPayload>(
      'SalesOrderCancelled',
      SalesOrderCancelledSchema,
    ),
  },
});

// ===== 타입 추론 =====

export type OrderEvents = typeof ORDER_STREAM.events;
export type CoreOrderEvents = typeof CORE_ORDER_STREAM.events;

// =============================================================================
// [LEGACY] Medusa 호환성 코드 - 추후 Medusa 마이그레이션 완료 시 삭제 예정
// =============================================================================
// TODO: Medusa에서 ORDER_STREAM을 직접 사용하도록 마이그레이션 후 삭제
// @see apps/medusa/src/subscribers/order.ts
// =============================================================================

/**
 * @deprecated ORDER_STREAM을 직접 사용하세요.
 * Medusa 마이그레이션 완료 후 삭제 예정입니다.
 */
export const ORDER_EVENTS = {
  ORDER_CREATED: {
    topic: ORDER_STREAM.topic.topic,
    messageType: 'OrderCreated' as const,
  },
  ORDER_CANCELLED: {
    topic: ORDER_STREAM.topic.topic,
    messageType: 'OrderCancelled' as const,
  },
  ORDER_RETURN_REQUESTED: {
    topic: ORDER_STREAM.topic.topic,
    messageType: 'OrderReturnRequested' as const,
  },
} as const;
