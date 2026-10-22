import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  seedFo,
  seedOrder,
  seedWorld,
  World,
} from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedDispatchedParcel } from '../line-quantities/__support__/shipment-facts.fixtures';
import { recordSalesOrderCancellation } from '../cancellation-record/record-cancellation';
import { seedCancellableOrder, wireCancellation } from '../cancellation-record/__support__/cancellation-scenarios';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * 취소 엔진의 «이미 취소된 수량»은 라인 수량 문(`readLineQuantities().canceled`)에서 읽는다 (K6 PR2a).
 * 옛 파서는 partial 취소의 `metadata.cancelledLines` 만 셌다 — 전체취소도 세게 되면서 거절 순서·문구가 바뀌지 않는지 고정한다.
 */
describeIfDb('SalesOrdersService 취소 엔진 — 이미 취소된 수량 읽기 (K6 PR2a)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('plan after a full cancellation keeps the full-exists message', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 2);
      // 판매주문 status 는 그대로 두고 전체취소 «기록»만 남긴다 — V2 전체 + 남은 출고분처럼 SO 가 cancelled 가 아닌 상태.
      await recordSalesOrderCancellation(
        tx,
        {
          salesOrderId: o.salesOrderId,
          cancellationScope: 'full',
          cancelledBy: 'naver',
        },
        null,
      );

      const planning = w.salesOrders.planCancellation(o.salesOrderId, undefined, tx);

      await expect(planning).rejects.toThrow(BadRequestException);
      await expect(planning).rejects.toThrow('이미 전체 취소 처리된 주문입니다.');
    });
  });

  it('partial remaining counts every prior cancellation', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const o = await seedCancellableOrder(tx, w, 3);
      await w.salesOrders.cancel(
        o.salesOrderId,
        { lines: [{ salesOrderLineId: o.lineId, quantity: 2 }], cancelledBy: 'naver' },
        tx,
      );

      const request = [{ salesOrderLineId: o.lineId, quantity: 2 }];
      const message = '취소 수량(2개)이 취소 가능 수량(1개)을 초과합니다.';
      const planning = w.salesOrders.planCancellation(o.salesOrderId, request, tx);
      await expect(planning).rejects.toThrow(BadRequestException);
      await expect(planning).rejects.toThrow(message);
      await expect(w.salesOrders.cancel(o.salesOrderId, { lines: request, cancelledBy: 'naver' }, tx)).rejects.toThrow(
        message,
      );
    });
  });
});

type SetComponent = { skuId: string; foItemId: string; shipmentId: string; shipmentLineId: string; qty: number };

/** V2 세트 라인 — 구성 SKU 마다 FOI 하나(qty = 라인 수량 × 1개당 수량)를 두고 상자(draft)에 담는다. 구성은 FO 생성처럼 굳힌다. */
async function seedV2SetOrder(
  tx: DbTx,
  args: { quantity: number; qtyPerUnit: number[]; boxPerComponent?: boolean },
): Promise<{ w: World; order: { salesOrderId: string; lineId: string }; components: SetComponent[] }> {
  const w = await seedWorld(tx);
  const order = await seedOrder(tx, { quantity: args.quantity });
  const totalQty = args.qtyPerUnit.reduce((total, perUnit) => total + perUnit * args.quantity, 0);
  const [fo] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({ salesOrderId: order.salesOrderId, warehouseId: w.warehouseId, status: 'ready', totalQty })
    .returning();
  const newBox = async () => {
    const [box] = await tx
      .insert(wmsTables.shipments)
      .values({ warehouseId: w.warehouseId, status: 'draft', openedAt: new Date() })
      .returning();
    return box.id;
  };
  const sharedBoxId = args.boxPerComponent ? null : await newBox();
  const components: SetComponent[] = [];
  for (const [index, qtyPerUnit] of args.qtyPerUnit.entries()) {
    const skuId =
      index === 0
        ? w.skuId
        : (
            await tx
              .insert(wmsTables.skus)
              .values({ name: `set-${index}`, code: `SET-${randomUUID().toUpperCase()}`, holderId: w.holderId })
              .returning()
          )[0].id;
    const qty = qtyPerUnit * args.quantity;
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fo.id,
        salesOrderId: order.salesOrderId,
        salesOrderLineId: order.lineId,
        skuId,
        qty,
      })
      .returning();
    await tx.insert(wmsTables.salesOrderLineCompositions).values({ salesOrderLineId: order.lineId, skuId, qtyPerUnit });
    const shipmentId = sharedBoxId ?? (await newBox());
    const [shipmentLine] = await tx
      .insert(wmsTables.shipmentLines)
      .values({ shipmentId, fulfillmentOrderItemId: item.id, skuId, qty })
      .returning();
    components.push({ skuId, foItemId: item.id, shipmentId, shipmentLineId: shipmentLine.id, qty });
  }
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ compositionSource: 'matching', compositionSetAt: new Date() })
    .where(eq(wmsTables.salesOrderLines.id, order.lineId));
  return { w, order, components };
}

async function foItemQty(tx: DbTx, foItemId: string): Promise<number> {
  const [item] = await tx
    .select({ qty: wmsTables.fulfillmentOrderItems.qty })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.id, foItemId));
  return item.qty;
}

