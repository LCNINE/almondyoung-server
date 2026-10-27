/**
 * Orders Stream
 *
 * 주문 도메인 이벤트 스트림
 */

import { event, stream } from '../types';
import { z } from 'zod';
import type { ChannelCancelRefundMode, SettleChannelReturnPayload } from './channel-orders-command.stream';
import { CHANNEL_CANCEL_REFUND_MODES } from './channel-orders-command.stream';

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
  /** 아몬드템플릿 시안 id. 장바구니 라인 metadata.almond_design_id 에서 온다. */
  almondDesignId?: string;
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

  /**
   * 공동현관 출입 비밀번호. 크리덴셜이라 shippingAddress 스냅샷에 넣지 않는다 —
   * 스냅샷은 sales_orders / shipments jsonb 로 영구 복사되고 합배송 그룹핑 키에도 쓰인다.
   * core 가 SoT 이며 전용 컬럼에 만료와 함께 보관한다. Medusa 는 통과점.
   */
  entrancePassword?: string;

  status: OrderStatus;
  createdAt: string;
}

/**
 * 수집 뒤 채널 변경 (#1016 5번 행). 변경분이 아니라 **채널이 지금 보여 주는 전체 스냅샷**이다 —
 * channel-adapter 는 이전 값을 들고 있지 않고, 비교는 core 가 유효 판매주문과 한다.
 * 공동현관 비밀번호는 싣지 않는다. core 가 그 값의 정본이고 «없음»은 «지워라»가 아니다.
 */
export interface OrderModifiedSnapshotLine {
  channelOrderItemId: string | null;
  channelProductId: string | null;
  quantity: number;
  unitPrice: number;
  /** 채널이 라인 취소로 표시한 라인. 감소는 lifecycle `OrderCancelled` 가 맡으므로 diff 가 건너뛴다. */
  cancelled: boolean;
}

/**
 * 채널이 core 의 `CancelChannelOrder`(부분취소)를 어디까지 처리했는가 — requestId 별 (#1016 35번 PR-C).
 * Medusa 만 싣는다(`metadata.partialCancels`). 주문 수정이 확정된 뒤 환불이 실패해도 주문은 이미 줄어 있어
 * 이 변경 이벤트가 나간다 — core 는 `edited` 면 요청을 연 채 두고, `refunded` 에서 닫는다.
 */
export interface OrderModifiedCancelRequest {
  requestId: string;
  /** edited: 주문 수정은 확정됐고 환불이 남았다 / refunded: 환불까지 끝났다 */
  stage: 'edited' | 'refunded';
  /** 이번 부분취소로 돌려줄(돌려준) 총액 */
  refundAmount: number;
  /** 조건부 무료 미달 등으로 새로 받은 배송비 */
  shippingCharge: number;
  /** 그룹이 비어 돌려준 배송비 */
  shippingRefund: number;
  /** 스냅샷이 없거나 그룹이 어긋나 배송비를 건드리지 않았다 */
  shippingNotAdjusted: boolean;
  /** 이번 부분취소가 외부 환불에서 상계한 금액(#1016 37번). 0 이면 생략한다 — 수집 해시가 그대로이게 */
  externalRefundApplied?: number;
}

