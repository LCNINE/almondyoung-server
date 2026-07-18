import { BadRequestException } from '@nestjs/common';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StocktakingService } from './stocktaking.service';
import { InventoryCommandService } from '../../core/services/inventory-command.service';
import { LocationService } from '../../core/services/location.service';
import { StockEventStore } from '../../core/repositories/stock-event.store';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stocktaking complete (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let svc: StocktakingService;
  let command: InventoryCommandService;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
    const dbService = {
      db,
      run: async (fn: (t: DbTx) => Promise<unknown>, t?: DbTx) => (t ? fn(t) : db.transaction(fn)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const location = new LocationService(dbService);
    command = new InventoryCommandService(dbService, eventStore, outbox, location);
    svc = new StocktakingService(dbService, command);
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
  async function onHandAt(tx: DbTx, skuId: string, warehouseId: string, locationId: string) {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      )
      .limit(1);
    return row?.qty ?? 0;
  }
  // 시드: adjustUp(위치 미지정)→시스템 위치에 ON_HAND, 해결된 locationId 를 되읽어 반환
  async function seed(tx: DbTx, qty: number) {
    const [wh] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
      .returning();
    const [h] = await tx
      .insert(wmsTables.holders)
      .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: h.id })
      .returning();
    const { eventId } = await command.adjustUp(
      { skuId: sku.id, warehouseId: wh.id, quantity: qty, reason: 'SEED' },
      tx,
    );
    const [ev] = await tx
      .select({ loc: wmsTables.stockEvents.toLocationId })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.id, eventId));
    const locationId = ev.loc as string;
    const [session] = await tx
      .insert(wmsTables.stocktakingSessions)
      .values({ warehouseId: wh.id, sessionName: 'it', status: 'in_progress' })
      .returning();
    return { wh, sku, locationId, session };
  }
  async function addLine(
    tx: DbTx,
    s: { session: { id: string }; sku: { id: string }; locationId: string },
    expected: number,
    counted: number,
  ) {
    const [line] = await tx
      .insert(wmsTables.stocktakingLines)
      .values({
        sessionId: s.session.id,
        skuId: s.sku.id,
        locationId: s.locationId,
        expectedQuantity: expected,
        countedQuantity: counted,
        variance: counted - expected,
        status: 'counted',
      })
      .returning();
    return line;
  }

  it('완료 시 조정이 원장에 적용되고 조정행·라인상태·세션이 종결된다', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      const line = await addLine(tx, s, 10, 12); // +2
      const res = await svc.completeSession(s.session.id, tx);

      expect(await onHandAt(tx, s.sku.id, s.wh.id, s.locationId)).toBe(12);
      expect(res.summary.adjustmentsApplied).toBe(1);
      const [adj] = await tx
        .select()
        .from(wmsTables.stocktakingAdjustments)
        .where(eq(wmsTables.stocktakingAdjustments.lineId, line.id));
      expect(adj).toMatchObject({ adjustmentType: 'INCREASE', adjustmentQuantity: 2 });
      const [ev] = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.idempotencyKey, `stocktaking:${s.session.id}:${line.id}`));
      expect(ev).toMatchObject({ transitionType: 'ADJUST_UP', eventStatus: 'POSTED' });
      const [lineRow] = await tx
        .select()
        .from(wmsTables.stocktakingLines)
        .where(eq(wmsTables.stocktakingLines.id, line.id));
      expect(lineRow.status).toBe('adjusted');
      const [sess] = await tx
        .select()
        .from(wmsTables.stocktakingSessions)
        .where(eq(wmsTables.stocktakingSessions.id, s.session.id));
      expect(sess.status).toBe('completed');
    });
  });

  it('라이브 delta: 스캔~완료 사이 원장이 변해도 최종 ON_HAND 는 counted 와 같다', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      await addLine(tx, s, 10, 7); // 스냅샷 variance = -3
      await command.adjustDown(
        { skuId: s.sku.id, warehouseId: s.wh.id, locationId: s.locationId, quantity: 2, reason: 'MID' },
        tx,
      ); // 현재고 8
      await svc.completeSession(s.session.id, tx);
      // 스냅샷(-3)이면 5, 라이브(counted 7)면 7
      expect(await onHandAt(tx, s.sku.id, s.wh.id, s.locationId)).toBe(7);
    });
  });

  it('완료를 두 번 하면 두 번째는 400 으로 거부된다(멱등)', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 5);
      await addLine(tx, s, 5, 6);
      await svc.completeSession(s.session.id, tx);
      await expect(svc.completeSession(s.session.id, tx)).rejects.toThrow(BadRequestException);
    });
  });

  it('generateAdjustments 는 미리보기라 원장/조정을 영속하지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      const line = await addLine(tx, s, 10, 12);
      const preview = await svc.generateAdjustments(s.session.id, {}, tx);
      expect(preview.preview).toEqual([
        expect.objectContaining({
          lineId: line.id,
          delta: 2,
          adjustmentType: 'INCREASE',
          currentOnHand: 10,
          countedQuantity: 12,
        }),
      ]);
      expect(await onHandAt(tx, s.sku.id, s.wh.id, s.locationId)).toBe(10); // 불변
      const adj = await tx
        .select()
        .from(wmsTables.stocktakingAdjustments)
        .where(eq(wmsTables.stocktakingAdjustments.sessionId, s.session.id));
      expect(adj).toHaveLength(0);
    });
  });
});
