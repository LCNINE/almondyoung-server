import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { inSellableWarehouse } from '../../shared/availability/sellable-warehouses';

export interface SkuMasterRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  safetyStock: number;
  moq: number | null;
  packingUnit: number | null;
  supplier: { id: string; name: string } | null;
}

export interface LedgerAggregate {
  onHandTotal: number;
  inTransferTotal: number;
  onHandSellable: number;
  nonSellableOnHand: Array<{ warehouseId: string; locationId: string; qty: number }>;
}

export interface ReservationAggregate {
  reservedTotal: number;
  reservedSellable: number;
}

/**
 * 보충 제안의 재고 재료 (스펙 §7.1). 읽기 전용. 원장 쓰기 없음.
 * 판매/비판매 판정은 `inSellableWarehouse()` 한 곳만 쓴다.
 */
@Injectable()
export class ReplenishmentStockReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async listSkuMasters(tx: DbTx, skuIds?: string[]): Promise<SkuMasterRow[]> {
    return this.dbService.run(async (trx) => {
      const skus = wmsTables.skus;
      const conditions = [eq(skus.isDeleted, false)];
      if (skuIds) {
        if (skuIds.length === 0) return [];
        conditions.push(inArray(skus.id, skuIds));
      }
      const base = await trx
        .select({
          skuId: skus.id,
          skuCode: skus.code,
          skuName: skus.name,
          safetyStock: skus.safetyStock,
          moq: skus.moq,
        })
        .from(skus)
        .where(and(...conditions));
      if (base.length === 0) return [];
      const ids = base.map((row) => row.skuId);

      const packing = await this.readPrimaryPackingUnit(trx, ids);
      const suppliers = await this.resolveSuppliers(trx, ids);

      return base.map((row) => ({
        skuId: row.skuId,
        skuCode: row.skuCode,
        skuName: row.skuName,
        safetyStock: row.safetyStock,
        moq: row.moq ?? null,
        packingUnit: packing.get(row.skuId) ?? null,
        supplier: suppliers.get(row.skuId) ?? null,
      }));
    }, tx);
  }

  async readLedgerAggregates(tx: DbTx, skuIds: string[]): Promise<Map<string, LedgerAggregate>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const ledgers = wmsTables.stockLedgers;
      const rows = await trx
        .select({
          skuId: ledgers.skuId,
          warehouseId: ledgers.warehouseId,
          locationId: ledgers.locationId,
          stockState: ledgers.stockState,
          qty: sql<number>`SUM(${ledgers.qty})::int`,
          sellable: sql<boolean>`${inSellableWarehouse(ledgers.warehouseId)}`,
        })
        .from(ledgers)
        .where(and(inArray(ledgers.skuId, unique), inArray(ledgers.stockState, ['ON_HAND', 'IN_TRANSFER'])))
        .groupBy(ledgers.skuId, ledgers.warehouseId, ledgers.locationId, ledgers.stockState);

      const result = new Map<string, LedgerAggregate>();
      for (const row of rows) {
        const agg = result.get(row.skuId) ?? {
          onHandTotal: 0,
          inTransferTotal: 0,
          onHandSellable: 0,
          nonSellableOnHand: [],
        };
        const qty = Number(row.qty);
        if (row.stockState === 'IN_TRANSFER') {
          agg.inTransferTotal += qty;
        } else {
          agg.onHandTotal += qty;
          if (row.sellable) agg.onHandSellable += qty;
          else if (qty > 0)
            agg.nonSellableOnHand.push({ warehouseId: row.warehouseId, locationId: row.locationId, qty });
        }
        result.set(row.skuId, agg);
      }
      return result;
    }, tx);
  }

  async readConfirmedReservations(tx: DbTx, skuIds: string[]): Promise<Map<string, ReservationAggregate>> {
    const unique = [...new Set(skuIds)];
    if (unique.length === 0) return new Map();
    return this.dbService.run(async (trx) => {
      const reservations = wmsTables.stockReservations;
      const rows = await trx
        .select({
          skuId: reservations.skuId,
          sellable: sql<boolean>`${inSellableWarehouse(reservations.warehouseId)}`,
          qty: sql<number>`SUM(${reservations.quantity})::int`,
        })
        .from(reservations)
        .where(and(inArray(reservations.skuId, unique), eq(reservations.status, 'confirmed')))
        .groupBy(reservations.skuId, sql`${inSellableWarehouse(reservations.warehouseId)}`);

      const result = new Map<string, ReservationAggregate>();
      for (const row of rows) {
        const agg = result.get(row.skuId) ?? { reservedTotal: 0, reservedSellable: 0 };
        const qty = Number(row.qty);
        agg.reservedTotal += qty;
        if (row.sellable) agg.reservedSellable += qty;
        result.set(row.skuId, agg);
      }
      return result;
    }, tx);
  }

  /** C 단계 전제: 판매 창고 하나. 둘 이상이면 제안이 창고별 수요를 알 수 없으므로 거부한다(스펙 §7.2). */
  async findSingleSellableWarehouseId(tx: DbTx): Promise<string> {
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({ id: wmsTables.warehouses.id })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.isSellable, true));
      if (rows.length !== 1) {
        throw new ConflictError(`보충 제안은 판매 창고가 정확히 하나일 때만 계산한다 (현재 ${rows.length}개)`);
      }
      return rows[0].id;
    }, tx);
  }

  private async readPrimaryPackingUnit(trx: DbTx, skuIds: string[]): Promise<Map<string, number>> {
    const barcodes = wmsTables.skuBarcodes;
    const rows = await trx
      .select({ skuId: barcodes.skuId, packingUnit: barcodes.packingUnit })
      .from(barcodes)
      .where(and(inArray(barcodes.skuId, skuIds), eq(barcodes.isPrimary, true)));
    const result = new Map<string, number>();
    for (const row of rows) if (row.packingUnit !== null) result.set(row.skuId, row.packingUnit);
    return result;
  }

  /**
   * SKU 의 공급사 (스펙 §4.4): 가장 최근 `ordered` 발주 라인의 공급사 → 없으면 `sku_suppliers` 가
   * 정확히 하나일 때 그것 → 아니면 미정(null).
   */
  private async resolveSuppliers(trx: DbTx, skuIds: string[]): Promise<Map<string, { id: string; name: string }>> {
    const lines = wmsTables.purchaseOrderLines;
    const orders = wmsTables.purchaseOrders;
    const suppliers = wmsTables.suppliers;

    const ordered = await trx
      .select({
        skuId: lines.skuId,
        supplierId: suppliers.id,
        supplierName: suppliers.name,
        orderedAt: lines.orderedAt,
      })
      .from(lines)
      .innerJoin(orders, eq(orders.id, lines.poId))
      .innerJoin(suppliers, eq(suppliers.id, orders.supplierId))
      .where(and(inArray(lines.skuId, skuIds), eq(lines.status, 'ordered'), isNotNull(lines.orderedAt)))
      .orderBy(desc(lines.orderedAt));

    const result = new Map<string, { id: string; name: string }>();
    for (const row of ordered) {
      if (!result.has(row.skuId)) result.set(row.skuId, { id: row.supplierId, name: row.supplierName });
    }

    const unresolved = skuIds.filter((id) => !result.has(id));
    if (unresolved.length === 0) return result;

    const links = await trx
      .select({ skuId: wmsTables.skuSuppliers.skuId, supplierId: suppliers.id, supplierName: suppliers.name })
      .from(wmsTables.skuSuppliers)
      .innerJoin(suppliers, eq(suppliers.id, wmsTables.skuSuppliers.supplierId))
      .where(inArray(wmsTables.skuSuppliers.skuId, unresolved));

    const grouped = new Map<string, Array<{ id: string; name: string }>>();
    for (const row of links) {
      const list = grouped.get(row.skuId) ?? [];
      list.push({ id: row.supplierId, name: row.supplierName });
      grouped.set(row.skuId, list);
    }
    for (const [skuId, list] of grouped) {
      if (list.length === 1) result.set(skuId, list[0]);
    }
    return result;
  }
}
