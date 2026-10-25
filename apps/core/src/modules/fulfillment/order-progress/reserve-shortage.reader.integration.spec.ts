import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import { OrderProgressService } from './order-progress.service';
import { ReserveShortageReader } from './reserve-shortage.reader';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

type Order = { salesOrderId: string; lineId: string };
type Spec = { order: Order; foId: string; skuId: string; qty: number; reserved: number };

describeIfDb('ReserveShortageReader (PostgreSQL integration)', () => {
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

  async function rollback(fn: (tx: DbTx, reader: ReserveShortageReader) => Promise<void>) {
    await expect(
      db.transaction(async (rawTx) => {
        await fn(rawTx as unknown as DbTx, new ReserveShortageReader(makeDbService(db)));
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  async function seedSku(tx: DbTx, w: f.World, name: string): Promise<string> {
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name, code: `RS-${randomUUID().toUpperCase()}`, holderId: w.holderId })
      .returning();
    return sku.id;
  }

  /** 주문 하나와 그 FO. 아이템은 상자 라인마다 따로 만든다(seedFo 가 만든 첫 아이템은 상자에 걸지 않는다) */
  async function seedOrderFo(tx: DbTx, w: f.World): Promise<{ order: Order; foId: string }> {
    const order = await f.seedOrder(tx);
    const fo = await f.seedFo(tx, w, order, { status: 'partially_reserved' });
    return { order, foId: fo.foId };
  }

  /** 라인마다 (주문·SKU·수량·확정 예약)을 주면 그대로 상자와 예약을 만든다 */
  async function seedBoxOf(
    tx: DbTx,
    w: f.World,
    lines: Spec[],
    args: { status?: 'draft' | 'planned'; recoveryCode?: string; openedAt?: Date } = {},
  ): Promise<{ shipmentId: string }> {
    const itemIds: string[] = [];
    for (const l of lines) {
      const [item] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: l.foId,
          salesOrderId: l.order.salesOrderId,
          salesOrderLineId: l.order.lineId,
          skuId: l.skuId,
          qty: l.qty,
        })
        .returning();
      itemIds.push(item.id);
    }
    const box = await f.seedBox(tx, w, itemIds, {
      status: args.status ?? 'draft',
      recoveryCode: args.recoveryCode,
      openedAt: args.openedAt,
      qty: lines.map((l) => l.qty),
    });
    for (const [i, l] of lines.entries()) {
      await tx
        .update(wmsTables.shipmentLines)
        .set({ skuId: l.skuId })
        .where(eq(wmsTables.shipmentLines.id, box.lineIds[i]));
      if (l.reserved > 0) {
        await tx.insert(wmsTables.stockReservations).values({
          targetType: 'SHIPMENT_LINE',
          targetId: l.foId,
          fulfillmentOrderItemId: itemIds[i],
          shipmentLineId: box.lineIds[i],
          skuId: l.skuId,
          warehouseId: w.warehouseId,
          quantity: l.reserved,
          status: 'confirmed',
        });
      }
    }
    return { shipmentId: box.shipmentId };
  }

  async function seedPoLine(
    tx: DbTx,
    w: f.World,
    skuId: string,
    args: {
      expectedArrival: string | null;
      orderedQty?: number;
      receivedQty?: number;
      closed?: boolean;
      poStatus?: 'confirmed' | 'cancelled';
    },
  ): Promise<void> {
    const [po] = await tx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'domestic',
        status: args.poStatus ?? 'confirmed',
        sourceWarehouseId: w.warehouseId,
        destinationWarehouseId: w.warehouseId,
        ...(args.poStatus === 'cancelled' ? { cancelledReason: 'x', cancelledAt: new Date() } : {}),
      })
      .returning();
    const orderedQty = args.orderedQty ?? 10;
    await tx.insert(wmsTables.purchaseOrderLines).values({
      poId: po.id,
      skuId,
      quantity: orderedQty,
      status: 'ordered',
      orderedQty,
      receivedQty: args.receivedQty ?? 0,
      expectedArrival: args.expectedArrival,
      ...(args.closed ? { closedAt: new Date(), closedReason: 'x' } : {}),
    });
  }

  it('대표 상자와 SKU 별 부족 수량·종 수를 싣는다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const s1 = await seedSku(tx, w, '고무줄');
      const s2 = await seedSku(tx, w, '핀');
      const s3 = await seedSku(tx, w, '헤어클립 세트');
      const { order, foId } = await seedOrderFo(tx, w);
      const box = await seedBoxOf(tx, w, [
        { order, foId, skuId: s1, qty: 2, reserved: 2 },
        { order, foId, skuId: s2, qty: 1, reserved: 1 },
        { order, foId, skuId: s3, qty: 3, reserved: 1 },
      ]);
      await seedPoLine(tx, w, s3, { expectedArrival: '2026-10-25' });

      const map = await reader.forOrders([order.salesOrderId], tx);
      expect(map.get(order.salesOrderId)).toEqual({
        shipmentId: box.shipmentId,
        manifestVersion: 1,
        consolidated: false,
        splittable: true,
        skuKinds: 3,
        shortSkuKinds: 1,
        items: [{ skuId: s3, skuName: '헤어클립 세트', shortQty: 2, expectedArrival: '2026-10-25' }],
      });
    });
  });

  it('상자에 확정 예약이 하나도 없으면 splittable: false — 나눠 봐야 409 다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const s = await seedSku(tx, w, '클립');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [{ order, foId, skuId: s, qty: 2, reserved: 0 }]);
      const got = (await reader.forOrders([order.salesOrderId], tx)).get(order.salesOrderId);
      expect(got?.splittable).toBe(false);
      expect(got?.consolidated).toBe(false);
    });
  });

  it('한 라인이 넘치게 예약돼도 다른 라인이 덜 예약이면 대표 상자로 읽고, 부족은 그 라인 몫이다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const a = await seedSku(tx, w, '가');
      const b = await seedSku(tx, w, '나');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [
        { order, foId, skuId: a, qty: 1, reserved: 2 },
        { order, foId, skuId: b, qty: 1, reserved: 0 },
      ]);
      const got = (await reader.forOrders([order.salesOrderId], tx)).get(order.salesOrderId);
      expect(got?.splittable).toBe(true);
      expect(got?.items.map((i) => [i.skuId, i.shortQty])).toEqual([[b, 1]]);
    });
  });

  it('같은 SKU 가 두 라인에 걸치면 한 품목으로 합치고, 부족 큰 순으로 나열한다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const a = await seedSku(tx, w, '가');
      const b = await seedSku(tx, w, '나');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [
        { order, foId, skuId: a, qty: 2, reserved: 0 },
        { order, foId, skuId: b, qty: 4, reserved: 0 },
        { order, foId, skuId: a, qty: 4, reserved: 3 },
      ]);
      const got = (await reader.forOrders([order.salesOrderId], tx)).get(order.salesOrderId);
      expect(got?.skuKinds).toBe(2);
      expect(got?.shortSkuKinds).toBe(2);
      // a: (2-0) + (4-3) = 3, b: 4 → b 가 먼저
      expect(got?.items.map((i) => [i.skuId, i.shortQty])).toEqual([
        [b, 4],
        [a, 3],
      ]);
    });
  });

  it('열린 발주가 없거나 다 받았거나 잔량 포기거나 취소된 발주면 expectedArrival 은 null', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const none = await seedSku(tx, w, '없음');
      const received = await seedSku(tx, w, '다받음');
      const closed = await seedSku(tx, w, '포기');
      const cancelled = await seedSku(tx, w, '취소');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedBoxOf(
        tx,
        w,
        [none, received, closed, cancelled].map((skuId) => ({ order, foId, skuId, qty: 1, reserved: 0 })),
      );
      await seedPoLine(tx, w, received, { expectedArrival: '2026-10-20', orderedQty: 5, receivedQty: 5 });
      await seedPoLine(tx, w, closed, { expectedArrival: '2026-10-21', closed: true });
      await seedPoLine(tx, w, cancelled, { expectedArrival: '2026-10-22', poStatus: 'cancelled' });

      const got = (await reader.forOrders([order.salesOrderId], tx)).get(order.salesOrderId);
      expect(got?.items).toHaveLength(4);
      expect(got?.items.every((i) => i.expectedArrival === null)).toBe(true);
    });
  });

  it('가장 이른 도착예정일을 고른다(남은 수량 있는 열린 발주 중에서)', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const s = await seedSku(tx, w, '클립');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [{ order, foId, skuId: s, qty: 1, reserved: 0 }]);
      await seedPoLine(tx, w, s, { expectedArrival: '2026-11-03' });
      await seedPoLine(tx, w, s, { expectedArrival: '2026-10-27' });
      await seedPoLine(tx, w, s, { expectedArrival: '2026-10-01', closed: true });
      await seedPoLine(tx, w, s, { expectedArrival: null });

      const got = (await reader.forOrders([order.salesOrderId], tx)).get(order.salesOrderId);
      expect(got?.items[0].expectedArrival).toBe('2026-10-27');
    });
  });

  it('합포장 상자는 consolidated: true, 종 수는 상자 전체 SKU 로 센다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const a = await seedSku(tx, w, '가');
      const b = await seedSku(tx, w, '나');
      const mine = await seedOrderFo(tx, w);
      const other = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [
        { order: mine.order, foId: mine.foId, skuId: a, qty: 1, reserved: 0 },
        { order: other.order, foId: other.foId, skuId: b, qty: 1, reserved: 1 },
      ]);
      const map = await reader.forOrders([mine.order.salesOrderId, other.order.salesOrderId], tx);
      const m = map.get(mine.order.salesOrderId);
      expect(m?.consolidated).toBe(true);
      expect(m?.skuKinds).toBe(2);
      expect(m?.shortSkuKinds).toBe(1);
      // 다른 주문도 같은 상자를 대표로 본다
      expect(map.get(other.order.salesOrderId)?.shipmentId).toBe(m?.shipmentId);
    });
  });

  it('덜 예약된 상자가 없는 주문(다 예약·draft 아님·복구 코드 있음·상자 없음)은 맵에 없다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const s = await seedSku(tx, w, '클립');
      const full = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [{ order: full.order, foId: full.foId, skuId: s, qty: 2, reserved: 2 }]);
      const planned = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [{ order: planned.order, foId: planned.foId, skuId: s, qty: 2, reserved: 0 }], {
        status: 'planned',
      });
      const recovering = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [{ order: recovering.order, foId: recovering.foId, skuId: s, qty: 2, reserved: 0 }], {
        recoveryCode: 'CANCEL_REPLAN_PENDING',
      });
      const noBox = await seedOrderFo(tx, w);

      const map = await reader.forOrders(
        [full, planned, recovering, noBox].map((x) => x.order.salesOrderId),
        tx,
      );
      expect(map.size).toBe(0);
      expect((await reader.forOrders([], tx)).size).toBe(0);
    });
  });

  it('덜 예약된 상자가 여럿이면 opened_at 이 오래된 상자를 대표로 삼는다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const a = await seedSku(tx, w, '가');
      const b = await seedSku(tx, w, '나');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedBoxOf(tx, w, [{ order, foId, skuId: b, qty: 1, reserved: 0 }], {
        openedAt: new Date('2026-10-02T00:00:00Z'),
      });
      const older = await seedBoxOf(tx, w, [{ order, foId, skuId: a, qty: 1, reserved: 0 }], {
        openedAt: new Date('2026-10-01T00:00:00Z'),
      });
      const got = (await reader.forOrders([order.salesOrderId], tx)).get(order.salesOrderId);
      expect(got?.shipmentId).toBe(older.shipmentId);
      expect(got?.items.map((i) => i.skuId)).toEqual([a]);
    });
  });

  /** 입점사 draft 상자 하나(예약 없음). 품목은 따로 만든다 */
  async function seedSupplierBoxOf(tx: DbTx, w: f.World, l: Omit<Spec, 'reserved'>, openedAt?: Date) {
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: l.foId,
        salesOrderId: l.order.salesOrderId,
        salesOrderLineId: l.order.lineId,
        skuId: l.skuId,
        qty: l.qty,
      })
      .returning();
    return f.seedBox(tx, w, [item.id], {
      status: 'draft',
      qty: [l.qty],
      openedAt,
      supplierId: await f.seedDirectSupplier(tx),
    });
  }

  // 입점사 상자는 «덜 예약된 상자»가 아니다(K3 PR4, N5) — 나눠 보내기 대상도, 부족 품목도 아니다
  it('입점사 draft 상자만 있는 주문은 맵에 없다', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const s = await seedSku(tx, w, '직배품');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedSupplierBoxOf(tx, w, { order, foId, skuId: s, qty: 2 });
      expect((await reader.forOrders([order.salesOrderId], tx)).has(order.salesOrderId)).toBe(false);
    });
  });

  it('덜 예약된 창고 상자 + 더 오래된 입점사 상자 → 대표는 창고 상자', async () => {
    await rollback(async (tx, reader) => {
      const w = await f.seedWorld(tx);
      const whSku = await seedSku(tx, w, '창고품');
      const supSku = await seedSku(tx, w, '직배품');
      const { order, foId } = await seedOrderFo(tx, w);
      await seedSupplierBoxOf(tx, w, { order, foId, skuId: supSku, qty: 1 }, new Date('2026-10-01T00:00:00Z'));
      const wh = await seedBoxOf(tx, w, [{ order, foId, skuId: whSku, qty: 2, reserved: 1 }], {
        openedAt: new Date('2026-10-02T00:00:00Z'),
      });
      const got = (await reader.forOrders([order.salesOrderId], tx)).get(order.salesOrderId);
      expect(got).toMatchObject({ shipmentId: wh.shipmentId, skuKinds: 1, shortSkuKinds: 1, splittable: true });
      expect(got?.items.map((i) => [i.skuId, i.shortQty])).toEqual([[whSku, 1]]);
    });
  });

  it('서비스: 예약 단계 목록에만 shortage 를 싣고, 다른 단계는 null', async () => {
    await rollback(async (tx) => {
      const dbs = makeDbService(db);
      const service = new OrderProgressService(new OrderProgressReader(dbs), new ReserveShortageReader(dbs));
      const manager = new OrderProgressManager(dbs);
      const w = await f.seedWorld(tx);
      const s = await seedSku(tx, w, '클립');
      const stuck = await seedOrderFo(tx, w);
      const box = await seedBoxOf(tx, w, [{ order: stuck.order, foId: stuck.foId, skuId: s, qty: 2, reserved: 1 }]);
      const backlogOrder = await f.seedOrder(tx);
      await f.seedBacklog(tx, backlogOrder.salesOrderId, 'awaiting_matching');
      const ids = [stuck.order.salesOrderId, backlogOrder.salesOrderId];
      await manager.refreshScope(
        sql`SELECT unnest(ARRAY[${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}])`,
        new Date(),
        tx,
      );

      const reserve = await service.listOrders({ stage: 'reserve', sort: 'dwell', limit: 500 }, tx);
      const mine = reserve.items.find((i) => i.salesOrderId === stuck.order.salesOrderId);
      expect(mine?.shortage).toMatchObject({ shipmentId: box.shipmentId, skuKinds: 1, shortSkuKinds: 1 });
      expect(mine?.shortage?.items).toEqual([{ skuId: s, skuName: '클립', shortQty: 1, expectedArrival: null }]);

      const fo = await service.listOrders({ stage: 'fo', sort: 'dwell', limit: 500 }, tx);
      const other = fo.items.find((i) => i.salesOrderId === backlogOrder.salesOrderId);
      expect(other).toBeDefined();
      expect(other?.shortage).toBeNull();
    });
  });
});
