import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { asc, eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../../fulfillment/services/__support__';
import { DemandSeriesWriter } from './demand-series.writer';

/**
 * 스펙 §10 「demand-series.writer」: 취소 제외 · 디지털 제외 · 링크 수량 환산 · 창 재계산 멱등 · D0 경계.
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-series.writer.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('DemandSeriesWriter (DB integration)', () => {
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

  /** variant 하나를 SKU 들에 매칭 (링크 수량 포함) */
  async function seedMatching(trx: DbTx, links: Array<{ skuId: string; quantity: number }>): Promise<string> {
    const variantId = randomUUID();
    const [matching] = await trx
      .insert(wmsTables.productMatchings)
      .values({ variantId, status: 'matched', strategy: 'variant', isResolved: true })
      .returning({ id: wmsTables.productMatchings.id });
    await trx
      .insert(wmsTables.productVariantSkuLinks)
      .values(links.map((l) => ({ productMatchingId: matching.id, skuId: l.skuId, quantity: l.quantity })));
    return variantId;
  }

  async function seedOrder(
    trx: DbTx,
    input: {
      orderedAtUtc: string;
      status?: 'pending' | 'confirmed' | 'cancelled' | 'timeout';
      lines: Array<{
        variantId: string;
        quantity: number;
        totalPrice: number | null;
        status?: 'pending' | 'matched' | 'cancelled';
        fulfillmentKind?: 'physical' | 'digital';
        requiresShipping?: boolean;
      }>;
    },
  ): Promise<string> {
    const [order] = await trx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `IT-${randomUUID().slice(0, 12)}`,
        salesChannel: 'medusa',
        status: input.status ?? 'confirmed',
        shippingAddress: {},
        orderDate: new Date(input.orderedAtUtc),
      })
      .returning({ id: wmsTables.salesOrders.id });
    await trx.insert(wmsTables.salesOrderLines).values(
      input.lines.map((l) => ({
        salesOrderId: order.id,
        variantId: l.variantId,
        productName: 'IT Product',
        quantity: l.quantity,
        totalPrice: l.totalPrice,
        status: l.status ?? 'pending',
        fulfillmentKind: l.fulfillmentKind ?? null,
        requiresShipping: l.requiresShipping ?? null,
      })),
    );
    return order.id;
  }

  async function readSeries(trx: DbTx, skuIds: string[]) {
    return trx
      .select({
        skuId: wmsTables.skuDemandDaily.skuId,
        demandDate: wmsTables.skuDemandDaily.demandDate,
        qty: wmsTables.skuDemandDaily.qty,
        amount: wmsTables.skuDemandDaily.amount,
        source: wmsTables.skuDemandDaily.source,
      })
      .from(wmsTables.skuDemandDaily)
      .where(inArray(wmsTables.skuDemandDaily.skuId, skuIds))
      .orderBy(asc(wmsTables.skuDemandDaily.skuId), asc(wmsTables.skuDemandDaily.demandDate));
  }

  const WINDOW = { from: '2026-08-25', to: '2026-09-08', coreSince: null };

  it('링크 수량을 곱하고 KST 달력일로 묶는다 — 9/1 12:00 KST 주문 qty 2 × 링크 3 = 6', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 3 }]);
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 2, totalPrice: 12000 }],
      });

      const writer = new DemandSeriesWriter(boundDbService(trx));
      const result = await writer.rebuildCoreWindow(WINDOW, trx);
      // rows 는 창 전체(모든 SKU)의 재구축 건수다 — 공유 dev DB 에 이미 이 창 안 실제 주문이 쌓여
      // 있어 절대값을 못 박을 수 없다(1건 이상만 확인). from/to 와 우리 SKU 행은 정확히 확인한다.
      expect(result.from).toBe('2026-08-25');
      expect(result.to).toBe('2026-09-08');
      expect(result.rows).toBeGreaterThanOrEqual(1);
      expect(await readSeries(trx, [skuId])).toEqual([
        { skuId, demandDate: '2026-09-01', qty: 6, amount: 12000, source: 'core' },
      ]);
    });
  });

  it('UTC 15:30 주문은 KST 다음 날이다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T15:30:00Z',
        lines: [{ variantId, quantity: 1, totalPrice: 1000 }],
      });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-09-02']);
    });
  });

  it('취소 주문 · timeout 주문 · 취소 라인 · 디지털 라인은 빠지고 pending 주문은 들어간다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        status: 'cancelled',
        lines: [{ variantId, quantity: 100, totalPrice: 1 }],
      });
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        status: 'timeout',
        lines: [{ variantId, quantity: 100, totalPrice: 1 }],
      });
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 100, totalPrice: 1, status: 'cancelled' }],
      });
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 100, totalPrice: 1, fulfillmentKind: 'digital' }],
      });
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 100, totalPrice: 1, requiresShipping: false }],
      });
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        status: 'pending',
        lines: [{ variantId, quantity: 4, totalPrice: 4000 }],
      });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect(await readSeries(trx, [skuId])).toEqual([
        { skuId, demandDate: '2026-09-01', qty: 4, amount: 4000, source: 'core' },
      ]);
    });
  });

  it('세트 구성은 금액을 링크 수량 비례로 배분한다 — 4000원, 링크 1:3', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const a = await seedSku(trx, holderId);
      const b = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [
        { skuId: a.skuId, quantity: 1 },
        { skuId: b.skuId, quantity: 3 },
      ]);
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 1, totalPrice: 4000 }],
      });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      const rows = await readSeries(trx, [a.skuId, b.skuId]);
      expect(rows.find((r) => r.skuId === a.skuId)).toMatchObject({ qty: 1, amount: 1000 });
      expect(rows.find((r) => r.skuId === b.skuId)).toMatchObject({ qty: 3, amount: 3000 });
    });
  });

  it('금액이 전부 null 이면 amount 는 null, 하나라도 있으면 있는 것의 합', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 1, totalPrice: null }],
      });
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-02T03:00:00Z',
        lines: [
          { variantId, quantity: 1, totalPrice: null },
          { variantId, quantity: 1, totalPrice: 700 },
        ],
      });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect(await readSeries(trx, [skuId])).toEqual([
        { skuId, demandDate: '2026-09-01', qty: 1, amount: null, source: 'core' },
        { skuId, demandDate: '2026-09-02', qty: 2, amount: 700, source: 'core' },
      ]);
    });
  });

  it('창 재계산은 멱등이고 늦은 취소를 걷어낸다 — 창 밖 행과 sellmate 행은 건드리지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await trx.insert(wmsTables.skuDemandDaily).values([
        { skuId, demandDate: '2026-08-01', qty: 7, amount: null, source: 'core' }, // 창 밖
        { skuId, demandDate: '2026-08-26', qty: 9, amount: null, source: 'sellmate' }, // 창 안이지만 sellmate
      ]);
      const orderId = await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 2, totalPrice: 2000 }],
      });
      const writer = new DemandSeriesWriter(boundDbService(trx));

      const first = await writer.rebuildCoreWindow(WINDOW, trx);
      const again = await writer.rebuildCoreWindow(WINDOW, trx);
      // rows 는 창 전체(모든 SKU)의 재구축 건수라 공유 dev DB 의 기존 주문만큼 절대값이 크다.
      // 멱등성은 "다시 돌려도 같은 총 건수"로, 취소 반영은 "우리 SKU 행 하나만 줄어듦"으로 판정한다.
      expect(again.rows).toBe(first.rows);
      expect((await readSeries(trx, [skuId])).map((r) => `${r.demandDate}:${r.qty}:${r.source}`)).toEqual([
        '2026-08-01:7:core',
        '2026-08-26:9:sellmate',
        '2026-09-01:2:core',
      ]);

      await trx.update(wmsTables.salesOrders).set({ status: 'cancelled' }).where(eq(wmsTables.salesOrders.id, orderId));
      const afterCancel = await writer.rebuildCoreWindow(WINDOW, trx);
      expect(afterCancel.rows).toBe(first.rows - 1);
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-08-01', '2026-08-26']);
    });
  });

  it('D0 경계 — coreSince 가 from 보다 뒤면 그 이후만 만든다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId, quantity: 1, totalPrice: 1 }],
      });
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-02T03:00:00Z',
        lines: [{ variantId, quantity: 1, totalPrice: 1 }],
      });
      const result = await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(
        { ...WINDOW, coreSince: '2026-09-02' },
        trx,
      );
      expect(result.from).toBe('2026-09-02');
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-09-02']);
    });
  });

  it('매칭 없는 variant 는 행이 없다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await seedOrder(trx, {
        orderedAtUtc: '2026-09-01T03:00:00Z',
        lines: [{ variantId: randomUUID(), quantity: 1, totalPrice: 1 }],
      });
      await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreWindow(WINDOW, trx);
      expect(await readSeries(trx, [skuId])).toEqual([]);
    });
  });

  it('rebuildCoreFull 은 D0 가 없으면 core 최초 주문일부터', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const variantId = await seedMatching(trx, [{ skuId, quantity: 1 }]);
      await seedOrder(trx, {
        orderedAtUtc: '2026-03-01T03:00:00Z',
        lines: [{ variantId, quantity: 1, totalPrice: 1 }],
      });
      const result = await new DemandSeriesWriter(boundDbService(trx)).rebuildCoreFull(
        { to: '2026-09-08', coreSince: null },
        trx,
      );
      // 로컬 DB 에 더 오래된 주문이 있을 수 있어 from 은 ≤ 2026-03-01 만 확인한다.
      expect(result.from !== null && result.from <= '2026-03-01').toBe(true);
      expect((await readSeries(trx, [skuId])).map((r) => r.demandDate)).toEqual(['2026-03-01']);
    });
  });
});
