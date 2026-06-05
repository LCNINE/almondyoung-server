/**
 * Fulfillments Stream
 *
 * 이행/배송 도메인 이벤트 스트림
 */

import { event, stream } from '../types';
import { z } from 'zod';

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
  channelOrderId?: string;

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
  channelOrderId?: string;

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

// ===== Zod 스키마 정의 =====

const FulfillmentModeSchema = z.enum(['in_house', '3pl', 'drop_ship']);
const CarrierSchema = z.enum(['CJ', 'HANJIN', 'LOTTE', 'LOGEN', 'KDEXP', 'CJGLS']);

const FulfillmentItemSchema = z.object({
  fulfillmentItemId: z.string().min(1),
  orderItemId: z.string().min(1),
  skuId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const TrackingInfoSchema = z.object({
  carrier: CarrierSchema,
  trackingNumber: z.string().min(1),
  invoiceUrl: z.string().url().optional(),
});

const FulfillmentCreatedSchema = z.object({
  fulfillmentId: z.string().min(1),
  fulfillmentNo: z.string().min(1),
  orderId: z.string().min(1),
  mode: FulfillmentModeSchema,
  warehouseId: z.string().optional(),
  items: z.array(FulfillmentItemSchema),
  createdAt: z.string().datetime(),
});

const FulfillmentReadySchema = z.object({
  fulfillmentId: z.string().min(1),
  orderId: z.string().min(1),
  readyItems: z.array(z.object({
    fulfillmentItemId: z.string().min(1),
    skuId: z.string().min(1),
    readyQty: z.number().int().positive(),
  })),
  readyAt: z.string().datetime(),
  readyBy: z.string().min(1),
});

const FulfillmentLabeledSchema = z.object({
  fulfillmentId: z.string().min(1),
  orderId: z.string().min(1),
  trackingInfo: TrackingInfoSchema,
  labeledAt: z.string().datetime(),
});

const FulfillmentShippedSchema = z.object({
  fulfillmentId: z.string().min(1),
  orderId: z.string().min(1),
  channelOrderId: z.string().optional(),
  trackingInfo: TrackingInfoSchema,
  shippedAt: z.string().datetime(),
  estimatedDeliveryDate: z.string().datetime().optional(),
  shippedItems: z.array(z.object({
    fulfillmentItemId: z.string().min(1),
    skuId: z.string().min(1),
    shippedQty: z.number().int().positive(),
  })),
});

const FulfillmentDeliveredSchema = z.object({
  fulfillmentId: z.string().min(1),
  orderId: z.string().min(1),
  channelOrderId: z.string().optional(),
  deliveredAt: z.string().datetime(),
  recipient: z.string().optional(),
  deliverySignature: z.string().optional(),
});

const FulfillmentCancelledSchema = z.object({
  fulfillmentId: z.string().min(1),
  orderId: z.string().min(1),
  reason: z.enum(['ORDER_CANCELLED', 'OUT_OF_STOCK', 'ADMIN_CANCEL']),
  reasonDetail: z.string().optional(),
  cancelledBy: z.string().min(1),
  cancelledAt: z.string().datetime(),
});

const FulfillmentReturnedSchema = z.object({
  fulfillmentId: z.string().min(1),
  orderId: z.string().min(1),
  returnId: z.string().min(1),
  returnedItems: z.array(z.object({
    fulfillmentItemId: z.string().min(1),
    skuId: z.string().min(1),
    returnedQty: z.number().int().positive(),
  })),
  returnedAt: z.string().datetime(),
  returnReason: z.string().min(1),
});

// ===== Stream Config (타입 안전 버전) =====

export const FULFILLMENT_STREAM = stream({
  topic: 'fulfillments.events.v1',
  partitions: 6,
  aggregateType: 'Fulfillment',
  events: {
    FulfillmentCreated: event('FulfillmentCreated', FulfillmentCreatedSchema),
    FulfillmentReady: event('FulfillmentReady', FulfillmentReadySchema),
    FulfillmentLabeled: event('FulfillmentLabeled', FulfillmentLabeledSchema),
    FulfillmentShipped: event('FulfillmentShipped', FulfillmentShippedSchema),
    FulfillmentDelivered: event('FulfillmentDelivered', FulfillmentDeliveredSchema),
    FulfillmentCancelled: event('FulfillmentCancelled', FulfillmentCancelledSchema),
    FulfillmentReturned: event('FulfillmentReturned', FulfillmentReturnedSchema),
  },
});

// ===== 타입 추론 =====

export type FulfillmentEvents = typeof FULFILLMENT_STREAM.events;

// ===== Medusa 호환성: 레거시 이벤트 상수 =====

export const FulfillmentEventTypes = {
  CREATED: 'FulfillmentCreated',
  READY: 'FulfillmentReady',
  LABELED: 'FulfillmentLabeled',
  SHIPPED: 'FulfillmentShipped',
  DELIVERED: 'FulfillmentDelivered',
  CANCELLED: 'FulfillmentCancelled',
  RETURNED: 'FulfillmentReturned',
} as const;
