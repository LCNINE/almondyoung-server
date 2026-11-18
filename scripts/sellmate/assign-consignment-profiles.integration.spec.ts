import * as postgres from 'postgres';
import { randomUUID } from 'crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { makeDb, inRollbackTx, seedSku } from '../../apps/core/src/modules/fulfillment/services/__support__';
import { applyConsignmentProfilePlan, readConsignmentProfilePlan } from './assign-consignment-profiles';

/**
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx jest --runInBand 'assign-consignment-profiles\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function vendor(trx: DbTx): Promise<string> {
  const [h] = await trx
    .insert(wmsTables.holders)
    .values({ name: `it-vendor-${randomUUID().slice(0, 8)}`, isOurAsset: false })
    .returning({ id: wmsTables.holders.id });

  return h.id;
}

async function profile(trx: DbTx, holderId: string, modes: Array<'in_house' | '3pl'>): Promise<string> {
  const [p] = await trx
    .insert(wmsTables.deliveryProfiles)
    .values({ name: 'it-profile', sourceType: 'in_house', holderId, supportedFulfillmentModes: modes })
    .returning({ id: wmsTables.deliveryProfiles.id });

  return p.id;
}

async function profileOf(trx: DbTx, skuId: string) {
  const [row] = await trx
    .select({ id: wmsTables.skus.deliveryProfileId })
    .from(wmsTables.skus)
    .where(eq(wmsTables.skus.id, skuId));

  return row.id;
}

describeIfDb('assign-consignment-profiles (DB integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('업체 프로필이 하나면 그 업체 SKU 를 옮기고, 다시 돌리면 0 이다', async () => {
    await inRollbackTx(db, async (trx) => {
      const holderId = await vendor(trx);
      const profileId = await profile(trx, holderId, ['3pl']);
      const sku = await seedSku(trx, holderId);

      const plan = (await readConsignmentProfilePlan(trx)).filter((r) => r.holderId === holderId);

      expect(await applyConsignmentProfilePlan(trx, plan)).toBe(1);
      expect(await profileOf(trx, sku.skuId)).toBe(profileId);
      expect((await readConsignmentProfilePlan(trx)).find((r) => r.holderId === holderId)?.toMove).toBe(0);
    });
  });

  it('3pl 프로필이 없거나 둘이면 건드리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const none = await vendor(trx);
      await profile(trx, none, ['in_house']);
      const two = await vendor(trx);
      await profile(trx, two, ['3pl']);
      await profile(trx, two, ['3pl']);

      const plan = await readConsignmentProfilePlan(trx);

      expect(plan.find((r) => r.holderId === none)?.problem).toBe('프로필 없음');
      expect(plan.find((r) => r.holderId === two)?.problem).toBe('프로필 여러 개');
    });
  });
});
