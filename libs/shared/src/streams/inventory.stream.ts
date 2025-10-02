/**
 * Inventory Stream
 *
 * 재고 도메인 이벤트 스트림
 */

import { StreamConfig, EventType } from '@app/events';

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

// ===== Event Types Map =====

export type InventoryEvents = {
  StockReceived: EventType<StockReceivedPayload>;
  StockShipped: EventType<StockShippedPayload>;
  StockAdjusted: EventType<StockAdjustedPayload>;
  StockMoved: EventType<StockMovedPayload>;
  StockReserved: EventType<StockReservedPayload>;
  StockReservationConfirmed: EventType<StockReservationConfirmedPayload>;
  StockReservationReleased: EventType<StockReservationReleasedPayload>;
  StockDamaged: EventType<StockDamagedPayload>;
  StockLost: EventType<StockLostPayload>;
  StockDisposed: EventType<StockDisposedPayload>;
  StockDefectMarked: EventType<StockDefectMarkedPayload>;
  StockReworked: EventType<StockReworkedPayload>;
};

// ===== Stream Config =====

export const INVENTORY_STREAM: StreamConfig<InventoryEvents> = {
  topic: {
    topic: 'inventory.events.v1',
    partitions: 24,
  },
  aggregateType: 'Stock',
  events: {
    StockReceived: {
      messageType: 'StockReceived',
      payloadType: {} as StockReceivedPayload,
    },
    StockShipped: {
      messageType: 'StockShipped',
      payloadType: {} as StockShippedPayload,
    },
    StockAdjusted: {
      messageType: 'StockAdjusted',
      payloadType: {} as StockAdjustedPayload,
    },
    StockMoved: {
      messageType: 'StockMoved',
      payloadType: {} as StockMovedPayload,
    },
    StockReserved: {
      messageType: 'StockReserved',
      payloadType: {} as StockReservedPayload,
    },
    StockReservationConfirmed: {
      messageType: 'StockReservationConfirmed',
      payloadType: {} as StockReservationConfirmedPayload,
    },
    StockReservationReleased: {
      messageType: 'StockReservationReleased',
      payloadType: {} as StockReservationReleasedPayload,
    },
    StockDamaged: {
      messageType: 'StockDamaged',
      payloadType: {} as StockDamagedPayload,
    },
    StockLost: {
      messageType: 'StockLost',
      payloadType: {} as StockLostPayload,
    },
    StockDisposed: {
      messageType: 'StockDisposed',
      payloadType: {} as StockDisposedPayload,
    },
    StockDefectMarked: {
      messageType: 'StockDefectMarked',
      payloadType: {} as StockDefectMarkedPayload,
    },
    StockReworked: {
      messageType: 'StockReworked',
      payloadType: {} as StockReworkedPayload,
    },
  },
};

// ===== Event Type Constants =====

export const InventoryEventTypes = {
  RECEIVED: 'StockReceived',
  SHIPPED: 'StockShipped',
  ADJUSTED: 'StockAdjusted',
  MOVED: 'StockMoved',
  RESERVED: 'StockReserved',
  RESERVATION_CONFIRMED: 'StockReservationConfirmed',
  RESERVATION_RELEASED: 'StockReservationReleased',
  DAMAGED: 'StockDamaged',
  LOST: 'StockLost',
  DISPOSED: 'StockDisposed',
  DEFECT_MARKED: 'StockDefectMarked',
  REWORKED: 'StockReworked',
} as const;
