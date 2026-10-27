import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../../fulfillment/services/__support__';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import { CustomerReturnReceivingManager } from './customer-return-receiving.manager';

/**
 * 반품 상세 뷰 — 주문번호·품목명·SKU 이름·환불 기한 (K8 PR7 Task 2). rollback 전용 트랜잭션.
 *
 * 실행: DATABASE_URL=<scratch core DB> npx jest apps/core/src/modules/sales-order/customer-return --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CustomerReturnReader — 상세 뷰 (K8 PR7)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  const dbService = makeDbService(db);
  const { command, location } = wireLogistics(dbService);
  afterAll(async () => {
    await client.end();
  });

  const actorId = 'cs-1';

  function wire() {
    const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const reader = new CustomerReturnReader(dbService);
    const intake = new CustomerReturnManager(dbService, publisher as never);
    const receiving = new CustomerReturnReceivingManager(
      dbService,
      reader,
      command,
      publisher as never,
      publisher as never,
    );
    return { reader, intake, receiving };
  }
  type Wired = ReturnType<typeof wire>;

  /** 배송완료 소포가 있는 Medusa 회원 주문 + PR 5 반품 기록. 기본: 단품(SKU × 1) 2개 배송완료, 2개 반품. */
  async function seed(
    tx: DbTx,
    w: World,
    wired: Wired,
    opts: { quantity?: number; composition?: Array<{ skuId: string; qtyPerUnit: number }> } = {},
  ) {
    const quantity = opts.quantity ?? 2;
    const composition = opts.composition ?? [{ skuId: w.skuId, qtyPerUnit: 1 }];
    await location.ensureSystemLocations(w.warehouseId, tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity,
      composition,
      parcels: [{ qtyBySku: Object.fromEntries(composition.map((c) => [c.skuId, c.qtyPerUnit * quantity])) }],
      customerId: randomUUID(),
    });
    const channelOrderItemId = `item_${randomUUID().slice(0, 8)}`;
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId })
      .where(eq(wmsTables.salesOrderLines.id, line.lineId));
    const [so] = await tx
      .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
    const channelReturnId = `ret_${randomUUID().slice(0, 8)}`;
    const { customerReturnId } = await wired.intake.recordRequested(
      {
        orderId: 'ignored',
        salesChannel: 'medusa',
        externalOrderId: so.channelOrderId,
        returnId: channelReturnId,
        requestId: `req_${randomUUID().slice(0, 8)}`,
        reason: 'defective',
        feeBearer: 'seller',
        requestedBy: 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items: [{ channelOrderItemId, quantity }],
      },
      tx,
    );
    const items = await tx
      .select({ id: wmsTables.customerReturnItems.id, skuId: wmsTables.customerReturnItems.skuId })
      .from(wmsTables.customerReturnItems)
      .innerJoin(
        wmsTables.customerReturnLines,
        eq(wmsTables.customerReturnLines.id, wmsTables.customerReturnItems.customerReturnLineId),
      )
      .where(eq(wmsTables.customerReturnLines.customerReturnId, customerReturnId));
    const itemIdBySku = new Map(items.map((i) => [i.skuId, i.id]));
    const itemOf = (skuId: string) => {
      const id = itemIdBySku.get(skuId);
      if (!id) throw new Error(`no customer return item for sku ${skuId}`);
      return id;
    };
    const arrive = (items: Array<{ skuId: string; quantity: number }>, key = `parcel-${randomUUID()}`) =>
      wired.receiving.recordArrival(
        {
          customerReturnId,
          warehouseId: w.warehouseId,
          items: items.map((i) => ({ customerReturnItemId: itemOf(i.skuId), quantity: i.quantity })),
          idempotencyKey: key,
          actorId,
        },
        tx,
      );
    const inspect = (items: Array<{ skuId: string; accepted: number; rejected?: number; held?: number }>) =>
      wired.receiving.recordInspection(
        {
          customerReturnId,
          items: items.map((i) => ({
            customerReturnItemId: itemOf(i.skuId),
            accepted: i.accepted,
            rejected: i.rejected ?? 0,
            held: i.held ?? 0,
          })),
          actorId,
        },
        tx,
      );
    return {
      ...line,
      channelOrderItemId,
      channelOrderId: so.channelOrderId,
      channelReturnId,
      customerReturnId,
      itemOf,
      arrive,
      inspect,
    };
  }

  it('상세가 주문번호·채널 주문 id·판매 채널·줄 품목명·SKU 이름·코드를 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seed(tx, w, wired);
      await tx
        .update(wmsTables.salesOrders)
        .set({ displayOrderNo: '3900' })
        .where(eq(wmsTables.salesOrders.id, s.salesOrderId));
      const [sku] = await tx
        .select({ name: wmsTables.skus.name, code: wmsTables.skus.code })
        .from(wmsTables.skus)
        .where(eq(wmsTables.skus.id, w.skuId));
      const [line] = await tx
        .select({ productName: wmsTables.salesOrderLines.productName })
        .from(wmsTables.salesOrderLines)
        .where(eq(wmsTables.salesOrderLines.id, s.lineId));

      const view = await wired.reader.findById(s.customerReturnId, tx);
      expect(view.order).toEqual({ orderNo: '3900', channelOrderId: s.channelOrderId, salesChannel: 'medusa' });
      expect(view.lines[0].productName).toBe(line.productName);
      expect(view.lines[0].items[0]).toMatchObject({ skuName: sku.name, skuCode: sku.code });

      await tx
        .update(wmsTables.salesOrders)
        .set({ displayOrderNo: null })
        .where(eq(wmsTables.salesOrders.id, s.salesOrderId));
      const fallback = await wired.reader.findById(s.customerReturnId, tx);
      expect(fallback.order.orderNo).toBe(s.channelOrderId);
    });
  });

  it('도착 전엔 refundDueAt 이 null, 도착하면 첫 도착 시각으로 계산한 값', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seed(tx, w, wired);
      expect((await wired.reader.findById(s.customerReturnId, tx)).refundDueAt).toBeNull();

      await s.arrive([{ skuId: w.skuId, quantity: 1 }]);
      await tx
        .update(wmsTables.customerReturns)
        .set({ arrivedAt: new Date('2026-10-26T03:00:00Z') })
        .where(eq(wmsTables.customerReturns.id, s.customerReturnId));
      const view = await wired.reader.findById(s.customerReturnId, tx);
      expect(view.arrivedAt).toBe('2026-10-26T03:00:00.000Z');
      expect(view.refundDueAt).toBe('2026-10-29T14:59:59.999Z');
    });
  });

  it('기한 넘김 사유와 취소 시각을 싣는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seed(tx, w, wired);
      const plain = await wired.reader.findById(s.customerReturnId, tx);
      expect(plain.windowOverrideReason).toBeNull();
      expect(plain.cancelledAt).toBeNull();

      await tx
        .update(wmsTables.customerReturns)
        .set({ windowOverrideReason: '고객센터 승인', cancelledAt: new Date('2026-10-27T05:00:00Z') })
        .where(eq(wmsTables.customerReturns.id, s.customerReturnId));
      const view = await wired.reader.findById(s.customerReturnId, tx);
      expect(view.windowOverrideReason).toBe('고객센터 승인');
      expect(view.cancelledAt).toBe('2026-10-27T05:00:00.000Z');
    });
  });
});
