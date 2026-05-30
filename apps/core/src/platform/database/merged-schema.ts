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

// Phase 3: Inventory (WMS 전체 스키마 포함 — Phase 4/5/6에서 BC별 분리 예정)
import { inventorySchema } from '../../modules/inventory/schema/inventory.schema';

// Library: 디지털 자산 + ownership
import { librarySchema } from '../../modules/library/schema/library.schema';

// Customer Service: 독립 CS Case
import { customerServiceSchema } from '../../modules/customer-service/schema/customer-service.schema';

// Phase 4: Product Matching — 테이블은 inventorySchema에 포함 (FK 참조로 분리 불가)

// Phase 5: Sales Order — 테이블은 inventorySchema에 포함
//   (product_matchings, product_sku_mapping_snapshots 등과의 FK 참조로 분리 불가)
//   sales_orders, sales_order_lines, order_events, merge_groups → inventorySchema 내 포함됨

// Phase 6: Fulfillment
// import { fulfillmentSchema } from '../../modules/fulfillment/schema/fulfillment.schema';

// Outbox (from @app/events)
// import { EventsModule } from '@app/events';

export const mergedSchema = {
  ...catalogSchema,
  ...inventorySchema,
  ...librarySchema,
  ...customerServiceSchema,
  // Phase 4: matchingSchema tables already in inventorySchema
  // Phase 5+: ...salesOrderSchema,
  // Phase 6+: ...fulfillmentSchema,
  // Phase 6+: ...EventsModule.outboxSchema,
};

export type MergedSchema = typeof mergedSchema;