export interface OrderModifiedPayload {
  /** channel-adapter 의 wms_order_id — core 판매주문 id 가 아니다. 참고용. */
  orderId: string;
  salesChannel: SalesChannel;
  externalOrderId: string;
  modifiedAt: string;
  snapshot: {
    lines: OrderModifiedSnapshotLine[];
    shippingAddress: ShippingAddress;
    /** 없으면 진행 중인 부분취소가 없다. 키를 생략한다 — 빈 배열을 싣지 않는다. */
    cancelRequests?: OrderModifiedCancelRequest[];
    /**
     * 채널이 주문을 취소했다(Medusa `status = canceled`). 아니면 키를 두지 않는다.
     * 취소 «사실»은 lifecycle `OrderCancelled` 가 주문당 한 번 낸다 — 이 칸은 core 가 그 한 번을 놓친 정산 중 요청을
     * 재수집 스냅샷으로 닫는 근거다(#1016 36번 재설계 PR 6 판정 3).
     */
    orderCancelled?: true;
  };
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
 * 고객이 반품 사유로 고를 수 있는 값의 정본. Medusa `RETURN_REASONS`
 * (apps/medusa/src/workflows/orders/returns/return-reasons.ts) 와 순서·값이 같다.
 */
export const CUSTOMER_RETURN_REASONS = [
  'change_of_mind',
  'defective',
  'not_as_described',
  'wrong_item',
  'damaged_in_shipping',
  'other',
] as const;

export type CustomerReturnReason = (typeof CUSTOMER_RETURN_REASONS)[number];

/**
 * 채널 반품 접수 사실 (K8 PR5). channel-adapter 가 Medusa 주문의 `returns` 에서 관측해 낸다.
 * `orderId` 는 channel-adapter 의 wmsOrderId 이고 정본은 채널 키(`salesChannel`+`externalOrderId`)다(#656).
 */
export interface ChannelReturnRequestedPayload {
  orderId: string;
  salesChannel: SalesChannel;
  externalOrderId: string;
  returnId: string;
  /** Medusa 반품 기록의 멱등 키 */
  requestId: string;
  reason: CustomerReturnReason;
  feeBearer: 'customer' | 'seller';
  requestedBy: 'customer' | 'operator';
  windowOverrideReason?: string;
  requestedAt: string;
  items: Array<{ channelOrderItemId: string; quantity: number }>;
}

/**
 * 채널 반품 취소 사실 (K8 PR5). `orderId` 는 `ChannelReturnRequestedPayload.orderId` 와 같다.
 */
export interface ChannelReturnCancelledPayload {
  orderId: string;
  salesChannel: SalesChannel;
  externalOrderId: string;
  returnId: string;
  cancelledAt: string;
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
  almondDesignId: z.string().uuid().optional(),
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
  entrancePassword: z.string().optional(),
  status: OrderStatusSchema,
  createdAt: z.string().datetime(),
});

// 기존 OrderItemSchema 를 쓰지 않는다 — 수량 0(Medusa 라인 제거)·미식별 라인이 소비 단계에서 거부된다.
const OrderModifiedSnapshotLineSchema = z.object({
  channelOrderItemId: z.string().trim().min(1).nullable(),
  channelProductId: z.string().trim().min(1).nullable(),
  quantity: z.number().int().nonnegative(),
  unitPrice: z.number().nonnegative(),
  cancelled: z.boolean(),
});

const OrderModifiedCancelRequestSchema = z.object({
  requestId: z.string().min(1),
  stage: z.enum(['edited', 'refunded']),
  refundAmount: z.number().nonnegative(),
  shippingCharge: z.number().nonnegative(),
  shippingRefund: z.number().nonnegative(),
  shippingNotAdjusted: z.boolean(),
  externalRefundApplied: z.number().nonnegative().optional(),
});

