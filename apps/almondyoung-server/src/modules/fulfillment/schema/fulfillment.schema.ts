/**
 * Fulfillment BC Schema
 *
 * Fulfillment BC에 속하는 테이블 목록 (inventorySchema에 포함됨 — 단일 평면 스키마)
 *
 * 테이블:
 *   fulfillment_orders, fulfillment_order_items,
 *   outbound_batches, outbound_batch_items,
 *   outbound_tasks, outbound_task_orders, outbound_task_items, outbound_task_lines,
 *   shipments, invoices,
 *   outbox_events
 */
export { inventorySchema as fulfillmentSchema } from '../../inventory/schema/inventory.schema';
