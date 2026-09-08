import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedWarehouseWithZone } from '../../../fulfillment/services/__support__';
import { SuppliersService } from './suppliers.service';

/**
 * 공급사 하드 삭제 × 보충 규칙(#743 B). `replenishment_supplier_rules.supplier_id` 의 FK 는
 * **restrict** 라(스펙 §8.1), 세지 않고 지우면 postgres 23503 이 `ApplicationException` 을 거치지
 * 않고 그대로 500 이 된다. 스펙 §9.2 1단계가 활성 공급사 전부에 규칙을 채우라고 하므로 그 500 은
 * 예외가 아니라 평상시가 된다 — 409 로 바뀐 것을 여기서 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'suppliers/services/suppliers\.service\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SuppliersService.deleteSupplier × 보충 공급사 규칙 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): SuppliersService {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new SuppliersService(dbService);
  }

  async function seedSupplier(trx: DbTx): Promise<string> {
    const { warehouseId } = await seedWarehouseWithZone(trx);
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-sup-${randomUUID().slice(0, 8)}`, defaultWarehouseId: warehouseId })
      .returning({ id: wmsTables.suppliers.id });
    return supplier.id;
  }

  it('보충 규칙 행이 있으면 409 — 무엇을 먼저 지워야 하는지 메시지가 알린다', async () => {
    await inRollbackTx(db, async (trx) => {
      const supplierId = await seedSupplier(trx);
      await trx
        .insert(wmsTables.replenishmentSupplierRules)
        .values({ supplierId, leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 });

      const service = build(trx);
      const error = await service.deleteSupplier(supplierId, trx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ message: expect.stringContaining('재고 보충 규칙 화면') });

      // 판정이 막았으므로 공급사는 그대로 남아 있어야 한다 — 부분 삭제가 아니다.
      const rows = await trx
        .select({ id: wmsTables.suppliers.id })
        .from(wmsTables.suppliers)
        .where(eq(wmsTables.suppliers.id, supplierId));
      expect(rows).toHaveLength(1);
    });
  });

  it('규칙 행이 없으면 그대로 삭제된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const supplierId = await seedSupplier(trx);
      const service = build(trx);

      await expect(service.deleteSupplier(supplierId, trx)).resolves.toBeUndefined();

      const rows = await trx
        .select({ id: wmsTables.suppliers.id })
        .from(wmsTables.suppliers)
        .where(eq(wmsTables.suppliers.id, supplierId));
      expect(rows).toHaveLength(0);
    });
  });

  it('규칙을 먼저 지우면 같은 공급사가 삭제된다 — 409 는 영구 차단이 아니다', async () => {
    await inRollbackTx(db, async (trx) => {
      const supplierId = await seedSupplier(trx);
      const t = wmsTables.replenishmentSupplierRules;
      await trx.insert(t).values({ supplierId, leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 });

      const service = build(trx);
      await expect(service.deleteSupplier(supplierId, trx)).rejects.toBeInstanceOf(ConflictError);

      await trx.delete(t).where(eq(t.supplierId, supplierId));
      await expect(service.deleteSupplier(supplierId, trx)).resolves.toBeUndefined();
    });
  });
});
