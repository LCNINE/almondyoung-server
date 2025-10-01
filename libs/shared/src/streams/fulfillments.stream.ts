/**
 * Fulfillments Stream
 *
 * 이행/배송 도메인 이벤트 스트림
 */

import { StreamConfig, EventType } from '@app/events';

// ===== Common Types =====

export type FulfillmentMode = 'in_house' | '3pl' | 'drop_ship';

export type FulfillmentStatus =
  | 'created'
  | 'ready'
  | 'labeled'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type Carrier = 'CJ' | 'HANJIN' | 'LOTTE' | 'LOGEN' | 'KDEXP' | 'CJGLS';

export interface FulfillmentItem {
  fulfillmentItemId: string;
  orderItemId: string;
  skuId: string;
  quantity: number;
}

export interface TrackingInfo {
  carrier: Carrier;
  trackingNumber: string;
  invoiceUrl?: string;
}

// ===== Event Payloads =====

/**
 * 이행 생성 이벤트
 */
export interface FulfillmentCreatedPayload {
  fulfillmentId: string;
  fulfillmentNo: string;
  orderId: string;

  mode: FulfillmentMode;
  warehouseId?: string;

  items: FulfillmentItem[];

  createdAt: string;
}

/**
 * 출고 준비 완료 이벤트 (피킹 완료)
 */
export interface FulfillmentReadyPayload {
  fulfillmentId: string;
  orderId: string;

  readyItems: Array<{
    fulfillmentItemId: string;
    skuId: string;
    readyQty: number;
  }>;

  readyAt: string;
  readyBy: string;
}

/**
 * 송장 출력 완료 이벤트
 */
export interface FulfillmentLabeledPayload {
  fulfillmentId: string;
  orderId: string;

  trackingInfo: TrackingInfo;

  labeledAt: string;
}

/**
 * 출고 완료 이벤트 (배송 시작)
 */
export interface FulfillmentShippedPayload {
  fulfillmentId: string;
  orderId: string;

  trackingInfo: TrackingInfo;

  shippedAt: string;
  estimatedDeliveryDate?: string;

  shippedItems: Array<{
    fulfillmentItemId: string;
    skuId: string;
    shippedQty: number;
  }>;
}

/**
 * 배송 완료 이벤트
 */
export interface FulfillmentDeliveredPayload {
  fulfillmentId: string;
  orderId: string;

  deliveredAt: string;
  recipient?: string;
  deliverySignature?: string;
}

/**
 * 이행 취소 이벤트
 */
export interface FulfillmentCancelledPayload {
  fulfillmentId: string;
  orderId: string;

  reason: 'ORDER_CANCELLED' | 'OUT_OF_STOCK' | 'ADMIN_CANCEL';
  reasonDetail?: string;
  cancelledBy: string;
  cancelledAt: string;
}

/**
 * 반품 완료 이벤트
 */
export interface FulfillmentReturnedPayload {
  fulfillmentId: string;
  orderId: string;
  returnId: string;

  returnedItems: Array<{
    fulfillmentItemId: string;
    skuId: string;
    returnedQty: number;
  }>;

  returnedAt: string;
  returnReason: string;
}

// ===== Event Types Map =====

export type FulfillmentEvents = {
  FulfillmentCreated: EventType<FulfillmentCreatedPayload>;
  FulfillmentReady: EventType<FulfillmentReadyPayload>;
  FulfillmentLabeled: EventType<FulfillmentLabeledPayload>;
  FulfillmentShipped: EventType<FulfillmentShippedPayload>;
  FulfillmentDelivered: EventType<FulfillmentDeliveredPayload>;
  FulfillmentCancelled: EventType<FulfillmentCancelledPayload>;
  FulfillmentReturned: EventType<FulfillmentReturnedPayload>;
};

// ===== Stream Config =====

export const FULFILLMENT_STREAM: StreamConfig<FulfillmentEvents> = {
  topic: {
    topic: 'fulfillments.events.v1',
    partitions: 6,
  },
  aggregateType: 'Fulfillment',
  events: {
    FulfillmentCreated: {
      messageType: 'FulfillmentCreated',
      payloadType: {} as FulfillmentCreatedPayload,
    },
    FulfillmentReady: {
      messageType: 'FulfillmentReady',
      payloadType: {} as FulfillmentReadyPayload,
    },
    FulfillmentLabeled: {
      messageType: 'FulfillmentLabeled',
      payloadType: {} as FulfillmentLabeledPayload,
    },
    FulfillmentShipped: {
      messageType: 'FulfillmentShipped',
      payloadType: {} as FulfillmentShippedPayload,
    },
    FulfillmentDelivered: {
      messageType: 'FulfillmentDelivered',
      payloadType: {} as FulfillmentDeliveredPayload,
    },
    FulfillmentCancelled: {
      messageType: 'FulfillmentCancelled',
      payloadType: {} as FulfillmentCancelledPayload,
    },
    FulfillmentReturned: {
      messageType: 'FulfillmentReturned',
      payloadType: {} as FulfillmentReturnedPayload,
    },
  },
};

// ===== Event Type Constants =====

export const FulfillmentEventTypes = {
  CREATED: 'FulfillmentCreated',
  READY: 'FulfillmentReady',
  LABELED: 'FulfillmentLabeled',
  SHIPPED: 'FulfillmentShipped',
  DELIVERED: 'FulfillmentDelivered',
  CANCELLED: 'FulfillmentCancelled',
  RETURNED: 'FulfillmentReturned',
} as const;
