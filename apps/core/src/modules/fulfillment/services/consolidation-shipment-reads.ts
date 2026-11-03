import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ConsolidationOptionShipmentDto, ConsolidationRecipientSnapshotDto } from '../dto/consolidation.dto';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';

export type ReadDb = DbTx | DbService<typeof wmsSchema>['db'];

export type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
export interface OptionLine {
  shipmentId: string;
  qty: number;
  salesOrderId: string | null;
  fulfillmentMode: string | null;
  skuStockType: string;
  skuName: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  displayOrderNo: string | null;
  channelOrderId: string | null;
  salesChannel: string | null;
  salesOrderCreatedAt: Date | null;
}

export interface ShipmentProgress {
  batchByShipment: Map<string, string>;
  trackingByShipment: Map<string, string>;
}

export const OPTION_STATUSES: ShipmentRow['status'][] = ['draft', 'planned'];
const CLOSED_WORK_ITEM_STATUSES = ['excluded', 'completed'] as const;

export function asRecipient(value: unknown): ConsolidationRecipientSnapshotDto {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

export function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export async function loadShipmentLines(trx: ReadDb, shipmentIds: string[]): Promise<OptionLine[]> {
  if (shipmentIds.length === 0) return [];

  return trx
    .select({
      shipmentId: wmsTables.shipmentLines.shipmentId,
      qty: wmsTables.shipmentLines.qty,
      salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
      fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
      skuStockType: wmsTables.skus.stockType,
      skuName: wmsTables.skus.name,
      customerId: wmsTables.salesOrders.customerId,
      customerName: wmsTables.salesOrders.customerName,
      customerPhone: wmsTables.salesOrders.customerPhone,
      displayOrderNo: wmsTables.salesOrders.displayOrderNo,
      channelOrderId: wmsTables.salesOrders.channelOrderId,
      salesChannel: wmsTables.salesOrders.salesChannel,
      salesOrderCreatedAt: wmsTables.salesOrders.orderDate,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
    .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
    .orderBy(asc(wmsTables.shipmentLines.createdAt), asc(wmsTables.shipmentLines.id));
}

export async function loadShipmentProgress(trx: ReadDb, shipmentIds: string[]): Promise<ShipmentProgress> {
  const [workItems, waybills] = await Promise.all([
    trx
      .select({
        shipmentId: wmsTables.outboundBatchWorkItems.shipmentId,
        batchId: wmsTables.outboundBatchWorkItems.batchId,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
          notInArray(wmsTables.outboundBatchWorkItems.status, [...CLOSED_WORK_ITEM_STATUSES]),
        ),
      ),
    trx
      .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
      .from(wmsTables.waybills)
      .where(
        and(
          inArray(wmsTables.waybills.shipmentId, shipmentIds),
          notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
        ),
      )
      .orderBy(desc(wmsTables.waybills.createdAt)),
  ]);
  const batchByShipment = new Map<string, string>();

  for (const row of workItems) {
    batchByShipment.set(row.shipmentId, row.batchId);
  }

  const trackingByShipment = new Map<string, string>();

  for (const row of waybills) {
    if (row.trackingNo && !trackingByShipment.has(row.shipmentId)) {
      trackingByShipment.set(row.shipmentId, row.trackingNo);
    }
  }

  return { batchByShipment, trackingByShipment };
}

export type ShipmentSummaryWithoutRecipient = Omit<ConsolidationOptionShipmentDto, 'recipientSnapshot'>;

export function summarizeShipmentWithoutRecipient(
  shipment: ShipmentRow,
  lines: readonly OptionLine[],
  progress: ShipmentProgress,
): ShipmentSummaryWithoutRecipient {
  const names = lines.map((line) => line.skuName);

  return {
    shipmentId: shipment.id,
    status: shipment.status,
    salesOrderNos: uniqueInOrder(
      lines.flatMap((line) => {
        const orderNo = line.displayOrderNo ?? line.channelOrderId;

        return orderNo ? [orderNo] : [];
      }),
    ),
    itemSummary: names.length > 1 ? `${names[0]} 외 ${names.length - 1}건` : (names[0] ?? ''),
    totalQty: lines.reduce((total, line) => total + line.qty, 0),
    batchId: progress.batchByShipment.get(shipment.id) ?? null,
    waybillTrackingNo: progress.trackingByShipment.get(shipment.id) ?? null,
    manifestVersion: shipment.manifestVersion,
    reservationVersion: shipment.reservationVersion,
    createdAt: shipment.createdAt,
  };
}

export function summarizeShipment(
  shipment: ShipmentRow,
  lines: readonly OptionLine[],
  progress: ShipmentProgress,
): ConsolidationOptionShipmentDto {
  return {
    ...summarizeShipmentWithoutRecipient(shipment, lines, progress),
    recipientSnapshot: asRecipient(shipment.recipientSnapshot),
  };
}
