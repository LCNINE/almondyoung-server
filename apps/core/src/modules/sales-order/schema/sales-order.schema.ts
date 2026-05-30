/**
 * Sales Order Schema
 *
 * SO 테이블은 inventorySchema에 이미 포함되어 있음
 * (product_matchings, product_sku_mapping_snapshots 등과의 FK 참조로 분리 불가)
 *
 * 이 파일은 Sales Order BC의 소유 테이블을 명시하는 re-export 선언이다.
 */
export {
  salesOrders,
  salesOrderLines,
  orderEvents,
  mergeGroups,
  salesOrderAmendments,
  orderStatusEnum,
  orderItemStatusEnum,
  salesChannelEnum,
  eventTypeOrderEnum,
  type SalesOrder,
  type NewSalesOrder,
  type SalesOrderLine,
  type NewSalesOrderLine,
  type OrderEvent,
  type NewOrderEvent,
  type SalesOrderAmendment,
  type NewSalesOrderAmendment,
  type MergeGroup,
  type NewMergeGroup,
} from '../../inventory/schema/inventory.schema';
