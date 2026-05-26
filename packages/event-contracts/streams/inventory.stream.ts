/**
 * Inventory Stream
 *
 * 재고 도메인 이벤트 스트림
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Common Types =====

export type StockState = 'ON_HAND' | 'DEFECTIVE' | 'IN_TRANSFER';

export type InboundType = 'DOMESTIC' | 'OVERSEAS' | 'RETURN' | 'GENERAL';

export type OutboundType = 'ORDER' | 'DAMAGE' | 'LOSS' | 'DISPOSAL' | 'GENERAL';

export type AdjustmentType = 'MANUAL' | 'INVENTORY_COUNT' | 'SYSTEM';

export type MovementType = 'INTER_WAREHOUSE' | 'INTRA_WAREHOUSE';

// ===== Event Payloads =====

/**
 * 재고 입고 이벤트
 */
export interface StockReceivedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;
  locationId: string;

  inboundType: InboundType;
  inboundId?: string;
  purchaseOrderId?: string;

  receivedAt: string;
  reason?: string;
  note?: string;
}

/**
 * 재고 출고 이벤트
 */
export interface StockShippedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;
  locationId: string;

  outboundType: OutboundType;
  orderId?: string;
  fulfillmentId?: string;

  shippedAt: string;
  reason?: string;
}

/**
 * 재고 조정 이벤트
 */
export interface StockAdjustedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  deltaQuantity: number;
  beforeQuantity: number;
  afterQuantity: number;

  warehouseId: string;
  locationId?: string;

  adjustmentType: AdjustmentType;
  reason: string;
  note?: string;

  adjustedBy: string;
  adjustedAt: string;
}

/**
 * 재고 이동 이벤트
 */
export interface StockMovedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;

  fromWarehouseId: string;
  fromLocationId: string;
  toWarehouseId: string;
  toLocationId: string;

  movementType: MovementType;
  movementId?: string;

  movedAt: string;
  reason?: string;
}

/**
 * 재고 예약 이벤트
 */
export interface StockReservedPayload {
  reservationId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;

  reservedFor: 'ORDER' | 'FULFILLMENT' | 'MANUAL';
  orderId?: string;
  fulfillmentId?: string;

  expiresAt?: string;
  reservedAt: string;
}

/**
 * 재고 예약 확정 이벤트
 */
export interface StockReservationConfirmedPayload {
  reservationId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;

  orderId?: string;
  fulfillmentId?: string;

  confirmedAt: string;
}

/**
 * 재고 예약 해제 이벤트
 */
export interface StockReservationReleasedPayload {
  reservationId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;

  reason: 'CANCELLED' | 'EXPIRED' | 'FULFILLED' | 'MANUAL';
  releasedAt: string;
}

/**
 * 재고 파손 이벤트
 */
export interface StockDamagedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;
  locationId: string;

  damageReason: string;
  damageDescription?: string;
  damagePhotoUrls?: string[];

  damagedAt: string;
  reportedBy: string;
}

/**
 * 재고 분실 이벤트
 */
export interface StockLostPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;
  locationId: string;

  lostReason: string;
  lostDescription?: string;

  lostAt: string;
  reportedBy: string;
}

/**
 * 재고 폐기 이벤트
 */
export interface StockDisposedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;
  locationId: string;

  disposalReason: string;
  disposalMethod?: string;

  disposedAt: string;
  disposedBy: string;
}

/**
 * 재고 불량 지정 이벤트
 */
export interface StockDefectMarkedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;
  locationId: string;

  defectReason: string;
  defectDescription?: string;

  markedAt: string;
  markedBy: string;
}

/**
 * 재고 불량 양품화 이벤트
 */
export interface StockReworkedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;

  quantity: number;
  warehouseId: string;
  locationId: string;

  reworkNote?: string;

  reworkedAt: string;
  reworkedBy: string;
}

export type ProductSellableQuantityReason =
  | 'SELLABLE'
  | 'PRE_STOCK_SELLABLE'
  | 'ALWAYS_SELLABLE_ZERO_STOCK'
  | 'NOT_ACTIVE_VERSION'
  | 'VARIANT_INACTIVE'
  | 'SALES_NOT_STARTED'
  | 'SALES_ENDED'
  | 'MATCHING_MISSING'
  | 'MATCHING_PENDING'
  | 'MATCHING_IGNORED'
  | 'MATCHING_STRATEGY_UNSUPPORTED'
  | 'MATCHING_LINK_MISSING'
  | 'INSUFFICIENT_COMPONENT_STOCK';

export interface ProductSellableQuantityChangedPayload {
  variantId: string;
  masterId?: string | null;
  versionId?: string | null;
  matchingId?: string | null;
  sellableQuantity: number;
  stockBoundQuantity?: number;
  isSellable: boolean;
  reason?: ProductSellableQuantityReason;
  calculatedAt: string;
}

// ===== Zod 스키마 정의 =====

const InboundTypeSchema = z.enum(['DOMESTIC', 'OVERSEAS', 'RETURN', 'GENERAL']);
const OutboundTypeSchema = z.enum(['ORDER', 'DAMAGE', 'LOSS', 'DISPOSAL', 'GENERAL']);
const AdjustmentTypeSchema = z.enum(['MANUAL', 'INVENTORY_COUNT', 'SYSTEM']);
const MovementTypeSchema = z.enum(['INTER_WAREHOUSE', 'INTRA_WAREHOUSE']);

const StockReceivedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  inboundType: InboundTypeSchema,
  inboundId: z.string().optional(),
  purchaseOrderId: z.string().optional(),
  receivedAt: z.string().datetime(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

const StockShippedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  outboundType: OutboundTypeSchema,
  orderId: z.string().optional(),
  fulfillmentId: z.string().optional(),
  shippedAt: z.string().datetime(),
  reason: z.string().optional(),
});

const StockAdjustedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  deltaQuantity: z.number().int(),
  beforeQuantity: z.number().int().nonnegative(),
  afterQuantity: z.number().int().nonnegative(),
  warehouseId: z.string().min(1),
  locationId: z.string().optional(),
  adjustmentType: AdjustmentTypeSchema,
  reason: z.string().min(1),
  note: z.string().optional(),
  adjustedBy: z.string().min(1),
  adjustedAt: z.string().datetime(),
});

const StockMovedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  fromWarehouseId: z.string().min(1),
  fromLocationId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  toLocationId: z.string().min(1),
  movementType: MovementTypeSchema,
  movementId: z.string().optional(),
  movedAt: z.string().datetime(),
  reason: z.string().optional(),
});

const StockReservedSchema = z.object({
  reservationId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  reservedFor: z.enum(['ORDER', 'FULFILLMENT', 'MANUAL']),
  orderId: z.string().optional(),
  fulfillmentId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  reservedAt: z.string().datetime(),
});

const StockReservationConfirmedSchema = z.object({
  reservationId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  orderId: z.string().optional(),
  fulfillmentId: z.string().optional(),
  confirmedAt: z.string().datetime(),
});

const StockReservationReleasedSchema = z.object({
  reservationId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  reason: z.enum(['CANCELLED', 'EXPIRED', 'FULFILLED', 'MANUAL']),
  releasedAt: z.string().datetime(),
});

const StockDamagedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  damageReason: z.string().min(1),
  damageDescription: z.string().optional(),
  damagePhotoUrls: z.array(z.string().url()).optional(),
  damagedAt: z.string().datetime(),
  reportedBy: z.string().min(1),
});

const StockLostSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  lostReason: z.string().min(1),
  lostDescription: z.string().optional(),
  lostAt: z.string().datetime(),
  reportedBy: z.string().min(1),
});

const StockDisposedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  disposalReason: z.string().min(1),
  disposalMethod: z.string().optional(),
  disposedAt: z.string().datetime(),
  disposedBy: z.string().min(1),
});

const StockDefectMarkedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  defectReason: z.string().min(1),
  defectDescription: z.string().optional(),
  markedAt: z.string().datetime(),
  markedBy: z.string().min(1),
});

const StockReworkedSchema = z.object({
  stockEventId: z.string().min(1),
  skuId: z.string().min(1),
  skuCode: z.string().min(1),
  quantity: z.number().int().positive(),
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  reworkNote: z.string().optional(),
  reworkedAt: z.string().datetime(),
  reworkedBy: z.string().min(1),
});

const ProductSellableQuantityReasonSchema = z.enum([
  'SELLABLE',
  'PRE_STOCK_SELLABLE',
  'ALWAYS_SELLABLE_ZERO_STOCK',
  'NOT_ACTIVE_VERSION',
  'VARIANT_INACTIVE',
  'SALES_NOT_STARTED',
  'SALES_ENDED',
  'MATCHING_MISSING',
  'MATCHING_PENDING',
  'MATCHING_IGNORED',
  'MATCHING_STRATEGY_UNSUPPORTED',
  'MATCHING_LINK_MISSING',
  'INSUFFICIENT_COMPONENT_STOCK',
]);

const ProductSellableQuantityChangedSchema = z.object({
  variantId: z.string().min(1),
  masterId: z.string().nullable().optional(),
  versionId: z.string().nullable().optional(),
  matchingId: z.string().nullable().optional(),
  sellableQuantity: z.number().int().nonnegative(),
  stockBoundQuantity: z.number().int().nonnegative().optional(),
  isSellable: z.boolean(),
  reason: ProductSellableQuantityReasonSchema.optional(),
  calculatedAt: z.string().datetime(),
});

// ===== Stream Config (타입 안전 버전) =====

export const INVENTORY_STREAM = stream({
  topic: 'inventory.events.v1',
  partitions: 24,
  aggregateType: 'Stock',
  events: {
    StockReceived: event('StockReceived', StockReceivedSchema),
    StockShipped: event('StockShipped', StockShippedSchema),
    StockAdjusted: event('StockAdjusted', StockAdjustedSchema),
    StockMoved: event('StockMoved', StockMovedSchema),
    StockReserved: event('StockReserved', StockReservedSchema),
    StockReservationConfirmed: event('StockReservationConfirmed', StockReservationConfirmedSchema),
    StockReservationReleased: event('StockReservationReleased', StockReservationReleasedSchema),
    StockDamaged: event('StockDamaged', StockDamagedSchema),
    StockLost: event('StockLost', StockLostSchema),
    StockDisposed: event('StockDisposed', StockDisposedSchema),
    StockDefectMarked: event('StockDefectMarked', StockDefectMarkedSchema),
    StockReworked: event('StockReworked', StockReworkedSchema),
    ProductSellableQuantityChanged: event<'ProductSellableQuantityChanged', ProductSellableQuantityChangedPayload>(
      'ProductSellableQuantityChanged',
      ProductSellableQuantityChangedSchema,
    ),
  },
});

// ===== 타입 추론 =====

export type InventoryEvents = typeof INVENTORY_STREAM.events;
