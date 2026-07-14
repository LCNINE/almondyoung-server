import { BadRequestException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingService } from './stocktaking.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking state machine (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    svc = new StocktakingService(dbService);
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
  async function session(tx: DbTx, status: 'draft' | 'in_progress' | 'completed' | 'cancelled') {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [s] = await tx
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: wh.id, sessionName: 'it', status })
      .returning();
    return { wh, s };
  }

  it('in_progress 세션을 cancel 하면 cancelled 로 전이한다', async () => {
    await inRollbackTx(async (tx) => {
      const { s } = await session(tx, 'in_progress');
      const r = await svc.cancelSession(s.id, tx);
      expect(r.status).toBe('cancelled');
      const [row] = await tx
        .select()
        .from(wmsTables.stocktakingSessions)
        .where(eq(wmsTables.stocktakingSessions.id, s.id));
      expect(row.status).toBe('cancelled');
    });
  });

  it('completed 세션 cancel 은 400 으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const { s } = await session(tx, 'completed');
      await expect(svc.cancelSession(s.id, tx)).rejects.toThrow(BadRequestException);
    });
  });

  it('in_progress 아닌 세션의 scanLocation 은 400 으로 거부된다', async () => {
    await inRollbackTx(async (tx) => {
      const { s } = await session(tx, 'draft');
      await expect(svc.scanLocation({ sessionId: s.id, locationBarcode: 'X' }, tx)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