/**
 * 취소 엔진의 남은·취소 가능·출고 수량은 라인 수량 문(`readLineQuantities` 의 `remaining`·`skus`)에서 읽는다 (K6 PR2b).
 * V2 전체 재계획은 `cancellableSalesUnits`, V1 의 출고 수량은 FOI `shipped_qty` 하나다(P7).
 */
describeIfDb('SalesOrdersService 취소 엔진 — 남은·취소 가능·출고 수량 (K6 PR2b)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  it('v2 full replan cancels the cancellable units of a set line', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const { order } = await seedV2SetOrder(tx, { quantity: 2, qtyPerUnit: [1, 2] });

      const plan = await w.salesOrders.planCancellation(order.salesOrderId, undefined, tx);

      expect(plan.lines).toEqual([{ salesOrderLineId: order.lineId, quantity: 2 }]);
    });
  });

  it('v2 full includes the remaining of an outsourced line', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const { order } = await seedV2SetOrder(tx, { quantity: 2, qtyPerUnit: [1, 2] });
      const [printLine] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: order.salesOrderId,
          variantId: randomUUID(),
          productName: 'IT Print',
          quantity: 1,
          unitPrice: 1000,
          almondDesignId: randomUUID(),
        })
        .returning();

      const plan = await w.salesOrders.planCancellation(order.salesOrderId, undefined, tx);

      // 인쇄 라인은 창고 항목이 없어 상자 배분 없이 남은 판매 수량(1)만 들어간다 — 출고 정리는 세트 라인 몫뿐이다
      expect(plan.lines).toHaveLength(2);
      expect(plan.lines).toEqual(
        expect.arrayContaining([
          { salesOrderLineId: order.lineId, quantity: 2 },
          { salesOrderLineId: printLine.id, quantity: 1 },
        ]),
      );
      expect(plan.hasShippedQuantity).toBe(false);
    });
  });

  it('v2 full on a half-shipped bundle is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const {
        w: world,
        order,
        components,
      } = await seedV2SetOrder(tx, {
        quantity: 1,
        qtyPerUnit: [1, 1],
        boxPerComponent: true,
      });
      const [a] = components;
      await seedDispatchedParcel(tx, world, {
        shipmentId: a.shipmentId,
        lines: [{ shipmentLineId: a.shipmentLineId, foItemId: a.foItemId, qty: a.qty }],
      });

      const planning = w.salesOrders.planCancellation(order.salesOrderId, undefined, tx);

      await expect(planning).rejects.toThrow(ConflictException);
      await expect(planning).rejects.toThrow(
        `V2 component progress is inconsistent for SalesOrder line ${order.lineId}`,
      );
    });
  });

  it('v1 partial ignores a shipped fo flag without item shipped qty', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const world = await seedWorld(tx);
      const order = await seedOrder(tx, { quantity: 2 });
      const { foId, foItemId } = await seedFo(tx, world, order, { qty: 2 });
      // FO 에 출고 시각만 찍히고 FOI shipped_qty 는 0 — 옛 엔진은 FO 표시로 FOI 전량을 출고로 보고 보존 효과만 남겼다(P7).
      // FO status 는 취소 가능한 ready 로 둔다 — status='shipped' 는 FO 상태 규칙이 FOI 를 줄이지 못하게 막는다(아래 시나리오)
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ shippedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, foId));

      await w.salesOrders.cancel(
        order.salesOrderId,
        { lines: [{ salesOrderLineId: order.lineId, quantity: 1 }], cancelledBy: 'naver' },
        tx,
      );

      expect(await foItemQty(tx, foItemId)).toBe(1);
    });
  });

  it('v1 partial of a shipped status fo without item shipped qty is refused', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const world = await seedWorld(tx);
      const order = await seedOrder(tx, { quantity: 2 });
      const { foId, foItemId } = await seedFo(tx, world, order, { qty: 2 });
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped', shippedAt: new Date() })
        .where(eq(wmsTables.fulfillmentOrders.id, foId));

      // FO status 가 취소 불가라 줄일 수 있는 미처리분이 0 이고, 출고 수량(FOI shipped_qty)도 0 이라 «출고 뒤 취소»로 넘길 몫도 없다.
      // 옛 엔진은 FO 표시를 출고로 보고 보존 효과만 남겼다 — P7 뒤엔 반품/회수로 돌린다(배포 전 G-a 가 이런 FO 0 건을 확인한다)
      await expect(
        w.salesOrders.cancel(
          order.salesOrderId,
          { lines: [{ salesOrderLineId: order.lineId, quantity: 1 }], cancelledBy: 'naver' },
          tx,
        ),
      ).rejects.toThrow('이미 피킹 또는 출고 처리된 상태입니다');
      expect(await foItemQty(tx, foItemId)).toBe(2);
    });
  });

  it('admin v1 cancel of a forwarded drop-ship still reduces items', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const world = await seedWorld(tx);
      const order = await seedOrder(tx, { quantity: 2 });
      // 파트너에게 넘겼을 뿐 출고가 아니다 — 넘긴 뒤에도 취소가 FOI 를 줄여야 한다
      const { foItemId } = await seedFo(tx, world, order, { qty: 2, dropShip: 'forwarded' });

      await w.salesOrders.cancel(
        order.salesOrderId,
        { lines: [{ salesOrderLineId: order.lineId, quantity: 1 }], cancelledBy: 'admin' },
        tx,
      );

      expect(await foItemQty(tx, foItemId)).toBe(1);
    });
  });
});
