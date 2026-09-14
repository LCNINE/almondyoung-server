import { Injectable } from '@nestjs/common';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';
import { outstandingLineWhere, outstandingQtySql } from './purchase-order-outstanding.sql';

export interface ExpectedArrivalLineRow {
  skuId: string;
  skuName: string;
  skuCode: string;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  expectedArrival: string | null;
}

export interface ExpectedArrivalRow {
  poId: string;
  type: 'domestic' | 'foreign';
  supplier: { id: string; name: string } | null;
  warehouseId: string;
  expectedDate: string | null;
  totalOutstandingQuantity: number;
  lines: ExpectedArrivalLineRow[];
}

@Injectable()
export class PurchaseOrderExpectedArrivalReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async listByWarehouse(warehouseId: string, tx?: DbTx): Promise<ExpectedArrivalRow[]> {
    return this.dbService.run(async (trx) => {
      const pol = wmsTables.purchaseOrderLines;
      const po = wmsTables.purchaseOrders;
      const sku = wmsTables.skus;
      const supplier = wmsTables.suppliers;
      const rows = await trx
        .select({
          poId: po.id,
          type: po.type,
          supplierId: supplier.id,
          supplierName: supplier.name,
          skuId: pol.skuId,
          skuName: sku.name,
          skuCode: sku.code,
          orderedQty: pol.orderedQty,
          receivedQty: pol.receivedQty,
          outstandingQty: outstandingQtySql(),
          expectedArrival: pol.expectedArrival,
        })
        .from(pol)
        .innerJoin(po, eq(po.id, pol.poId))
        .innerJoin(sku, eq(sku.id, pol.skuId))
        .leftJoin(supplier, eq(supplier.id, po.supplierId))
        .where(and(eq(po.sourceWarehouseId, warehouseId), outstandingLineWhere()))
        .orderBy(po.id, pol.skuId);

      const grouped = new Map<string, ExpectedArrivalRow>();
      for (const row of rows) {
        let current = grouped.get(row.poId);
        if (!current) {
          current = {
            poId: row.poId,
            type: row.type,
            supplier:
              row.supplierId !== null && row.supplierName !== null
                ? { id: row.supplierId, name: row.supplierName }
                : null,
            warehouseId,
            expectedDate: null,
            totalOutstandingQuantity: 0,
            lines: [],
          };
          grouped.set(row.poId, current);
        }
        const outstandingQty = Number(row.outstandingQty);
        current.totalOutstandingQuantity += outstandingQty;
        current.lines.push({
          skuId: row.skuId,
          skuName: row.skuName,
          skuCode: row.skuCode,
          orderedQty: Number(row.orderedQty),
          receivedQty: row.receivedQty,
          outstandingQty,
          expectedArrival: row.expectedArrival,
        });
        if (row.expectedArrival && (!current.expectedDate || row.expectedArrival < current.expectedDate)) {
          current.expectedDate = row.expectedArrival;
        }
      }

      return [...grouped.values()].sort((left, right) => {
        if (left.expectedDate === right.expectedDate) return left.poId.localeCompare(right.poId);
        if (left.expectedDate === null) return 1;
        if (right.expectedDate === null) return -1;
        return left.expectedDate.localeCompare(right.expectedDate);
      });
    }, tx);
  }

  async sumOutstandingBySku(
    skuIds: string[],
    scope: 'non_sellable_source' | 'all',
    tx?: DbTx,
  ): Promise<Map<string, { qty: number; eta: Date | null }>> {
    if (skuIds.length === 0) return new Map();

    return this.dbService.run(async (trx) => {
      const pol = wmsTables.purchaseOrderLines;
      const po = wmsTables.purchaseOrders;
      const rows = await trx
        .select({
          skuId: pol.skuId,
          qty: sql<number>`SUM(${outstandingQtySql()})::int`,
          eta: sql<string | null>`MIN(${pol.expectedArrival})`,
        })
        .from(pol)
        .innerJoin(po, eq(po.id, pol.poId))
        .where(
          and(
            outstandingLineWhere(),
            inArray(pol.skuId, skuIds),
            scope === 'non_sellable_source' ? not(inSellableWarehouse(po.sourceWarehouseId)) : undefined,
          ),
        )
        .groupBy(pol.skuId);
      return new Map(rows.map((row) => [row.skuId, { qty: Number(row.qty), eta: row.eta ? new Date(row.eta) : null }]));
    }, tx);
  }
}
