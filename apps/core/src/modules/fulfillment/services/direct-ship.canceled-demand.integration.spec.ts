import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { seedFo, seedOrder, seedWorld } from '../order-progress/__support__/order-progress.fixtures';
import { DirectShipService } from './direct-ship.service';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('직배송 조회·완료가 취소 수량을 뺀다 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  // DirectShipService 는 this.db 로 읽는다 — 롤백 tx 안의 행이 보이도록 DbService 를 tx 에 묶는다
  function wire(tx: DbTx) {
    const dbService = { db: tx, run: <T>(fn: (t: DbTx) => Promise<T>) => fn(tx) } as unknown as ReturnType<
      typeof makeDbService
    >;
    const w = wireLogistics(dbService);
    return { w, direct: new DirectShipService(dbService, w.fulfillments, w.workflowGate) };
  }

  // FOI 둘: (qty 3·canceled 1), (qty 2·canceled 2 — 전량 취소)
  async function seedTwoItems(tx: DbTx, dropShip: 'pending' | 'forwarded') {
    const world = await seedWorld(tx);
    const order = await seedOrder(tx, { quantity: 5 });
    const { foId, foItemId } = await seedFo(tx, world, order, { dropShip, status: 'created', qty: 3 });
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ canceledQty: 1 })
      .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));
    const [second] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: foId,
        salesOrderId: order.salesOrderId,
        salesOrderLineId: order.lineId,
        skuId: world.skuId,
        qty: 2,
        canceledQty: 2,
        status: 'canceled',
      })
      .returning();
    return { world, order, foId, firstId: foItemId, secondId: second.id };
  }

  it('취소분을 뺀 수량을 싣고 전량 취소 항목은 뺀다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { direct } = wire(tx);
      const { foId, world } = await seedTwoItems(tx, 'pending');
      const [holder] = await tx.select().from(wmsTables.holders).where(eq(wmsTables.holders.id, world.holderId));
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ ownerId: holder.id })
        .where(eq(wmsTables.fulfillmentOrders.id, foId));

      const orders = await direct.getDirectShipOrders({ status: 'pending', companyName: holder.name });
      const order = orders.find((o) => o.fulfillmentOrderId === foId);
      expect(order?.items).toHaveLength(1);
      expect(order?.items[0].qty).toBe(2);
      expect(order?.totalQty).toBe(2);

      const exported = await direct.exportOrdersForCompany(holder.name);
      expect(exported.orders.map((o) => o.quantity)).toEqual([2]);
    });
  });

  it('완료는 남은 수량만 출고로 쓰고 전량 취소 항목은 그대로 둔다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w } = wire(tx);
      const { foId, firstId, secondId } = await seedTwoItems(tx, 'forwarded');
      // ship() 은 trackingNumber '' 로 적재해 실 스키마 검증(min(1))에서 늘 거절된다 — 이 PR 밖의 기존 결함.
      // 여기선 적재 인자(payload)만 잡는다.
      const enqueue = jest.spyOn(w.fulfillmentV1Publisher, 'enqueue').mockResolvedValue(undefined as never);

      await expect(w.fulfillments.ship(foId, tx)).resolves.toBeDefined();

      const [first] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, firstId));
      const [second] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, secondId));
      expect(first).toMatchObject({ shippedQty: 2, status: 'shipped' });
      expect(second).toMatchObject({ shippedQty: 0, canceledQty: 2, status: 'canceled' });

      expect(enqueue).toHaveBeenCalledTimes(1);
      const { eventType, payload } = enqueue.mock.calls[0][0];
      expect(eventType).toBe('FulfillmentShipped');
      expect(payload).toMatchObject({
        shippedItems: [expect.objectContaining({ fulfillmentItemId: firstId, shippedQty: 2 })],
      });
      expect(payload).toHaveProperty('shippedItems.length', 1);
    });
  });

  it('전량 취소돼 canceled 가 된 FO 는 넘길 수 없다 — 400, 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const { direct } = wire(tx);
      const world = await seedWorld(tx);
      const order = await seedOrder(tx, { quantity: 3 });
      const { foId } = await seedFo(tx, world, order, { dropShip: 'pending', status: 'created', qty: 3 });
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'canceled' })
        .where(eq(wmsTables.fulfillmentOrders.id, foId));
      const [holder] = await tx.select().from(wmsTables.holders).where(eq(wmsTables.holders.id, world.holderId));

      await expect(direct.forwardOrdersToCompany([foId], holder.name)).rejects.toThrow(
        'Some orders are not available for forwarding',
      );

      const [fo] = await tx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, foId));
      expect(fo.directShipStatus).toBe('pending');
      expect(fo.status).toBe('canceled');
    });
  });

  it('취소되지 않은 pending FO 는 넘어간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { direct } = wire(tx);
      const world = await seedWorld(tx);
      const order = await seedOrder(tx, { quantity: 3 });
      const { foId } = await seedFo(tx, world, order, { dropShip: 'pending', status: 'created', qty: 3 });
      const [holder] = await tx.select().from(wmsTables.holders).where(eq(wmsTables.holders.id, world.holderId));

      await direct.forwardOrdersToCompany([foId], holder.name);

      const [fo] = await tx.select().from(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, foId));
      expect(fo).toMatchObject({ directShipStatus: 'forwarded', ownerId: holder.id });
    });
  });
});
