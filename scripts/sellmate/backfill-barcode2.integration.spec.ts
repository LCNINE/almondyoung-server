import * as postgres from 'postgres';
import { randomUUID } from 'crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { asc, eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedHolder,
  seedSku,
} from '../../apps/core/src/modules/fulfillment/services/__support__';
import { applyBarcode2Backfill, readBarcode2Backfill } from './backfill-barcode2';
import type { ParsedItem } from './import-products';

/**
 * 셀메이트 바코드번호2 백필(#1356). 보조 바코드만 넣고 대표·다른 SKU 의 바코드는 건드리지 않는다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'backfill-barcode2\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const uniq = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

function item(itemCode: string, barcode: string, barcode2: string): ParsedItem {
  return {
    productCode: '',
    productSerial: '1',
    productName: 'it',
    itemCode,
    optionName: '',
    barcode,
    barcode2,
    rowNumber: 1,
    file: 'it.csv',
  };
}

async function newSku(trx: DbTx): Promise<{ skuId: string; skuCode: string }> {
  const { holderId } = await seedHolder(trx);

  return seedSku(trx, holderId);
}

async function addBarcode(trx: DbTx, skuId: string, barcode: string, isPrimary: boolean): Promise<void> {
  await trx.insert(wmsTables.skuBarcodes).values({ skuId, barcode, isPrimary });
}

async function barcodesOf(trx: DbTx, skuId: string) {
  return trx
    .select({
      barcode: wmsTables.skuBarcodes.barcode,
      isPrimary: wmsTables.skuBarcodes.isPrimary,
      packingUnit: wmsTables.skuBarcodes.packingUnit,
    })
    .from(wmsTables.skuBarcodes)
    .where(eq(wmsTables.skuBarcodes.skuId, skuId))
    .orderBy(asc(wmsTables.skuBarcodes.createdAt), asc(wmsTables.skuBarcodes.barcode));
}

describeIfDb('backfill-barcode2 (DB integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('없는 보조 값만 is_primary=false 로 넣는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const a = await newSku(trx);
      const [pa, sa] = [uniq('PA'), uniq('SA')];
      await addBarcode(trx, a.skuId, pa, true);

      const { plan } = await readBarcode2Backfill(trx, [item(a.skuCode, pa, sa)]);

      expect(await applyBarcode2Backfill(trx, plan)).toBe(1);
      expect(await barcodesOf(trx, a.skuId)).toEqual([
        { barcode: pa, isPrimary: true, packingUnit: null },
        { barcode: sa, isPrimary: false, packingUnit: null },
      ]);
    });
  });

  it('대표를 내리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const a = await newSku(trx);
      const [pa, sa] = [uniq('PA'), uniq('SA')];
      await addBarcode(trx, a.skuId, sa, true);

      const { plan } = await readBarcode2Backfill(trx, [item(a.skuCode, pa, sa)]);

      expect(plan.alreadyOk).toBe(1);
      expect(plan.insert).toEqual([]);
      expect(await applyBarcode2Backfill(trx, plan)).toBe(0);
      expect(await barcodesOf(trx, a.skuId)).toEqual([{ barcode: sa, isPrimary: true, packingUnit: null }]);
    });
  });

  it('다른 SKU 가 점유한 값은 넣지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const [a, b] = [await newSku(trx), await newSku(trx)];
      const sa = uniq('SA');
      await addBarcode(trx, b.skuId, sa, true);

      const { plan, stock } = await readBarcode2Backfill(trx, [item(a.skuCode, '', sa)]);

      expect(plan.conflicts).toEqual([{ skuId: a.skuId, barcode: sa, ownerSkuId: b.skuId }]);
      expect(stock.get(a.skuId) ?? 0).toBe(0);
      await applyBarcode2Backfill(trx, plan);
      expect(await barcodesOf(trx, a.skuId)).toEqual([]);
    });
  });

  it('core 에 없는 SKU 는 따로 센다', async () => {
    await inRollbackTx(db, async (trx) => {
      const code = uniq('NOPE');

      const { plan, notInCore } = await readBarcode2Backfill(trx, [item(code, 'P', uniq('S'))]);

      expect(notInCore).toEqual([code]);
      expect(plan).toEqual({ insert: [], alreadyOk: 0, conflicts: [] });
    });
  });

  it('core 에 아직 없는 품목의 대표도 먼저 차지한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const a = await newSku(trx);
      const [x, codeB] = [uniq('X'), uniq('NOPE')];

      const { plan } = await readBarcode2Backfill(trx, [item(a.skuCode, '', x), item(codeB, x, '')]);

      expect(plan.insert).toEqual([]);
      expect(plan.conflicts).toEqual([{ skuId: a.skuId, barcode: x, ownerSkuId: `(core 에 없음) ${codeB}` }]);
    });
  });

  it('두 번 돌려도 같다', async () => {
    await inRollbackTx(db, async (trx) => {
      const a = await newSku(trx);
      const items = [item(a.skuCode, uniq('PA'), uniq('SA'))];

      await applyBarcode2Backfill(trx, (await readBarcode2Backfill(trx, items)).plan);
      const again = await readBarcode2Backfill(trx, items);

      expect(again.plan.insert).toEqual([]);
      expect(again.plan.alreadyOk).toBe(1);
    });
  });
});
