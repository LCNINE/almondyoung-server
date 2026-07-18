/**
 * Fulfillment BC Schema
 *
 * Fulfillment BC에 속하는 테이블 목록 (inventorySchema에 포함됨 — 단일 평면 스키마)
 *
 * 테이블:
 *   fulfillment_orders, fulfillment_order_items,
 *   fulfillment_order_creation_backlogs, fulfillment_command_requests,
 *   outbound_batches, outbound_batch_work_items,
 *   shipments, shipment_lines, waybills, dispatch_attempts, dispatch_attempt_sources,
 *   picking_plans, picking_plan_members, picking_source_allocations,
 *   outbox_events 외
 */
export { inventorySchema as fulfillmentSchema } from '../../inventory/schema/inventory.schema';
