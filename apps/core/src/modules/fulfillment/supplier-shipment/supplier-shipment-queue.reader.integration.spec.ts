import * as postgres from 'postgres';
import { randomUUID } from 'crypto';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { SupplierShipmentQueueReader } from './supplier-shipment-queue.reader';
import * as f from '../order-progress/__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('직배 목록 — 입점사 대기열 읽기 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function seedSupplier(tx: DbTx, name: string): Promise<string> {
    const [row] = await tx
      .insert(wmsTables.suppliers)
      .values({
        name: `${name}-${randomUUID().slice(0, 6)}`,
        code: `Q-${randomUUID().slice(0, 6)}`,
        isDirectDelivery: true,
      })
      .returning();
    return row.id;
  }

  /** 주문 하나 + FO 항목 하나 — 상자 라인이 매달릴 곳 */
  async function seedItem(tx: DbTx, w: f.World) {
    const order = await f.seedOrder(tx);
    const fo = await f.seedFo(tx, w, order);
    return { ...order, foItemId: fo.foItemId };
  }

  it('요약·대기·넘김·입점사 분리', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const reader = new SupplierShipmentQueueReader(makeDbService(db));
        const w = await f.seedWorld(tx);
        const a = await seedSupplier(tx, 'q-a');
        const b = await seedSupplier(tx, 'q-b');
        const c = await seedSupplier(tx, 'q-c');
        await tx.insert(wmsTables.skuSuppliers).values({ skuId: w.skuId, supplierId: a, supplierSku: 'A-SKU-1' });

        const t0 = new Date('2098-01-01T00:00:00.000Z');
        const t1 = new Date('2098-01-02T00:00:00.000Z');
        const t2 = new Date('2098-01-03T00:00:00.000Z');
        const i1 = await seedItem(tx, w);
        const i2 = await seedItem(tx, w);
        const i3 = await seedItem(tx, w);
        const pendingLate = await f.seedBox(tx, w, [i2.foItemId], { status: 'draft', supplierId: a, openedAt: t1 });
        const pendingEarly = await f.seedBox(tx, w, [i1.foItemId], { status: 'draft', supplierId: a, openedAt: t0 });
        const handoffAt = new Date('2098-01-05T00:00:00.000Z');
        const handoff = await f.seedHandoff(tx, a, handoffAt);
        const forwarded = await f.seedBox(tx, w, [i3.foItemId], {
          status: 'draft',
          supplierId: a,
          supplierHandoffId: handoff,
          openedAt: t2,
          unfulfillable: { lineIndex: 0, reason: '품절', at: new Date('2098-01-06T00:00:00.000Z') },
        });
        // B: 발송된 상자·취소된 상자 — 대기열에 없다
        const hb = await f.seedHandoff(tx, b);
        const j1 = await seedItem(tx, w);
        const j2 = await seedItem(tx, w);
        const bShipped = await f.seedBox(tx, w, [j1.foItemId], {
          status: 'shipped',
          supplierId: b,
          supplierHandoffId: hb,
        });
        await f.seedBox(tx, w, [j2.foItemId], { status: 'canceled', supplierId: b });

        const summary = await reader.summaryBySupplier(tx);
        const ours = summary.filter((s) => [a, b, c].includes(s.supplierId));
        expect(ours).toHaveLength(1);
        expect(ours[0]).toMatchObject({
          supplierId: a,
          pendingShipments: 2,
          forwardedShipments: 1,
          unfulfillableLines: 1,
        });

        const pending = await reader.openShipments(a, 'pending', tx);
        expect(pending.map((s) => s.shipmentId)).toEqual([pendingEarly.shipmentId, pendingLate.shipmentId]);
        expect(pending[0]).toMatchObject({
          stage: 'pending',
          salesOrderId: i1.salesOrderId,
          handoffId: null,
          handoffAt: null,
        });
        expect(pending[0].lines).toHaveLength(1);
        expect(pending[0].lines[0]).toMatchObject({
          skuId: w.skuId,
          supplierSku: 'A-SKU-1',
          qty: 1,
          unfulfillableReason: null,
          unfulfillableReportedAt: null,
        });

        const fwd = await reader.openShipments(a, 'forwarded', tx);
        expect(fwd.map((s) => s.shipmentId)).toEqual([forwarded.shipmentId]);
        expect(fwd[0].handoffId).toBe(handoff);
        expect(fwd[0].handoffAt?.toISOString()).toBe(handoffAt.toISOString());
        expect(fwd[0].lines[0].unfulfillableReason).toBe('품절');
        expect(fwd[0].lines[0].unfulfillableReportedAt).toBeInstanceOf(Date);

        // 다른 입점사의 상자는 섞이지 않는다
        expect(await reader.openShipments(b, 'pending', tx)).toEqual([]);
        expect(await reader.openShipments(b, 'forwarded', tx)).toEqual([]);
        expect(await reader.openShipments(c, 'pending', tx)).toEqual([]);
        expect(bShipped.shipmentId).toBeDefined();
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
