import * as postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

const idsScope = (ids: string[]) =>
  sql`SELECT unnest(ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}])`;

describeIfDb('상자별 판정 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  const NOW = new Date('2099-01-01T00:00:00.000Z');

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function rollback(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (rawTx) => {
        await fn(rawTx as unknown as DbTx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  it('형제 상자가 더 뒤처져 주문 투영에서 가려진 상자도 상자 판정에는 그대로 나온다', async () => {
    await rollback(async (tx) => {
      const reader = new OrderProgressReader(makeDbService(db));
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      // 판매주문당 FO 는 하나다 — 품목 둘을 상자 둘에 나눠 담는다. FO 가 created(덜 예약)라 draft 상자는 reserve 단계다
      const fo = await f.seedFo(tx, w, o, { status: 'created' });
      const [second] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: fo.foId,
          salesOrderId: o.salesOrderId,
          salesOrderLineId: o.lineId,
          skuId: w.skuId,
          qty: 1,
        })
        .returning();
      const consolidating = await f.seedBox(tx, w, [fo.foItemId], {
        status: 'recovery_required',
        recoveryCode: 'CONSOLIDATION_PENDING',
      });
      await f.seedBox(tx, w, [second.id], { status: 'draft' });

      const [order] = await reader.judge([o.salesOrderId], NOW, tx);
      expect(order).toMatchObject({ stage: 'reserve', state: 'created' });

      const box = await reader.judgeShipment(consolidating.shipmentId, tx);
      expect(box).toMatchObject({
        shipmentId: consolidating.shipmentId,
        stage: 'pick',
        state: 'CONSOLIDATION_PENDING',
        salesOrderIds: [o.salesOrderId],
        orderRules: ['unit'],
      });
    });
  });

  it('합포장 상자는 상자당 한 행이고, 상자를 나눈 주문이 투영에서 종료(셀메이트 출고)여도 그 주문 판정이 실린다', async () => {
    await rollback(async (tx) => {
      const dbs = makeDbService(db);
      const reader = new OrderProgressReader(dbs);
      const w = await f.seedWorld(tx);
      const open = await f.seedOrder(tx);
      const shipped = await f.seedOrder(tx, { status: 'shipped' });
      const a = await f.seedFo(tx, w, open);
      const b = await f.seedFo(tx, w, shipped);
      const shared = await f.seedBox(tx, w, [a.foItemId, b.foItemId], {
        status: 'recovery_required',
        recoveryCode: 'CONSOLIDATION_PENDING',
      });
      await new OrderProgressManager(dbs).refreshScope(idsScope([open.salesOrderId, shipped.salesOrderId]), NOW, tx);
      const [closed] = await tx
        .select({ outcome: wmsTables.orderProgress.outcome })
        .from(wmsTables.orderProgress)
        .where(eq(wmsTables.orderProgress.salesOrderId, shipped.salesOrderId));
      expect(closed.outcome).toBe('external_shipped');

      const rows = (await reader.judgeOpenShipments(tx)).filter((r) => r.shipmentId === shared.shipmentId);
      expect(rows).toHaveLength(1);
      expect(rows[0].salesOrderIds).toEqual([open.salesOrderId, shipped.salesOrderId].sort());
      expect(rows[0].orderRules).toEqual(['external_shipped', 'unit']);
    });
  });

  it('취소된 상자는 상자 판정에 나오지 않고, 없는 상자는 undefined', async () => {
    await rollback(async (tx) => {
      const dbs = makeDbService(db);
      const reader = new OrderProgressReader(dbs);
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const inHouse = await f.seedFo(tx, w, o);
      const canceled = await f.seedBox(tx, w, [inHouse.foItemId], { status: 'canceled' });
      await new OrderProgressManager(dbs).refreshScope(idsScope([o.salesOrderId]), NOW, tx);

      const ours = (await reader.judgeOpenShipments(tx)).filter((r) => r.salesOrderIds.includes(o.salesOrderId));
      expect(ours).toEqual([]);
      expect(await reader.judgeShipment(canceled.shipmentId, tx)).toBeUndefined();
      expect(await reader.judgeShipment('00000000-0000-0000-0000-000000000000', tx)).toBeUndefined();
    });
  });

  // 입점사 상자는 상자다(K3 PR4, N7) — 리컨실러 상자 후보 원천에도 같은 단계·상태로 나온다. 겨누는 상자 규칙은 아직 없다(SHIPMENT_STATES)
  it('넘기지 않은 입점사 상자는 열린 상자 판정에 dispatch/drop_ship_pending 으로 나온다', async () => {
    await rollback(async (tx) => {
      const dbs = makeDbService(db);
      const reader = new OrderProgressReader(dbs);
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], {
        status: 'draft',
        supplierId: await f.seedDirectSupplier(tx),
      });
      await new OrderProgressManager(dbs).refreshScope(idsScope([o.salesOrderId]), NOW, tx);

      const ours = (await reader.judgeOpenShipments(tx)).filter((r) => r.salesOrderIds.includes(o.salesOrderId));
      expect(ours).toEqual([
        expect.objectContaining({
          shipmentId: box.shipmentId,
          stage: 'dispatch',
          state: 'drop_ship_pending',
          orderRules: ['unit'],
        }),
      ]);
    });
  });
});
