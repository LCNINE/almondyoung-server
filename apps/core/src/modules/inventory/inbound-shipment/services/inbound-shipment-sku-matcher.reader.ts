import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { inArray } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';

export type SkuMatch =
  | { kind: 'one'; skuId: string }
  | { kind: 'none' }
  | { kind: 'many'; skuIds: string[] }
  | { kind: 'packing_unit'; skuId: string };

const FORMULA_WRAPPED = /^="(.*)"$/;
const CHUNK = 5_000;

/**
 * 입고리스트 바코드 → SKU. 규칙이 출고 쪽 `sku-barcode-resolution` 과 다르다 —
 * `sku_barcodes`(엑셀 `="…"` 꼴 포함)와 `skus.code` 를 모아 «서로 다른 SKU 수» 로 판정한다.
 */
@Injectable()
export class InboundShipmentSkuMatcherReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async match(barcodes: string[], tx?: DbTx): Promise<Map<string, SkuMatch>> {
    const unique = [...new Set(barcodes)];
    const result = new Map<string, SkuMatch>();
    if (unique.length === 0) return result;

    return this.dbService.run(async (trx: DbTx) => {
      // 값마다 «맞은 SKU → 상자 바코드 여부»
      const hits = new Map<string, Map<string, boolean>>();
      const add = (value: string, skuId: string, boxed: boolean) => {
        const bySku = hits.get(value) ?? new Map<string, boolean>();
        bySku.set(skuId, (bySku.get(skuId) ?? false) || boxed);
        hits.set(value, bySku);
      };
      const known = new Set(unique);

      for (let i = 0; i < unique.length; i += CHUNK) {
        const part = unique.slice(i, i + CHUNK);
        const variants = part.flatMap((v) => [v, `="${v}"`]);
        const barcodeRows = await trx
          .select({
            skuId: wmsTables.skuBarcodes.skuId,
            barcode: wmsTables.skuBarcodes.barcode,
            packingUnit: wmsTables.skuBarcodes.packingUnit,
          })
          .from(wmsTables.skuBarcodes)
          .where(inArray(wmsTables.skuBarcodes.barcode, variants));
        for (const r of barcodeRows) {
          const unwrapped = FORMULA_WRAPPED.exec(r.barcode)?.[1];
          const value = known.has(r.barcode) ? r.barcode : unwrapped;
          if (value !== undefined && known.has(value)) add(value, r.skuId, (r.packingUnit ?? 1) > 1);
        }
        const codeRows = await trx
          .select({ id: wmsTables.skus.id, code: wmsTables.skus.code })
          .from(wmsTables.skus)
          .where(inArray(wmsTables.skus.code, part));
        for (const r of codeRows) add(r.code, r.id, false);
      }

      for (const value of unique) {
        const bySku = hits.get(value);
        if (!bySku || bySku.size === 0) {
          result.set(value, { kind: 'none' });
        } else if (bySku.size > 1) {
          result.set(value, { kind: 'many', skuIds: [...bySku.keys()] });
        } else {
          const [[skuId, boxed]] = [...bySku.entries()];
          result.set(value, boxed ? { kind: 'packing_unit', skuId } : { kind: 'one', skuId });
        }
      }
      return result;
    }, tx);
  }
}
