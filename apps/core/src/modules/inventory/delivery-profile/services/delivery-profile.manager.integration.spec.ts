import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { NotFoundError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../../fulfillment/services/__support__';
import { assertProfileComplete } from '../../../fulfillment/picking/plan/picking-plan.queries';
import { CreateDeliveryProfileDto } from '../dto/create-delivery-profile.dto';
import { DeliveryProfileReader } from './delivery-profile.reader';
import { DeliveryProfileManager } from './delivery-profile.manager';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'delivery-profile\.manager\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const input: CreateDeliveryProfileDto = {
  name: `it-부천-${Date.now()}`,
  sourceType: 'in_house',
  sender: { name: '엘씨나인', phone: '1877-7184' },
  originAddress: { postalCode: '14521', roadAddress: '부천시 평천로832번길 42', detailAddress: '4층' },
  returnAddress: { postalCode: '14521', roadAddress: '부천시 평천로832번길 42', detailAddress: '4층' },
  carrierAccountRef: 'HANJIN',
  supportedFulfillmentModes: ['in_house'],
};

describeIfDb('DeliveryProfileManager (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): { reader: DeliveryProfileReader; manager: DeliveryProfileManager } {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    const reader = new DeliveryProfileReader(dbService);
    return { reader, manager: new DeliveryProfileManager(dbService, reader) };
  }

  // 이 API 로 만든 프로필은 계획 확정·배치 편입의 완전성 검사를 통과해야 한다 — 그게 이 기능의 목적이다.
  it('생성 결과가 assertProfileComplete 를 통과한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const created = await build(trx).manager.create(input, trx);
      const [row] = await trx
        .select()
        .from(wmsTables.deliveryProfiles)
        .where(eq(wmsTables.deliveryProfiles.id, created.id));
      expect(() => assertProfileComplete(row)).not.toThrow();
      expect(row.senderSnapshot).toEqual({ name: '엘씨나인', phone: '1877-7184' });
    });
  });

  it('목록은 삭제되지 않은 연결 SKU 수를 센다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const created = await manager.create(input, trx);
      const { holderId } = await seedHolder(trx);
      const a = await seedSku(trx, holderId);
      const b = await seedSku(trx, holderId);
      await trx.update(wmsTables.skus).set({ deliveryProfileId: created.id }).where(eq(wmsTables.skus.id, a.skuId));
      await trx
        .update(wmsTables.skus)
        .set({ deliveryProfileId: created.id, isDeleted: true })
        .where(eq(wmsTables.skus.id, b.skuId));
      const listed = (await reader.findAll(trx)).find((p) => p.id === created.id);
      expect(listed?.skuCount).toBe(1);
    });
  });

  it('PATCH 는 보낸 필드만 바꾼다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { manager } = build(trx);
      const created = await manager.create(input, trx);
      const updated = await manager.update(created.id, { sender: { name: '3PL 센터', phone: '02-1111-2222' } }, trx);
      expect(updated.sender).toEqual({ name: '3PL 센터', phone: '02-1111-2222' });
      expect(updated.originAddress).toEqual(input.originAddress);
      expect(updated.carrierAccountRef).toBe('HANJIN');
    });
  });

  it('없는 id 조회·수정은 NotFoundError', async () => {
    await inRollbackTx(db, async (trx) => {
      const { reader, manager } = build(trx);
      const missing = '99999999-9999-4999-8999-999999999999';
      await expect(reader.findOne(missing, trx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(manager.update(missing, { name: 'x' }, trx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
