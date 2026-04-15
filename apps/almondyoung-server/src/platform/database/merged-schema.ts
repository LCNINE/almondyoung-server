/**
 * Merged Database Schema
 *
 * 모든 Bounded Context의 스키마를 하나로 병합한다.
 * 각 Phase에서 BC가 추가될 때마다 여기에 스키마를 병합한다.
 *
 * 규칙: BC는 자기 소속 테이블만 write. 다른 BC 테이블 write 금지.
 */

// Phase 2: Catalog
import { catalogSchema } from '../../modules/catalog/schema/catalog.schema';

// Phase 3: Inventory
// import { inventorySchema } from '../../modules/inventory/schema/inventory.schema';

// Phase 4: Product Matching
// import { matchingSchema } from '../../modules/product-matching/schema/matching.schema';

// Phase 5: Sales Order
// import { salesOrderSchema } from '../../modules/sales-order/schema/sales-order.schema';

// Phase 6: Fulfillment
// import { fulfillmentSchema } from '../../modules/fulfillment/schema/fulfillment.schema';

// Outbox (from @app/events)
// import { EventsModule } from '@app/events';

export const mergedSchema = {
  ...catalogSchema,
  // Phase 3+: ...inventorySchema,
  // Phase 4+: ...matchingSchema,
  // Phase 5+: ...salesOrderSchema,
  // Phase 6+: ...fulfillmentSchema,
  // Phase 6+: ...EventsModule.outboxSchema,
};

export type MergedSchema = typeof mergedSchema;
