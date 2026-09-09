import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedHolder,
  seedSku,
  seedWarehouseWithZone,
} from '../../../fulfillment/services/__support__';
import { ReplenishmentSettingsReader, SETTINGS_KEY } from './replenishment-settings.reader';
import { LeadTimeProfileRefresher } from './lead-time-profile.refresher';

/**
 * 스펙 §10 「lead-time-profile.refresher」: 발주 라인 → 첫 입고 · 지시서 선적 → 첫 수령 · n<2 면 std null.
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- lead-time-profile.refresher.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('LeadTimeProfileRefresher (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  const TODAY = '2026-09-08';

  async function ensureSettings(trx: DbTx) {
    await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
    await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY });
  }

  async function seedSupplier(trx: DbTx, defaultWarehouseId: string): Promise<string> {
    const [s] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${randomUUID().slice(0, 8)}`, defaultWarehouseId })
      .returning({ id: wmsTables.suppliers.id });
    return s.id;
  }

  /** ordered 발주 라인 + 연결 계획 아이템 + posted 입고들. 반환: 없음 (관측 하나) */
  async function seedOrderedAndReceived(
    trx: DbTx,
    input: {
      supplierId: string;
      skuId: string;
      warehouseId: string;
      locationId: string;
      orderedAt: string;
      receivedAts: string[];
    },
  ) {
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: input.supplierId,
        status: 'confirmed',
        sourceWarehouseId: input.warehouseId,
        destinationWarehouseId: input.warehouseId,
      })
      .returning({ id: wmsTables.purchaseOrders.id });
    await trx.insert(wmsTables.purchaseOrderLines).values({
      poId: po.id,
      skuId: input.skuId,
      quantity: 10,
      status: 'ordered',
      orderedQty: 10,
      orderedAt: new Date(input.orderedAt),
    });
    const [plan] = await trx
      .insert(wmsTables.inboundPlans)
      .values({
        planType: 'destination',
        status: 'pending',
        warehouseId: input.warehouseId,
        destinationWarehouseId: input.warehouseId,
        linkedPurchaseOrderId: po.id,
      })
      .returning({ id: wmsTables.inboundPlans.id });
    const [item] = await trx
      .insert(wmsTables.inboundPlanItems)
      .values({ planId: plan.id, skuId: input.skuId, expectedQty: 10, receivedQty: 0, status: 'pending' })
      .returning({ id: wmsTables.inboundPlanItems.id });
    for (const at of input.receivedAts) {
      const [receipt] = await trx
        .insert(wmsTables.inboundReceipts)
        .values({
          method: 'planned',
          warehouseId: input.warehouseId,
          locationId: input.locationId,
          occurredAt: new Date(at),
          totalQuantity: 5,
        })
        .returning({ id: wmsTables.inboundReceipts.id });
      await trx
        .insert(wmsTables.inboundReceiptLines)
        .values({ receiptId: receipt.id, skuId: input.skuId, quantity: 5, planItemId: item.id });
    }
  }

  async function seedShippedAndReceived(
    trx: DbTx,
    input: { fromWarehouseId: string; toWarehouseId: string; shippedAt: string; receivedAts: string[] },
  ) {
    const [order] = await trx
      .insert(wmsTables.transferOrders)
      .values({
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        status: 'partially_received',
        shippedAt: new Date(input.shippedAt),
      })
      .returning({ id: wmsTables.transferOrders.id });
    for (const at of input.receivedAts) {
      await trx.insert(wmsTables.transferOrderReceipts).values({ transferOrderId: order.id, receivedAt: new Date(at) });
    }
  }

  function build(trx: DbTx) {
    return new LeadTimeProfileRefresher(boundDbService(trx));
  }

  // 잡이 run() 초입에서 한 번 읽어 세 단계에 넘기는 그 값을, 스펙에서도 같은 Reader 로 읽어 넘긴다.
  function readSettings(trx: DbTx) {
    return new ReplenishmentSettingsReader(boundDbService(trx)).read(trx);
  }

  it('L1: 발주 라인 → 첫 입고. 관측 2건이면 평균 · 표본 표준편차, 1건이면 std null, 창 밖은 제외', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { warehouseId, locationId } = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const twoObs = await seedSupplier(trx, warehouseId);
      const oneObs = await seedSupplier(trx, warehouseId);
      const stale = await seedSupplier(trx, warehouseId);

      // 10일 (두 번째 입고 8/20 은 첫 입고가 아니라 무시)
      await seedOrderedAndReceived(trx, {
        supplierId: twoObs,
        skuId,
        warehouseId,
        locationId,
        orderedAt: '2026-08-01T00:00:00Z',
        receivedAts: ['2026-08-11T00:00:00Z', '2026-08-20T00:00:00Z'],
      });
      // 20일
      await seedOrderedAndReceived(trx, {
        supplierId: twoObs,
        skuId,
        warehouseId,
        locationId,
        orderedAt: '2026-08-05T00:00:00Z',
        receivedAts: ['2026-08-25T00:00:00Z'],
      });
      // 1건
      await seedOrderedAndReceived(trx, {
        supplierId: oneObs,
        skuId,
        warehouseId,
        locationId,
        orderedAt: '2026-08-01T00:00:00Z',
        receivedAts: ['2026-08-13T12:00:00Z'],
      });
      // 창(365일) 밖
      await seedOrderedAndReceived(trx, {
        supplierId: stale,
        skuId,
        warehouseId,
        locationId,
        orderedAt: '2025-01-01T00:00:00Z',
        receivedAts: ['2025-01-10T00:00:00Z'],
      });

      const result = await build(trx).refreshAll({ today: TODAY, settings: await readSettings(trx) }, trx);
      expect(result.windowFrom).toBe('2025-09-08');
      expect(result.windowTo).toBe(TODAY);
      expect(result.suppliers).toBeGreaterThanOrEqual(2);

      const rows = await trx.select().from(wmsTables.supplierLeadTimeProfiles);
      const two = rows.find((r) => r.supplierId === twoObs);
      const one = rows.find((r) => r.supplierId === oneObs);
      expect(two).toMatchObject({ observations: 2, meanDays: 15, windowFrom: '2025-09-08', windowTo: TODAY });
      expect(two?.stdDays).toBeCloseTo(Math.SQRT2 * 5, 6); // std([10, 20]) = 7.0711
      expect(one).toMatchObject({ observations: 1, meanDays: 12.5, stdDays: null });
      expect(rows.find((r) => r.supplierId === stale)).toBeUndefined();
    });
  });

  it('L2: 지시서 선적 → 첫 수령, (from, to) 쌍별', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const a = await seedWarehouseWithZone(trx);
      const b = await seedWarehouseWithZone(trx);
      // 7일 (8/15 수령은 첫 수령이 아님) · 9일
      await seedShippedAndReceived(trx, {
        fromWarehouseId: a.warehouseId,
        toWarehouseId: b.warehouseId,
        shippedAt: '2026-08-01T00:00:00Z',
        receivedAts: ['2026-08-08T00:00:00Z', '2026-08-15T00:00:00Z'],
      });
      await seedShippedAndReceived(trx, {
        fromWarehouseId: a.warehouseId,
        toWarehouseId: b.warehouseId,
        shippedAt: '2026-08-10T00:00:00Z',
        receivedAts: ['2026-08-19T00:00:00Z'],
      });
      // 반대 방향 1건
      await seedShippedAndReceived(trx, {
        fromWarehouseId: b.warehouseId,
        toWarehouseId: a.warehouseId,
        shippedAt: '2026-08-10T00:00:00Z',
        receivedAts: ['2026-08-13T00:00:00Z'],
      });

      await build(trx).refreshAll({ today: TODAY, settings: await readSettings(trx) }, trx);
      const rows = await trx
        .select()
        .from(wmsTables.routeLeadTimeProfiles)
        .where(
          and(
            eq(wmsTables.routeLeadTimeProfiles.fromWarehouseId, a.warehouseId),
            eq(wmsTables.routeLeadTimeProfiles.toWarehouseId, b.warehouseId),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ observations: 2, meanDays: 8 });
      expect(rows[0].stdDays).toBeCloseTo(Math.SQRT2, 6);
      const reverse = await trx
        .select()
        .from(wmsTables.routeLeadTimeProfiles)
        .where(
          and(
            eq(wmsTables.routeLeadTimeProfiles.fromWarehouseId, b.warehouseId),
            eq(wmsTables.routeLeadTimeProfiles.toWarehouseId, a.warehouseId),
          ),
        );
      expect(reverse[0]).toMatchObject({ observations: 1, meanDays: 3, stdDays: null });
    });
  });

  it('두 번 돌리면 이전 행이 남지 않는다(통째로 다시 만든다)', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { warehouseId, locationId } = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const supplierId = await seedSupplier(trx, warehouseId);
      await seedOrderedAndReceived(trx, {
        supplierId,
        skuId,
        warehouseId,
        locationId,
        orderedAt: '2026-08-01T00:00:00Z',
        receivedAts: ['2026-08-11T00:00:00Z'],
      });
      const refresher = build(trx);
      await refresher.refreshAll({ today: TODAY, settings: await readSettings(trx) }, trx);
      await refresher.refreshAll({ today: TODAY, settings: await readSettings(trx) }, trx);
      const rows = await trx
        .select()
        .from(wmsTables.supplierLeadTimeProfiles)
        .where(eq(wmsTables.supplierLeadTimeProfiles.supplierId, supplierId));
      expect(rows).toHaveLength(1);
    });
  });
});
