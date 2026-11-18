import * as postgres from 'postgres';
import { randomUUID } from 'crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedHolder,
  seedSku,
} from '../../apps/core/src/modules/fulfillment/services/__support__';
import { applyConsignmentHolderPlan, readConsignmentHolderPlan } from './assign-consignment-holders';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand 'assign-consignment-holders\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const vendorName = () => `it-vendor-${randomUUID().slice(0, 8)}`;

async function holderOf(trx: DbTx, skuId: string) {
  const [row] = await trx
    .select({ name: wmsTables.holders.name, isOurAsset: wmsTables.holders.isOurAsset })
    .from(wmsTables.skus)
    .innerJoin(wmsTables.holders, eq(wmsTables.holders.id, wmsTables.skus.holderId))
    .where(eq(wmsTables.skus.id, skuId));

  return row;
}

async function consignmentHolder(trx: DbTx, name: string): Promise<string> {
  const [h] = await trx
    .insert(wmsTables.holders)
    .values({ name, isOurAsset: false })
    .returning({ id: wmsTables.holders.id });

  return h.id;
}

describeIfDb('assign-consignment-holders (DB integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('없는 위탁 화주를 만들고 SKU 를 옮긴다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const sku = await seedSku(trx, holderId);
      const vendor = vendorName();

      const plan = await readConsignmentHolderPlan(trx, [{ skuCode: sku.skuCode, vendor }]);

      expect(plan.holders.get(vendor)).toBeNull();
      expect(await applyConsignmentHolderPlan(trx, plan)).toBe(1);
      expect(await holderOf(trx, sku.skuId)).toEqual({ name: vendor, isOurAsset: false });
    });
  });

  it('두 번 돌려도 같고 화주를 또 만들지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const sku = await seedSku(trx, holderId);
      const rows = [{ skuCode: sku.skuCode, vendor: vendorName() }];

      await applyConsignmentHolderPlan(trx, await readConsignmentHolderPlan(trx, rows));
      const again = await readConsignmentHolderPlan(trx, rows);

      expect(again.move).toEqual([]);
      expect(again.alreadyOk).toBe(1);
      expect(again.holders.get(rows[0].vendor)).toEqual(expect.any(String));
    });
  });

  it('다른 위탁 화주에 있는 SKU 는 옮기지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const other = vendorName();
      const sku = await seedSku(trx, await consignmentHolder(trx, other));

      const plan = await readConsignmentHolderPlan(trx, [{ skuCode: sku.skuCode, vendor: vendorName() }]);

      expect(plan.move).toEqual([]);
      expect(plan.onOtherVendor).toEqual([expect.objectContaining({ skuCode: sku.skuCode, currentVendor: other })]);
    });
  });

  it('core 에 없는 SKU 는 따로 센다', async () => {
    await inRollbackTx(db, async (trx) => {
      const code = `NOPE-${randomUUID()}`;

      const plan = await readConsignmentHolderPlan(trx, [{ skuCode: code, vendor: vendorName() }]);

      expect(plan.notInCore).toEqual([code]);
    });
  });

  it('자사 화주와 이름이 같으면 멈춘다', async () => {
    await inRollbackTx(db, async (trx) => {
      const name = vendorName();
      await trx.insert(wmsTables.holders).values({ name, isOurAsset: true });

      await expect(readConsignmentHolderPlan(trx, [{ skuCode: 'X', vendor: name }])).rejects.toThrow('자사 화주');
    });
  });
});