const OrderModifiedSchema = z.object({
  orderId: z.string().min(1),
  salesChannel: SalesChannelSchema,
  externalOrderId: z.string().min(1),
  // 네이버 시각은 +09:00 오프셋을 단다(#1016 2번 행과 같은 병) — offset 을 받아야 한다.
  modifiedAt: z.string().datetime({ offset: true }),
  snapshot: z.object({
    lines: z.array(OrderModifiedSnapshotLineSchema),
    shippingAddress: ShippingAddressSchema,
    cancelRequests: z.array(OrderModifiedCancelRequestSchema).optional(),
    orderCancelled: z.literal(true).optional(),
  }),
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

const ChannelReturnRequestedSchema = z.object({
  orderId: z.string().min(1),
  salesChannel: SalesChannelSchema,
  externalOrderId: z.string().min(1),
  returnId: z.string().min(1),
  requestId: z.string().min(1),
  reason: z.enum(CUSTOMER_RETURN_REASONS),
  feeBearer: z.enum(['customer', 'seller']),
  requestedBy: z.enum(['customer', 'operator']),
  windowOverrideReason: z.string().optional(),
  requestedAt: z.string().datetime(),
  items: z
    .array(
      z.object({
        channelOrderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

const ChannelReturnCancelledSchema = z.object({
  orderId: z.string().min(1),
  salesChannel: SalesChannelSchema,
  externalOrderId: z.string().min(1),
  returnId: z.string().min(1),
  cancelledAt: z.string().datetime(),
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
 * Core 주문 취소 완료 사실
 *
 * orders.events.v1 / OrderCancelled 는 외부 채널(Medusa/Naver/Coupang) → Core 인바운드 이벤트.
 * 이 타입은 Core 가 취소를 반영한 뒤 내는 아웃바운드 사실이다. 소비자: ugc-service(리뷰 적립 회수).
 * 채널에 취소를 «요청»하는 것은 이 사실이 아니라 `CancelChannelOrder` 명령이다(ADR-0042) —
 * 이 사실을 구독해 채널을 부르면 채널이 먼저 한 취소가 채널로 되돌아간다.
 * 스트림: core.orders.events.v1
 */
export interface SalesOrderCancelledPayload {
  orderId: string;
  /** Core SalesOrder.channelOrderId (Medusa: 'order_xxx', Naver/Coupang: 채널 주문번호). */
  channelOrderId?: string;
  reason: 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT';
  reasonDetail?: string;
  cancelledBy: string;
  cancelledAt: string;
  /** full: 전체취소. partial: 부분취소(`cancelledLines` 에 줄). */
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

/**
 * Core → 하류 반품 완료 이벤트
 *
 * 반품은 지금까지 아웃박스에 아무것도 넣지 않아 어떤 소비자도 알 수 없었다. 리뷰 자격·적립
 * 회수가 「사서 → 리뷰 → 적립 → 반품」을 막으려면 그 사실이 밖으로 나가야 한다.
 * 스트림: core.orders.events.v1
 *
 * 라인은 «사실»만 싣는다 — 무엇을 회수할지의 판정은 소비자가 한다.
 * `returnedQuantity` 는 이번 반품 건이 아니라 **완료된 반품의 누적 수량**(이 건 포함)이다.
 * 나눠 반품하거나 이벤트가 재전달돼도 소비자가 상태 없이 같은 판정을 내릴 수 있어야 한다.
 */
export interface SalesOrderReturnedPayload {
  orderId: string;
  /** Core SalesOrder.channelOrderId (Medusa: 'order_xxx'). 리뷰 자격이 걸린 주문 축이다. */
  channelOrderId?: string;
  returnRequestId: string;
  reason: 'defective' | 'not_as_described' | 'change_of_mind' | 'wrong_item' | 'damaged_in_shipping' | 'other';
  reasonDetail?: string;
  returnedAt: string;
  returnedLines: Array<{
    salesOrderLineId: string;
    /** Medusa 라인 item id. 채널 주문이 아니거나 매핑 전 주문이면 비어 있다 —
     *  그 라인은 소비자가 라인 축으로 매칭할 수 없다. */
    channelOrderItemId?: string;
    orderedQuantity: number;
    /** 완료된 반품의 누적 수량(이 건 포함). `orderedQuantity` 와 같으면 그 라인은 전량 반품이다. */
    returnedQuantity: number;
    /** 그 라인의 주문 − 취소 전부(판매 단위). 없으면 옛 생산자다 — 소비자는 `orderedQuantity` 로 대신한다.
     *  출고 뒤 취소가 있으면 `orderedQuantity` 까지는 영영 반품될 수 없어, 전량 반품 판정은 이 값과 비교한다. */
    remainingQuantity?: number;
  }>;
}

const SalesOrderReturnedSchema = z.object({
  orderId: z.string().min(1),
  channelOrderId: z.string().optional(),
  returnRequestId: z.string().min(1),
  reason: z.enum(['defective', 'not_as_described', 'change_of_mind', 'wrong_item', 'damaged_in_shipping', 'other']),
  reasonDetail: z.string().optional(),
  returnedAt: z.string().datetime(),
  returnedLines: z.array(
    z.object({
      salesOrderLineId: z.string().min(1),
      channelOrderItemId: z.string().min(1).optional(),
      orderedQuantity: z.number().int().positive(),
      returnedQuantity: z.number().int().positive(),
      remainingQuantity: z.number().int().nonnegative().optional(),
    }),
  ),
});

export interface SalesOrderShipmentDispatchedPayload {
  orderId: string;
  channelOrderId: string;
  displayOrderNo?: string;
  customerId: string;
  customerEmail: string;
  customerName?: string;
  dispatchAttemptId: string;
  isPartial: boolean;
  carrier: string;
  trackingNo: string;
  dispatchedAt: string;
}

const SalesOrderShipmentDispatchedSchema = z.object({
  orderId: z.string().min(1),
  channelOrderId: z.string().min(1),
  displayOrderNo: z.string().min(1).optional(),
  customerId: z.string().min(1),
  customerEmail: z.string().email(),
  customerName: z.string().min(1).optional(),
  dispatchAttemptId: z.string().min(1),
  isPartial: z.boolean(),
  carrier: z.string().min(1),
  trackingNo: z.string().min(1),
  dispatchedAt: z.string().datetime(),
});

export interface SalesOrderClaimProgressedPayload {
  orderId: string;
  channelOrderId: string;
  displayOrderNo?: string;
  customerId: string;
  customerEmail?: string;
  customerName?: string;
  kind: 'return' | 'exchange';
  stage: 'requested' | 'collected' | 'completed';
  requestId: string;
  requestedBy?: 'customer' | 'admin';
  occurredAt: string;
}

const SalesOrderClaimProgressedSchema = z.object({
  orderId: z.string().min(1),
  channelOrderId: z.string().min(1),
  displayOrderNo: z.string().min(1).optional(),
  customerId: z.string().min(1),
  customerEmail: z.string().email().optional(),
  customerName: z.string().min(1).optional(),
  kind: z.enum(['return', 'exchange']),
  stage: z.enum(['requested', 'collected', 'completed']),
  requestId: z.string().min(1),
  requestedBy: z.enum(['customer', 'admin']).optional(),
  occurredAt: z.string().datetime(),
});

// ===== 채널 주문 취소 결과 (#1016 35번 행, ADR-0042) =====

/**
 * 정산 실패 사실 (#1016 36번 재설계 스펙 §7.1·§7.2). 채널이 취소 명령의 «돈 정리»를 끝내지 못했다. 종결 사실이 아니다 —
 * 성공은 사실로 내지 않는다(재수집된 `OrderCancelled`/`OrderModified` 가 곧 사실).
 * - `retryable: false`: 같은 명령을 다시 보내도 같다(wallet·PG 영구 거절, 주문 없음 같은 이상). 운영자가 [다시 시도]·[계좌 송금으로 환불]을 고른다
 * - `retryable: true`: 일시(Medusa 5xx·네트워크·라우트 없음). core 가 같은 requestId·refundMode 로 다시 낸다
 * 판매주문 id 는 싣지 않는다 — channel-adapter 는 core 판매주문 id 를 모른다(#656). core 는 requestId 로 요청 행을 찾는다.
 */
export interface ChannelOrderSettlementFailedPayload {
  /** `CancelChannelOrderPayload.requestId` 그대로 */
  requestId: string;
  salesChannel: string;
  externalOrderId: string;
  scope: 'full' | 'partial';
  retryable: boolean;
  /**
   * 열린 문자열 — 값을 더할 때 소비자 선배포가 필요 없게. Medusa 응답의 code/type(wallet 영구 거절은 `wallet_refund_refused:<wallet 코드>`),
   * 37번 사유 `external_refund_*`, `http_<status>`, `network`, `refund_pending`, adapter 사전검사 `channel_not_supported`·`order_not_collected`
   */
  failureCode: string;
  /** 운영자에게 보일 사유. 채널이 준 문장 그대로(wallet 거절은 토스 한국어 메시지) */
  message: string;
  /** ISO 8601 — channel-adapter 가 결과를 받은 시각. 같은 요청의 사실이 순서 없이 와도 core 가 최신을 고르게 */
  at: string;
}

const ChannelOrderSettlementFailedSchema = z.object({
  requestId: z.string().min(1),
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  scope: z.enum(['full', 'partial']),
  retryable: z.boolean(),
  failureCode: z.string().min(1),
  message: z.string(),
  at: z.string().datetime(),
});

// ===== 채널 반품 정산 결과 (K8 PR6) =====

/** 반품 정산에서 환불액에서 뺀 금액(원, 0 이상 정수). */
export interface ReturnSettlementDeduction {
  returnShipping: number;
  freeShippingBreak: number;
  roundTrip: number;
}

/**
 * 채널 반품 정산 사실 (K8 PR6). channel-adapter 가 Medusa 주문을 재수집해 관측해 낸다 — 성공은 명령의 답이 아니라 관측이다.
 * `orderId` 는 `ChannelReturnRequestedPayload.orderId` 와 같다.
 */
export interface ChannelReturnSettledPayload {
  orderId: string;
  salesChannel: SalesChannel;
  externalOrderId: string;
  returnId: string;
  requestId: string;
  refundAmount: number;
  deduction: ReturnSettlementDeduction;
  feeNotAdjusted: boolean;
  refundMode: ChannelCancelRefundMode;
  settledAt: string;
  items: SettleChannelReturnPayload['items'];
}

/**
 * 반품 정산 실패 사실 (K8 PR6). `ChannelOrderSettlementFailed.scope` 를 넓히지 않고 새 이름으로 낸다(옛 소비자 throw 방지).
 * `received`: Medusa 수령은 확정됐고 환불만 남았다. 판매주문 id 는 싣지 않는다 — `ChannelOrderSettlementFailed` 와 같은 이유(#656).
 */
export interface ChannelReturnSettlementFailedPayload {
  /** `SettleChannelReturnPayload.requestId` 그대로 */
  requestId: string;
  salesChannel: string;
  externalOrderId: string;
  returnId: string;
  received: boolean;
  retryable: boolean;
  /** 열린 문자열 — `ChannelOrderSettlementFailedPayload.failureCode` 와 같은 어휘 */
  failureCode: string;
  message: string;
  /** ISO 8601 */
  at: string;
}

const ReturnSettlementDeductionSchema = z.object({
  returnShipping: z.number().int().nonnegative(),
  freeShippingBreak: z.number().int().nonnegative(),
  roundTrip: z.number().int().nonnegative(),
});

const ChannelReturnSettledSchema = z.object({
  orderId: z.string().min(1),
  salesChannel: SalesChannelSchema,
  externalOrderId: z.string().min(1),
  returnId: z.string().min(1),
  requestId: z.string().min(1),
  refundAmount: z.number().int().nonnegative(),
  deduction: ReturnSettlementDeductionSchema,
  feeNotAdjusted: z.boolean(),
  refundMode: z.enum(CHANNEL_CANCEL_REFUND_MODES),
  settledAt: z.string().datetime(),
  items: z
    .array(
      z.object({
        channelOrderItemId: z.string().min(1),
        received: z.number().int().nonnegative(),
        dismissed: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

const ChannelReturnSettlementFailedSchema = z.object({
  requestId: z.string().min(1),
  salesChannel: z.string().min(1),
  externalOrderId: z.string().min(1),
  returnId: z.string().min(1),
  received: z.boolean(),
  retryable: z.boolean(),
  failureCode: z.string().min(1),
  message: z.string(),
  at: z.string().datetime(),
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
    ChannelReturnRequested: event<'ChannelReturnRequested', ChannelReturnRequestedPayload>(
      'ChannelReturnRequested',
      ChannelReturnRequestedSchema,
    ),
    ChannelReturnCancelled: event<'ChannelReturnCancelled', ChannelReturnCancelledPayload>(
      'ChannelReturnCancelled',
      ChannelReturnCancelledSchema,
    ),
    OrderRefundCreated: event<'OrderRefundCreated', OrderRefundCreatedPayload>(
      'OrderRefundCreated',
      OrderRefundCreatedSchema,
    ),
    OrderMerged: event<'OrderMerged', OrderMergedPayload>('OrderMerged', OrderMergedSchema),
    ChannelOrderSettlementFailed: event<'ChannelOrderSettlementFailed', ChannelOrderSettlementFailedPayload>(
      'ChannelOrderSettlementFailed',
      ChannelOrderSettlementFailedSchema,
    ),
    ChannelReturnSettled: event<'ChannelReturnSettled', ChannelReturnSettledPayload>(
      'ChannelReturnSettled',
      ChannelReturnSettledSchema,
    ),
    ChannelReturnSettlementFailed: event<'ChannelReturnSettlementFailed', ChannelReturnSettlementFailedPayload>(
      'ChannelReturnSettlementFailed',
      ChannelReturnSettlementFailedSchema,
    ),
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
    SalesOrderReturned: event<'SalesOrderReturned', SalesOrderReturnedPayload>(
      'SalesOrderReturned',
      SalesOrderReturnedSchema,
    ),
    SalesOrderShipmentDispatched: event<'SalesOrderShipmentDispatched', SalesOrderShipmentDispatchedPayload>(
      'SalesOrderShipmentDispatched',
      SalesOrderShipmentDispatchedSchema,
    ),
    SalesOrderClaimProgressed: event<'SalesOrderClaimProgressed', SalesOrderClaimProgressedPayload>(
      'SalesOrderClaimProgressed',
      SalesOrderClaimProgressedSchema,
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
} as const;
