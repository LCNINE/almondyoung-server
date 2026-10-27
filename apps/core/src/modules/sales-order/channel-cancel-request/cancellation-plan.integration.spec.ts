import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedHolder, seedSku, wireLogistics } from '../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { SalesOrdersService } from '../services/sales-orders.service';
import { insertCustomerReturn } from '../line-quantities/__support__/claim-facts.fixtures';
import { markLineShipped, seedChannelOrder } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function wireSalesOrders(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.unboxedDemand,
    logistics.productSkuMapping,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  return { logistics, salesOrders };
}

describeIfDb('SalesOrdersService.planCancellation (DB integration, rollback-only)', () => {
  jest.setTimeout(180_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('상자 후 전체 — 줄마다 남은 몫, 출고 없음, 남는 것 없음. 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const plan = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(plan).toEqual({
        lines: [
          { salesOrderLineId: seed.lineIds[0], quantity: 2 },
          { salesOrderLineId: seed.lineIds[1], quantity: 1 },
        ],
        hasShippedQuantity: false,
        leavesNothing: true,
      });
      const cancellations = await tx
        .select({ id: wmsTables.salesOrderCancellations.id })
        .from(wmsTables.salesOrderCancellations)
        .where(eq(wmsTables.salesOrderCancellations.salesOrderId, seed.salesOrderId));
      expect(cancellations).toHaveLength(0);
    });
  });

  it('상자 후 전체 — 한 줄이 다 나갔으면 남은 줄만, hasShippedQuantity', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      const plan = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(plan.lines).toEqual([{ salesOrderLineId: seed.lineIds[1], quantity: 1 }]);
      expect(plan.hasShippedQuantity).toBe(true);
      expect(plan.leavesNothing).toBe(false);
    });
  });

  it('상자 후 전체 — 다 나갔으면 지금 취소 코드와 같은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      await markLineShipped(tx, seed.lineIds[1], 1);
      await expect(w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx)).rejects.toThrow(
        'Sales order has no outstanding physical quantity to cancel',
      );
    });
  });

  it('상자 후 부분 — 요청 줄 그대로, 다른 줄이 남으면 leavesNothing=false · 남은 수량 초과는 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const plan = await w.salesOrders.planCancellation(
        seed.salesOrderId,
        [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
        tx,
      );
      expect(plan).toEqual({
        lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
        hasShippedQuantity: false,
        leavesNothing: false,
      });
      await expect(
        w.salesOrders.planCancellation(seed.salesOrderId, [{ salesOrderLineId: seed.lineIds[1], quantity: 2 }], tx),
      ).rejects.toThrow('exceeds remaining');
    });
  });

  it('상자 후 부분 — 반품이 잡은 수량은 취소 상한에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      // 줄 수량 2 중 1 이 나가 배송완료됐고 그 1 을 고객이 반품 중이다
      await markLineShipped(tx, seed.lineIds[0], 1);
      const { customerReturnId } = await insertCustomerReturn(tx, {
        salesOrderId: seed.salesOrderId,
        status: 'expected',
        lines: [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }],
      });
      const whole = [{ salesOrderLineId: seed.lineIds[0], quantity: 2 }];
      // 돌아오는 중인 물건을 취소로 또 환불하지 않게 — 상한은 남은 수량 2 가 아니라 2 − 반품 1 이다
      await expect(w.salesOrders.planCancellation(seed.salesOrderId, whole, tx)).rejects.toThrow(
        new BadRequestException('Cancellation quantity 2 exceeds remaining 1'),
      );
      // 반품이 잡지 않은(안 나간) 1 은 그대로 취소할 수 있다
      const unshipped = [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }];
      expect((await w.salesOrders.planCancellation(seed.salesOrderId, unshipped, tx)).lines).toEqual(unshipped);

      await tx
        .update(wmsTables.customerReturns)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(wmsTables.customerReturns.id, customerReturnId));
      // 취소된 반품은 상한을 잡지 않는다 — 같은 요청이 상한을 지나 다음 판정(나간 수량은 회수·반품으로)에서 걸린다
      await expect(w.salesOrders.planCancellation(seed.salesOrderId, whole, tx)).rejects.toThrow(
        'includes shipped or already canceled quantity',
      );
    });
  });

  it('상자 후 부분 — 남은 수량을 전부 요청하면 leavesNothing', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      const plan = await w.salesOrders.planCancellation(
        seed.salesOrderId,
        [
          { salesOrderLineId: seed.lineIds[0], quantity: 2 },
          { salesOrderLineId: seed.lineIds[1], quantity: 1 },
        ],
        tx,
      );
      expect(plan.leavesNothing).toBe(true);
    });
  });

  it('박스 이력 없음(FO 전) — 전체는 줄마다 남은 수량, 부분은 남은 수량 검사', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: false });
      const full = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(full.lines).toEqual([
        { salesOrderLineId: seed.lineIds[0], quantity: 2 },
        { salesOrderLineId: seed.lineIds[1], quantity: 1 },
      ]);
      expect(full.leavesNothing).toBe(true);
      await expect(
        w.salesOrders.planCancellation(seed.salesOrderId, [{ salesOrderLineId: seed.lineIds[1], quantity: 5 }], tx),
      ).rejects.toThrow('취소 수량(5개)이 취소 가능 수량(1개)을 초과합니다.');
    });
  });

  it('박스 이력 없음 — 이미 전체 취소된 주문의 부분 요청은 cancelBeforeBoxingPartial 과 같은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: false });
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled' })
        .where(eq(wmsTables.salesOrders.id, seed.salesOrderId));
      await expect(
        w.salesOrders.planCancellation(seed.salesOrderId, [{ salesOrderLineId: seed.lineIds[0], quantity: 1 }], tx),
      ).rejects.toThrow('이미 전체 취소된 주문입니다.');
    });
  });

  it('박스 이력 없음 — 전체 요청인데 출고 수량이 있는 FO 항목이 있으면 cancel 과 같은 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: false });
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      const [fo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ salesOrderId: seed.salesOrderId, warehouseId: seed.warehouseId, status: 'created' })
        .returning();
      await tx.insert(wmsTables.fulfillmentOrderItems).values({
        fulfillmentOrderId: fo.id,
        salesOrderId: seed.salesOrderId,
        salesOrderLineId: seed.lineIds[0],
        skuId,
        qty: 2,
        shippedQty: 1,
      });
      await expect(w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx)).rejects.toThrow(
        '출고 수량이 있는 항목이 포함되어 전체 취소를 할 수 없습니다. 부분 취소로 진행해 주세요.',
      );
    });
  });

  it('상자 후 전체 — 인쇄(외주) 줄은 창고 항목이 없어도 남은 판매 수량이 계획에 들어간다(출고분 제외 전환에서도 환불되게)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await markLineShipped(tx, seed.lineIds[0], 2);
      const [printLine] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: seed.salesOrderId,
          variantId: randomUUID(),
          productName: 'print',
          quantity: 1,
          unitPrice: 15000,
          almondDesignId: randomUUID(),
        })
        .returning({ id: wmsTables.salesOrderLines.id });
      const plan = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(plan.lines).toEqual([
        { salesOrderLineId: seed.lineIds[1], quantity: 1 },
        { salesOrderLineId: printLine.id, quantity: 1 },
      ]);
      expect(plan.hasShippedQuantity).toBe(true);
    });
  });

  it('상자 후 전체 — 디지털 줄(박스 없음)이 있어도 나간 게 없으면 leavesNothing', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireSalesOrders(tx);
      const seed = await seedChannelOrder(tx, w, { withFo: true });
      await tx.insert(wmsTables.salesOrderLines).values({
        salesOrderId: seed.salesOrderId,
        variantId: randomUUID(),
        productName: 'digital',
        quantity: 1,
        unitPrice: 1000,
        fulfillmentKind: 'digital',
        requiresShipping: false,
      });
      const plan = await w.salesOrders.planCancellation(seed.salesOrderId, undefined, tx);
      expect(plan.lines).toHaveLength(2);
      expect(plan.hasShippedQuantity).toBe(false);
      expect(plan.leavesNothing).toBe(true);
    });
  });
});
