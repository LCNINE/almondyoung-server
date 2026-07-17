import { Injectable } from '@nestjs/common';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { NotFoundError } from '@app/shared';
import { DbTx, inventorySchema, inventoryTables } from '../../inventory/schema/inventory.schema';
import { canonicalFulfillmentRequestHash } from '../services/fulfillment-command.service';
import { WAYBILL, WAYBILL_TERMINAL_STATUSES } from './waybill.constants';
import type { IssueContext, WaybillRow } from './waybill.types';

const W = inventoryTables.waybills;

@Injectable()
export class WaybillReader {
  constructor(@InjectTypedDb<typeof inventorySchema>() private readonly dbService: DbService<typeof inventorySchema>) {}

  recipientHashOf(recipientSnapshot: unknown): string {
    return canonicalFulfillmentRequestHash(recipientSnapshot);
  }

  async loadIssueContext(trx: DbTx, shipmentId: string): Promise<IssueContext> {
    const [shipment] = await trx
      .select()
      .from(inventoryTables.shipments)
      .where(eq(inventoryTables.shipments.id, shipmentId))
      .limit(1);
    if (!shipment) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId}`);
    const rows = await trx
      .select({
        skuId: inventoryTables.shipmentLines.skuId,
        skuName: inventoryTables.skus.name,
        productName: inventoryTables.salesOrderLines.productName,
        quantity: inventoryTables.shipmentLines.qty,
      })
      .from(inventoryTables.shipmentLines)
      .innerJoin(
        inventoryTables.fulfillmentOrderItems,
        eq(inventoryTables.fulfillmentOrderItems.id, inventoryTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        inventoryTables.fulfillmentOrders,
        eq(inventoryTables.fulfillmentOrders.id, inventoryTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .innerJoin(inventoryTables.skus, eq(inventoryTables.skus.id, inventoryTables.shipmentLines.skuId))
      .leftJoin(
        inventoryTables.salesOrders,
        eq(inventoryTables.salesOrders.id, inventoryTables.fulfillmentOrders.salesOrderId),
      )
      .leftJoin(
        inventoryTables.salesOrderLines,
        sql`${inventoryTables.salesOrderLines.id}::text = ${inventoryTables.fulfillmentOrderItems.salesOrderLineId}`,
      )
      .where(eq(inventoryTables.shipmentLines.shipmentId, shipmentId))
      .orderBy(asc(inventoryTables.shipmentLines.id));
    if (!rows.length) throw new NotFoundError(`${WAYBILL.ERROR.SHIPMENT_NOT_FOUND}: ${shipmentId} has no lines`);
    return {
      shipmentId: shipment.id,
      status: shipment.status,
      manifestVersion: shipment.manifestVersion,
      recipientSnapshot: shipment.recipientSnapshot,
      lines: rows.map((r) => ({ productName: r.productName ?? r.skuName ?? '', quantity: r.quantity, skuId: r.skuId })),
    };
  }

  async getActiveWaybill(trx: DbTx, shipmentId: string): Promise<WaybillRow | undefined> {
    const [wb] = await trx
      .select()
      .from(W)
      .where(and(eq(W.shipmentId, shipmentId), notInArray(W.status, [...WAYBILL_TERMINAL_STATUSES])))
      .limit(1);
    return wb;
  }
}
