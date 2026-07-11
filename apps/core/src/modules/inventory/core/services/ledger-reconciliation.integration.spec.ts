import { eq, and } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { StockEventStore } from '../repositories/stock-event.store';
import { InventoryCommandService } from './inventory-command.service';
import { LocationService } from './location.service';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { LedgerReconciliationService } from './ledger-reconciliation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('ledger reconciliation (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let command: InventoryCommandService;
  let recon: LedgerReconciliationService;

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
    const metricsStub = {
      setLedgerDrift: () => undefined,
    } as unknown as import('../../shared/services/metrics.service').MetricsService;
    recon = new LedgerReconciliationService(dbService, metricsStub);
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

  // 시드: adjustUp 으로 이벤트+원장 정상 생성, 해결된 locationId 되읽어 반환
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
    return { wh, sku, locationId: ev.loc as string };
  }

  function grainWhere(s: { sku: { id: string }; wh: { id: string }; locationId: string }) {
    return and(
      eq(wmsTables.stockLedgers.skuId, s.sku.id),
      eq(wmsTables.stockLedgers.warehouseId, s.wh.id),
      eq(wmsTables.stockLedgers.locationId, s.locationId),
      eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
    );
  }

  it('정상 시드는 drift 0', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      const report = await recon.reconcile({ warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(0);
      expect(report.drifts).toEqual([]);
    });
  });

  it('원장을 우회 UPDATE 로 어긋내면 그 grain 을 정확한 delta 로 탐지 (MISMATCH)', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 10);
      // 스토어 우회: 원장 qty 를 10 → 13 으로 조작(이벤트 파생은 여전히 10)
      await tx.update(wmsTables.stockLedgers).set({ qty: 13 }).where(grainWhere(s));
      const report = await recon.reconcile({ warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(1);
      expect(report.drifts[0]).toMatchObject({
        skuId: s.sku.id,
        warehouseId: s.wh.id,
        locationId: s.locationId,
        derivedQty: 10,
        ledgerQty: 13,
        delta: 3,
        severity: 'MISMATCH',
      });
    });
  });

  it('원장 행이 삭제돼도 이벤트 파생값으로 drift 탐지 (ledgerQty=0)', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 8);
      await tx.delete(wmsTables.stockLedgers).where(grainWhere(s));
      const report = await recon.reconcile({ warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(1);
      expect(report.drifts[0]).toMatchObject({
        skuId: s.sku.id,
        derivedQty: 8,
        ledgerQty: 0,
        delta: -8,
        severity: 'MISMATCH',
      });
    });
  });

  it('warehouseId 필터가 다른 창고의 drift 를 제외한다', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seed(tx, 10);
      const b = await seed(tx, 10);
      await tx.update(wmsTables.stockLedgers).set({ qty: 99 }).where(grainWhere(b));
      const report = await recon.reconcile({ warehouseId: a.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(0); // b 의 drift 는 필터로 제외
    });
  });

  it('원장 행은 있는데 뒷받침 이벤트가 없으면 drift 탐지 (derivedQty=0, P0-2 우회 클래스)', async () => {
    await inRollbackTx(async (tx) => {
      const s = await seed(tx, 5);
      // 원장은 남긴 채 이벤트만 삭제 → 이벤트 파생 = 0, 원장 = 5
      await tx.delete(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, s.sku.id));
      const report = await recon.reconcile({ warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(1);
      expect(report.drifts[0]).toMatchObject({
        skuId: s.sku.id,
        derivedQty: 0,
        ledgerQty: 5,
        delta: 5,
        severity: 'MISMATCH',
      });
    });
  });

  it('skuId 필터가 다른 SKU 의 drift 를 제외한다', async () => {
    await inRollbackTx(async (tx) => {
      const a = await seed(tx, 10);
      const b = await seed(tx, 10);
      await tx.update(wmsTables.stockLedgers).set({ qty: 99 }).where(grainWhere(b));
      const report = await recon.reconcile({ skuId: a.sku.id }, tx);
      expect(report.totalDriftGrains).toBe(0); // b 의 drift 는 skuId 필터로 제외
    });
  });

  it('reconcileReservations 는 예약>ON_HAND grain 을 잡는다', async () => {
    await inRollbackTx(async (tx) => {
      // fixture: ON_HAND 4, confirmed 예약 10 → shortfall 6
      const s = await seed(tx, 4);
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'FULFILLMENT_ORDER',
        targetId: randomUUID(),
        skuId: s.sku.id,
        warehouseId: s.wh.id,
        quantity: 10,
        status: 'confirmed',
      });
      const report = await recon.reconcileReservations({ skuId: s.sku.id, warehouseId: s.wh.id }, tx);
      expect(report.totalDriftGrains).toBe(1);
      expect(report.drifts[0].shortfall).toBe(6);
    });
  });
});
