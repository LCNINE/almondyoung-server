/**
 * Inventory Stream with Schema Validation Example
 *
 * Zod 스키마를 사용한 런타임 검증 예시
 */

import { StreamConfig, EventType } from '@app/events';
import { z } from 'zod';

// ===== Zod Schemas (런타임 검증용) =====

/**
 * StockReceived 이벤트 스키마
 */
export const StockReceivedSchema = z.object({
  stockEventId: z.string().uuid(),
  skuId: z.string().uuid(),
  skuCode: z.string().min(1),

  quantity: z.number().int().positive(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid(),

  inboundType: z.enum(['DOMESTIC', 'OVERSEAS', 'RETURN', 'GENERAL']),
  inboundId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),

  receivedAt: z.string().datetime(), // ISO 8601
  reason: z.string().optional(),
  note: z.string().optional(),
});

/**
 * StockAdjusted 이벤트 스키마
 */
export const StockAdjustedSchema = z.object({
  stockEventId: z.string().uuid(),
  skuId: z.string().uuid(),
  skuCode: z.string().min(1),

  deltaQuantity: z.number().int(), // 음수 가능
  beforeQuantity: z.number().int().nonnegative(),
  afterQuantity: z.number().int().nonnegative(),

  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().optional(),

  adjustmentType: z.enum(['MANUAL', 'INVENTORY_COUNT', 'SYSTEM']),
  reason: z.string().min(1),
  note: z.string().optional(),

  adjustedBy: z.string().min(1),
  adjustedAt: z.string().datetime(),
});

/**
 * StockReserved 이벤트 스키마
 */
export const StockReservedSchema = z.object({
  reservationId: z.string().uuid(),
  skuId: z.string().uuid(),
  skuCode: z.string().min(1),

  quantity: z.number().int().positive(),
  warehouseId: z.string().uuid(),

  reservedFor: z.enum(['ORDER', 'FULFILLMENT', 'MANUAL']),
  orderId: z.string().uuid().optional(),
  fulfillmentId: z.string().uuid().optional(),

  expiresAt: z.string().datetime().optional(),
  reservedAt: z.string().datetime(),
});

// ===== TypeScript Types (Zod에서 추출) =====

export type StockReceivedPayload = z.infer<typeof StockReceivedSchema>;
export type StockAdjustedPayload = z.infer<typeof StockAdjustedSchema>;
export type StockReservedPayload = z.infer<typeof StockReservedSchema>;

// ===== Event Types Map =====

export type InventoryEventsWithSchema = {
  // 스키마 검증이 있는 이벤트
  StockReceived: EventType<StockReceivedPayload>;
  StockAdjusted: EventType<StockAdjustedPayload>;
  StockReserved: EventType<StockReservedPayload>;

  // 스키마 검증이 없는 이벤트 (선택적)
  // StockShipped: EventType<StockShippedPayload>;
  // ...
};

// ===== Stream Config (스키마 포함) =====

export const INVENTORY_STREAM_WITH_SCHEMA: StreamConfig<InventoryEventsWithSchema> = {
  topic: {
    topic: 'inventory.events.v1',
    partitions: 24,
  },
  aggregateType: 'Stock',
  events: {
    StockReceived: {
      messageType: 'StockReceived',
      payloadType: {} as StockReceivedPayload,
      schema: StockReceivedSchema, // ✅ 스키마 추가!
    },
    StockAdjusted: {
      messageType: 'StockAdjusted',
      payloadType: {} as StockAdjustedPayload,
      schema: StockAdjustedSchema, // ✅ 스키마 추가!
    },
    StockReserved: {
      messageType: 'StockReserved',
      payloadType: {} as StockReservedPayload,
      schema: StockReservedSchema, // ✅ 스키마 추가!
    },
  },
};

// ===== 사용 예시 =====

/*
// Publisher (발행 시 자동 검증)
await stockPublisher.publishEvent({
  eventType: 'StockReceived',
  aggregateId: 'STK-123',
  payload: {
    stockEventId: '550e8400-e29b-41d4-a716-446655440000',
    skuId: '550e8400-e29b-41d4-a716-446655440001',
    skuCode: 'SKU-001',
    quantity: 100,
    warehouseId: '550e8400-e29b-41d4-a716-446655440002',
    locationId: '550e8400-e29b-41d4-a716-446655440003',
    inboundType: 'DOMESTIC',
    receivedAt: '2025-01-01T00:00:00Z',
  },
});
// ✅ 스키마 검증 통과 시 발행됨
// ❌ 스키마 검증 실패 시 SchemaValidationError 발생

// Consumer (수신 시 자동 검증)
@Controller()
export class InventoryEventsConsumer {
  @OnEvent('inventory.events.v1', 'StockReceived')
  async handleStockReceived(@EventPayload() payload: StockReceivedPayload) {
    // 이 시점에 payload는 이미 스키마 검증이 완료됨
    // ✅ 타입 안전성 보장
    console.log(payload.quantity); // number (확실함!)
  }
}
*/

