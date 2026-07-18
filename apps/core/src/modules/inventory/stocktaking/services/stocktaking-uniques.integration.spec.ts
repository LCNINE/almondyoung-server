import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking uniques (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
  });
  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  async function fixture(tx: DbTx) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
      .returning();
    const [location] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `IT-LOC-${randomUUID().slice(0, 8)}` })
      .returning();
    const [session] = await tx
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: warehouse.id, sessionName: 'it', status: 'in_progress' })
      .returning();
    return { warehouse, sku, location, session };
  }

  it('같은 (session, sku, location) 라인 2건은 unique 위반으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await tx
        .insert(wmsTables.stocktakingLines)
        .values({ sessionId: f.session.id, skuId: f.sku.id, locationId: f.location.id, expectedQuantity: 1 });
      await expect(
        tx
          .insert(wmsTables.stocktakingLines)
          .values({ sessionId: f.session.id, skuId: f.sku.id, locationId: f.location.id, expectedQuantity: 1 }),
      ).rejects.toThrow();
    });
  });

  it('같은 line_id 조정 2건은 unique 위반으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [line] = await tx
        .insert(wmsTables.stocktakingLines)
        .values({ sessionId: f.session.id, skuId: f.sku.id, locationId: f.location.id, expectedQuantity: 1 })
        .returning();
      await tx
        .insert(wmsTables.stocktakingAdjustments)
        .values({ sessionId: f.session.id, lineId: line.id, adjustmentQuantity: 1, adjustmentType: 'INCREASE' });
      await expect(
        tx
          .insert(wmsTables.stocktakingAdjustments)
          .values({ sessionId: f.session.id, lineId: line.id, adjustmentQuantity: 1, adjustmentType: 'INCREASE' }),
      ).rejects.toThrow();
    });
  });

  it('같은 위치를 두 번 scanLocation 해도 라인이 중복 생성되지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      // 해당 위치 ON_HAND 시드: ledger 직접 insert (store 아님 — 테스트 픽스처는 arch 예외)
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: f.sku.id,
        warehouseId: f.warehouse.id,
        locationId: f.location.id,
        stockState: 'ON_HAND',
        qty: 5,
      });
      const dbService = {
        db,
        run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
      } as unknown as DbService<typeof wmsSchema>;
      const { StocktakingService } = await import('./stocktaking.service');
      const svc = new StocktakingService(dbService);
      await svc.scanLocation({ sessionId: f.session.id, locationBarcode: f.location.code }, tx);
      await svc.scanLocation({ sessionId: f.session.id, locationBarcode: f.location.code }, tx);
      const lines = await tx
        .select()
        .from(wmsTables.stocktakingLines)
        .where(eq(wmsTables.stocktakingLines.sessionId, f.session.id));
      expect(lines).toHaveLength(1);
    });
  });
});
