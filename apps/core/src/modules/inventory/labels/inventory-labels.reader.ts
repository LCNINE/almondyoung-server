import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../schema/inventory.schema';

@Injectable()
export class InventoryLabelsReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 활성이고 시스템이 아닌 로케이션만, 코드 오름차순. */
  async locationsForLabels(
    input: { rackId: string } | { locationIds: string[] },
    tx?: DbTx,
  ): Promise<{ id: string; code: string }[]> {
    const { locations } = wmsTables;
    const scope = 'rackId' in input ? eq(locations.rackId, input.rackId) : inArray(locations.id, input.locationIds);
    return this.dbService.run(
      (trx) =>
        trx
          .select({ id: locations.id, code: locations.code })
          .from(locations)
          .where(and(scope, eq(locations.isActive, true), eq(locations.isSystem, false)))
          .orderBy(asc(locations.code)),
      tx,
    );
  }

  /** SKU 와 대표 바코드. 대표가 없으면 가장 이른 행, 행이 없으면 barcode null. */
  async skusForLabels(
    skuIds: string[],
    tx?: DbTx,
  ): Promise<{ id: string; code: string; name: string; barcode: string | null }[]> {
    if (skuIds.length === 0) return [];
    const { skus, skuBarcodes } = wmsTables;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({ id: skus.id, code: skus.code, name: skus.name })
        .from(skus)
        .where(inArray(skus.id, skuIds));
      const barcodeRows = await trx
        .select({ skuId: skuBarcodes.skuId, barcode: skuBarcodes.barcode })
        .from(skuBarcodes)
        .where(inArray(skuBarcodes.skuId, skuIds))
        .orderBy(desc(skuBarcodes.isPrimary), asc(skuBarcodes.createdAt));
      const first = new Map<string, string>();
      for (const b of barcodeRows) if (!first.has(b.skuId)) first.set(b.skuId, b.barcode);
      return rows.map((r) => ({ ...r, barcode: first.get(r.id) ?? null }));
    }, tx);
  }
}
