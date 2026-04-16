/**
 * Product Matching BC Schema
 *
 * 실제 테이블 정의는 inventory.schema.ts에 있으며 (FK 참조 관계 유지),
 * 이 파일은 Product Matching BC의 논리적 소속 테이블을 re-export합니다.
 */
export {
  productMatchings,
  productVariantSkuLinks,
  productSkuMappings,
  productSkuMappingItems,
  productSkuMappingSnapshots,
  matchingStatusEnum,
  matchingStrategyEnum,
  matchingPriorityEnum,
  productMatchingsRelations,
  productVariantSkuLinksRelations,
  productSkuMappingsRelations,
  productSkuMappingItemsRelations,
  productSkuMappingSnapshotsRelations,
} from '../../inventory/schema/inventory.schema';

import {
  productMatchings,
  productVariantSkuLinks,
  productSkuMappings,
  productSkuMappingItems,
  productSkuMappingSnapshots,
} from '../../inventory/schema/inventory.schema';

export const matchingSchema = {
  productMatchings,
  productVariantSkuLinks,
  productSkuMappings,
  productSkuMappingItems,
  productSkuMappingSnapshots,
};
