import { randomUUID } from 'crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import type {
  ChannelReturnCancelledPayload,
  ChannelReturnRequestedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedHolder, seedSku } from '../../fulfillment/services/__support__/logistics-fixtures';
import { seedOrder, seedWorld } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { findCompositionInvariantViolations } from '../../product-matching/line-composition/__support__/composition-invariant';
import { seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { CustomerReturnManager } from './customer-return.manager';
import { newPickupRow } from './customer-return-pickup.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 아웃박스 적재 호출을 모아 두는 발행자 — 실제 아웃박스 대신 payload 를 본다. */
function makeManager(tx: DbTx) {
  const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const dbService = { run: <T>(fn: (trx: DbTx) => Promise<T>, outer?: DbTx) => fn(outer ?? tx) };
  const manager = new CustomerReturnManager(
    dbService as never,
    publisher as never,
    new LineCompositionManager(dbService as never),
  );
  const events = () =>
    (
      publisher.enqueue.mock.calls as Array<
        [{ eventType: string; idempotencyKey: string; payload: Record<string, unknown> }]
      >
    ).map(([params]) => params);
  return { manager, events };
}

describeIfDb('CustomerReturnManager — 채널 반품 사실 기록 (K8 PR5)', () => {
  jest.setTimeout(60_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  async function seed(tx: DbTx, quantity = 2) {
    const order = await seedOrder(tx, { quantity });
    const channelOrderItemId = `item_${randomUUID().slice(0, 8)}`;
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId })
      .where(eq(wmsTables.salesOrderLines.id, order.lineId));
    const [so] = await tx
      .update(wmsTables.salesOrders)
      .set({ customerId: randomUUID() })
      .where(eq(wmsTables.salesOrders.id, order.salesOrderId))
      .returning();
    // 반품 접수는 굳은 구성이 있는 줄만 받는다(N3) — 기본은 SKU 하나 × 1
    const { holderId } = await seedHolder(tx);
    const sku = await seedSku(tx, holderId);
    await tx
      .insert(wmsTables.salesOrderLineCompositions)
      .values({ salesOrderLineId: order.lineId, skuId: sku.skuId, qtyPerUnit: 1 });
    // 구성 행이 있으면 출처도 있다(#1063 §4.3) — 실제 FO 생성이 굳힌 모양
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ compositionSource: 'matching', compositionSetAt: new Date() })
      .where(eq(wmsTables.salesOrderLines.id, order.lineId));
    return { ...order, channelOrderItemId, channelOrderId: so.channelOrderId, skuId: sku.skuId, holderId };
  }

  function requested(
    s: { channelOrderId: string; channelOrderItemId: string },
    over: Partial<ChannelReturnRequestedPayload> = {},
  ): ChannelReturnRequestedPayload {
    return {
      orderId: 'ignored',
      salesChannel: 'medusa',
      externalOrderId: s.channelOrderId,
      returnId: `ret_${randomUUID().slice(0, 8)}`,
      requestId: `req_${randomUUID().slice(0, 8)}`,
      reason: 'defective',
      feeBearer: 'seller',
      requestedBy: 'customer',
      requestedAt: '2026-10-27T01:00:00.000Z',
      items: [{ channelOrderItemId: s.channelOrderItemId, quantity: 1 }],
      ...over,
    };
  }

  function cancelled(s: { channelOrderId: string }, returnId: string): ChannelReturnCancelledPayload {
    return {
      orderId: 'ignored',
      salesChannel: 'medusa',
      externalOrderId: s.channelOrderId,
      returnId,
      cancelledAt: '2026-10-27T02:00:00.000Z',
    };
  }

  const returnsOf = (tx: DbTx, salesOrderId: string) =>
    tx.select().from(wmsTables.customerReturns).where(eq(wmsTables.customerReturns.salesOrderId, salesOrderId));
  const linesOf = (tx: DbTx, customerReturnId: string) =>
    tx
      .select()
      .from(wmsTables.customerReturnLines)
      .where(eq(wmsTables.customerReturnLines.customerReturnId, customerReturnId));

  it('requested → expected 기록 1 + 줄 + 접수 이벤트 1', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager, events } = makeManager(tx);
      const fact = requested(s);

      const result = await manager.recordRequested(fact, tx);

      expect(result.created).toBe(true);
      const [record] = await returnsOf(tx, s.salesOrderId);
      expect(record).toEqual(
        expect.objectContaining({
          id: result.customerReturnId,
          status: 'expected',
          channelReturnId: fact.returnId,
          channelRequestId: fact.requestId,
          reason: 'defective',
          feeBearer: 'seller',
          requestedBy: 'customer',
          windowOverrideReason: null,
        }),
      );
      expect(record.requestedAt.toISOString()).toBe(fact.requestedAt);
      expect(await linesOf(tx, record.id)).toEqual([
        expect.objectContaining({ salesOrderLineId: s.lineId, channelOrderItemId: s.channelOrderItemId, quantity: 1 }),
      ]);
      const [event, ...rest] = events();
      expect(rest).toHaveLength(0);
      expect(event.eventType).toBe('SalesOrderClaimProgressed');
      expect(event.idempotencyKey).toBe(`so-claim:return:${record.id}:requested`);
      expect(event.payload).toMatchObject({
        kind: 'return',
        stage: 'requested',
        requestId: record.id,
        requestedBy: 'customer',
        orderId: s.salesOrderId,
      });
    });
  });

  it('접수가 SKU 항목을 만든다 — 세트 A×2·B×1 줄 1벌이면 A 2·B 1', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const a = s.skuId;
      const b = (await seedSku(tx, s.holderId)).skuId;
      await tx
        .update(wmsTables.salesOrderLineCompositions)
        .set({ qtyPerUnit: 2 })
        .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, s.lineId));
      await tx
        .insert(wmsTables.salesOrderLineCompositions)
        .values({ salesOrderLineId: s.lineId, skuId: b, qtyPerUnit: 1 });
      const { manager } = makeManager(tx);

      const result = await manager.recordRequested(requested(s), tx);

      const [line] = await linesOf(tx, result.customerReturnId);
      const items = await tx
        .select()
        .from(wmsTables.customerReturnItems)
        .where(eq(wmsTables.customerReturnItems.customerReturnLineId, line.id));
      expect(
        items.map((i) => [i.skuId, i.qtyPerUnit, i.expectedQty, i.acceptedQty, i.rejectedQty, i.heldQty]).sort(),
      ).toEqual(
        [
          [a, 2, 2, null, null, null],
          [b, 1, 1, null, null, null],
        ].sort(),
      );
    });
  });

  it('구성 없는 줄이 섞인 접수 → BadRequestError, 기록·줄·항목·이벤트 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const bare = await seedOrder(tx, { quantity: 1 });
      const bareItem = `item_${randomUUID().slice(0, 8)}`;
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: bareItem, salesOrderId: s.salesOrderId })
        .where(eq(wmsTables.salesOrderLines.id, bare.lineId));
      const { manager, events } = makeManager(tx);

      await expect(
        manager.recordRequested(
          requested(s, {
            items: [
              { channelOrderItemId: s.channelOrderItemId, quantity: 1 },
              { channelOrderItemId: bareItem, quantity: 1 },
            ],
          }),
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);

      expect(await returnsOf(tx, s.salesOrderId)).toHaveLength(0);
      expect(await tx.select().from(wmsTables.customerReturnLines)).toEqual([]);
      expect(await tx.select().from(wmsTables.customerReturnItems)).toEqual([]);
      expect(events()).toHaveLength(0);
    });
  });

  it('같은 사실 두 번 → 기록 1·줄 1·이벤트 1, 두 번째 created false', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager, events } = makeManager(tx);
      const fact = requested(s);

      const first = await manager.recordRequested(fact, tx);
      const second = await manager.recordRequested(fact, tx);

      expect(second).toEqual({ customerReturnId: first.customerReturnId, created: false });
      expect(await returnsOf(tx, s.salesOrderId)).toHaveLength(1);
      expect(await linesOf(tx, first.customerReturnId)).toHaveLength(1);
      expect(events()).toHaveLength(1);
    });
  });

  it('operator 접수는 requestedBy admin, windowOverrideReason 저장', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager, events } = makeManager(tx);

      const result = await manager.recordRequested(
        requested(s, { requestedBy: 'operator', windowOverrideReason: '고객센터 예외 승인' }),
        tx,
      );

      const [record] = await returnsOf(tx, s.salesOrderId);
      expect(record).toEqual(
        expect.objectContaining({
          id: result.customerReturnId,
          requestedBy: 'operator',
          windowOverrideReason: '고객센터 예외 승인',
        }),
      );
      expect(events()[0].payload).toEqual(expect.objectContaining({ requestedBy: 'admin' }));
    });
  });

  it('모르는 Medusa 줄 → BadRequestError, 아무것도 안 씀', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager, events } = makeManager(tx);

      await expect(
        manager.recordRequested(requested(s, { items: [{ channelOrderItemId: 'item_unknown', quantity: 1 }] }), tx),
      ).rejects.toBeInstanceOf(BadRequestError);
      await expect(
        manager.recordRequested(
          requested(s, { items: [{ channelOrderItemId: s.channelOrderItemId, quantity: 3 }] }),
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);

      expect(await returnsOf(tx, s.salesOrderId)).toHaveLength(0);
      expect(events()).toHaveLength(0);
    });
  });

  it('이미 기록된 사실의 재전달은 주문이 바뀌었어도 created false', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager, events } = makeManager(tx);
      const fact = requested(s);
      const first = await manager.recordRequested(fact, tx);
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: 'item_changed' })
        .where(eq(wmsTables.salesOrderLines.id, s.lineId));

      const again = await manager.recordRequested(fact, tx);

      expect(again).toEqual({ customerReturnId: first.customerReturnId, created: false });
      expect(await returnsOf(tx, s.salesOrderId)).toHaveLength(1);
      expect(events()).toHaveLength(1);
    });
  });

  it('같은 줄이 items 에 두 번 → BadRequestError, 아무것도 안 씀', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager, events } = makeManager(tx);
      const item = { channelOrderItemId: s.channelOrderItemId, quantity: 1 };

      await expect(manager.recordRequested(requested(s, { items: [item, item] }), tx)).rejects.toBeInstanceOf(
        BadRequestError,
      );

      expect(await returnsOf(tx, s.salesOrderId)).toHaveLength(0);
      expect(events()).toHaveLength(0);
    });
  });

  it('모르는 주문 → NotFoundError', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager } = makeManager(tx);

      await expect(manager.recordRequested(requested(s, { externalOrderId: 'order_nope' }), tx)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  it('cancelled → status cancelled·cancelledAt, 두 번째는 changed false', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager } = makeManager(tx);
      const fact = requested(s);
      const { customerReturnId } = await manager.recordRequested(fact, tx);

      const first = await manager.recordCancelled(cancelled(s, fact.returnId), tx);
      const second = await manager.recordCancelled(cancelled(s, fact.returnId), tx);

      expect(first).toEqual({ customerReturnId, changed: true });
      expect(second).toEqual({ customerReturnId, changed: false });
      const [record] = await returnsOf(tx, s.salesOrderId);
      expect(record.status).toBe('cancelled');
      expect(record.cancelledAt?.toISOString()).toBe('2026-10-27T02:00:00.000Z');
    });
  });

  it('기록 없는 cancelled → NotFoundError', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager } = makeManager(tx);

      await expect(manager.recordCancelled(cancelled(s, 'ret_missing'), tx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('requested 직후 cancelled(Review Focus 1) → cancelled, 접수 이벤트 1', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager, events } = makeManager(tx);
      const fact = requested(s);

      await manager.recordRequested(fact, tx);
      await manager.recordCancelled(cancelled(s, fact.returnId), tx);

      const [record] = await returnsOf(tx, s.salesOrderId);
      expect(record.status).toBe('cancelled');
      expect(events()).toHaveLength(1);
    });
  });

  it('arrived 인 기록의 cancelled → ConflictError, 상태 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const s = await seed(tx);
      const { manager } = makeManager(tx);
      const fact = requested(s);
      const { customerReturnId } = await manager.recordRequested(fact, tx);
      await tx
        .update(wmsTables.customerReturns)
        .set({ status: 'arrived' })
        .where(eq(wmsTables.customerReturns.id, customerReturnId));

      await expect(manager.recordCancelled(cancelled(s, fact.returnId), tx)).rejects.toBeInstanceOf(ConflictError);

      const [record] = await returnsOf(tx, s.salesOrderId);
      expect(record.status).toBe('arrived');
      expect(record.cancelledAt).toBeNull();
    });
  });

  describe('교환 (K8 PR11)', () => {
    const exchangeLinesOf = (tx: DbTx, salesOrderId: string) =>
      tx
        .select()
        .from(wmsTables.salesOrderLines)
        .where(
          and(
            eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId),
            isNotNull(wmsTables.salesOrderLines.exchangeReturnLineId),
          ),
        );
    const compositionOf = async (tx: DbTx, salesOrderLineId: string) =>
      (
        await tx
          .select({
            skuId: wmsTables.salesOrderLineCompositions.skuId,
            qtyPerUnit: wmsTables.salesOrderLineCompositions.qtyPerUnit,
          })
          .from(wmsTables.salesOrderLineCompositions)
          .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, salesOrderLineId))
      ).sort((a, b) => a.skuId.localeCompare(b.skuId));

    it('교환 접수 사실 → kind exchange, 같은 판매주문에 교환 줄 1개(수량 = 반품 줄, 0원, 채널 줄 없음), 구성 = 원래 줄, 진행 kind exchange', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx, 3);
        await tx
          .update(wmsTables.salesOrderLines)
          .set({ fulfillmentKind: 'physical', requiresShipping: true, channelProductId: 'prod_1' })
          .where(eq(wmsTables.salesOrderLines.id, s.lineId));
        const { manager, events } = makeManager(tx);
        const fact = requested(s, {
          kind: 'exchange',
          items: [{ channelOrderItemId: s.channelOrderItemId, quantity: 2 }],
        });

        const result = await manager.recordRequested(fact, tx);

        const [record] = await returnsOf(tx, s.salesOrderId);
        expect(record).toMatchObject({ id: result.customerReturnId, kind: 'exchange', exchangeReleasedAt: null });
        const [returnLine] = await linesOf(tx, record.id);
        const [source] = await tx
          .select()
          .from(wmsTables.salesOrderLines)
          .where(eq(wmsTables.salesOrderLines.id, s.lineId));
        const exchangeLines = await exchangeLinesOf(tx, s.salesOrderId);
        expect(exchangeLines).toHaveLength(1);
        expect(exchangeLines[0]).toMatchObject({
          salesOrderId: s.salesOrderId,
          variantId: source.variantId,
          productName: source.productName,
          fulfillmentKind: 'physical',
          requiresShipping: true,
          channelProductId: 'prod_1',
          quantity: 2,
          unitPrice: 0,
          totalPrice: 0,
          channelOrderItemId: null,
          exchangeReturnLineId: returnLine.id,
          compositionSource: 'matching',
        });
        expect(exchangeLines[0].id).not.toBe(s.lineId);
        expect(await compositionOf(tx, exchangeLines[0].id)).toEqual(await compositionOf(tx, s.lineId));
        expect(await findCompositionInvariantViolations(tx)).toEqual([]);
        const [event, ...rest] = events();
        expect(rest).toHaveLength(0);
        expect(event.idempotencyKey).toBe(`so-claim:exchange:${record.id}:requested`);
        expect(event.payload).toMatchObject({ kind: 'exchange', stage: 'requested', requestId: record.id });
      });
    });

    it('원래 줄이 세트(구성 2 SKU) → 교환 줄 구성 2행, qty_per_unit 같음', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const b = (await seedSku(tx, s.holderId)).skuId;
        await tx
          .update(wmsTables.salesOrderLineCompositions)
          .set({ qtyPerUnit: 2 })
          .where(eq(wmsTables.salesOrderLineCompositions.salesOrderLineId, s.lineId));
        await tx
          .insert(wmsTables.salesOrderLineCompositions)
          .values({ salesOrderLineId: s.lineId, skuId: b, qtyPerUnit: 1 });
        const { manager } = makeManager(tx);

        await manager.recordRequested(requested(s, { kind: 'exchange' }), tx);

        const [exchangeLine] = await exchangeLinesOf(tx, s.salesOrderId);
        const copied = await compositionOf(tx, exchangeLine.id);
        expect(copied).toHaveLength(2);
        expect(copied).toEqual(
          [
            { skuId: s.skuId, qtyPerUnit: 2 },
            { skuId: b, qtyPerUnit: 1 },
          ].sort((x, y) => x.skuId.localeCompare(y.skuId)),
        );
      });
    });

    it('운영자가 지정한 구성은 출처·지정자까지 복사한다', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const actorId = randomUUID();
        await tx
          .update(wmsTables.salesOrderLines)
          .set({ compositionSource: 'operator', compositionSetBy: actorId })
          .where(eq(wmsTables.salesOrderLines.id, s.lineId));
        const { manager } = makeManager(tx);

        await manager.recordRequested(requested(s, { kind: 'exchange' }), tx);

        const [exchangeLine] = await exchangeLinesOf(tx, s.salesOrderId);
        expect(exchangeLine).toMatchObject({ compositionSource: 'operator', compositionSetBy: actorId });
        expect(exchangeLine.compositionSetAt).toBeInstanceOf(Date);
      });
    });

    it('kind 없는 사실 → kind return, 교환 줄 0', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager, events } = makeManager(tx);

        await manager.recordRequested(requested(s), tx);

        const [record] = await returnsOf(tx, s.salesOrderId);
        expect(record.kind).toBe('return');
        expect(await exchangeLinesOf(tx, s.salesOrderId)).toHaveLength(0);
        expect(events()[0].payload).toMatchObject({ kind: 'return' });
      });
    });

    it('같은 교환 사실 재전달 → 교환 줄 그대로 1개, 이벤트 1', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager, events } = makeManager(tx);
        const fact = requested(s, { kind: 'exchange' });

        const first = await manager.recordRequested(fact, tx);
        const second = await manager.recordRequested(fact, tx);

        expect(second).toEqual({ customerReturnId: first.customerReturnId, created: false });
        expect(await exchangeLinesOf(tx, s.salesOrderId)).toHaveLength(1);
        expect(events()).toHaveLength(1);
      });
    });

    it('원래 줄이 굳지 않았으면(출처 없음) 교환 접수 → BadRequestError, 아무것도 안 씀', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        await tx
          .update(wmsTables.salesOrderLines)
          .set({ compositionSource: null, compositionSetAt: null })
          .where(eq(wmsTables.salesOrderLines.id, s.lineId));
        const { manager, events } = makeManager(tx);

        await expect(manager.recordRequested(requested(s, { kind: 'exchange' }), tx)).rejects.toBeInstanceOf(
          BadRequestError,
        );

        expect(await returnsOf(tx, s.salesOrderId)).toHaveLength(0);
        expect(await exchangeLinesOf(tx, s.salesOrderId)).toHaveLength(0);
        expect(events()).toHaveLength(0);
      });
    });

    it('교환 취소 사실(열기 전) → cancelled, 교환 줄 0, 그 구성 0', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s, { kind: 'exchange' });
        await manager.recordRequested(fact, tx);
        const [exchangeLine] = await exchangeLinesOf(tx, s.salesOrderId);

        const result = await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        expect(result.changed).toBe(true);
        const [record] = await returnsOf(tx, s.salesOrderId);
        expect(record.status).toBe('cancelled');
        expect(await exchangeLinesOf(tx, s.salesOrderId)).toHaveLength(0);
        expect(await compositionOf(tx, exchangeLine.id)).toEqual([]);
        // 원래 줄은 그대로다
        expect(await compositionOf(tx, s.lineId)).toEqual([{ skuId: s.skuId, qtyPerUnit: 1 }]);
        expect(await findCompositionInvariantViolations(tx)).toEqual([]);
      });
    });

    it('교환 취소 사실(교환 상자 열림) → ConflictError, 상태·교환 줄 그대로', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s, { kind: 'exchange' });
        const { customerReturnId } = await manager.recordRequested(fact, tx);
        await tx
          .update(wmsTables.customerReturns)
          .set({ exchangeReleasedAt: new Date(), exchangeReleasedBy: randomUUID() })
          .where(eq(wmsTables.customerReturns.id, customerReturnId));

        await expect(manager.recordCancelled(cancelled(s, fact.returnId), tx)).rejects.toBeInstanceOf(ConflictError);

        const [record] = await returnsOf(tx, s.salesOrderId);
        expect(record.status).toBe('expected');
        expect(record.cancelledAt).toBeNull();
        expect(await exchangeLinesOf(tx, s.salesOrderId)).toHaveLength(1);
      });
    });

    it('K6: 교환 접수 뒤 원래 줄 claimable 이 반품과 같이 준다, 교환 줄은 청구에 안 든다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const line = await seedDeliveredLine(tx, w, {
          quantity: 3,
          composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
          parcels: [{ qtyBySku: { [w.skuId]: 3 } }],
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
        const { manager } = makeManager(tx);
        const s = { channelOrderId: so.channelOrderId, channelOrderItemId };

        await manager.recordRequested(requested(s, { kind: 'exchange' }), tx);
        await manager.recordRequested(requested(s), tx);

        const quantities = await readLineQuantities(tx, line.salesOrderId);
        const original = quantities.get(line.lineId);
        expect(original?.skus).toEqual([
          expect.objectContaining({ skuId: w.skuId, delivered: 3, returnActive: 2, claimable: 1 }),
        ]);
        const [exchangeLine] = await exchangeLinesOf(tx, line.salesOrderId);
        expect(quantities.get(exchangeLine.id)?.skus).toEqual([
          expect.objectContaining({ skuId: w.skuId, delivered: 0, returnActive: 0, claimable: 0 }),
        ]);
      });
    });
  });

  describe('회수 행 (K8 PR9)', () => {
    const pickupsOf = (tx: DbTx, customerReturnId: string) =>
      tx
        .select()
        .from(wmsTables.customerReturnPickups)
        .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));

    it('recordRequested → 회수 행 1개: pending·attempts 0·AR 28자·created_by null', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);

        const { customerReturnId } = await manager.recordRequested(requested(s), tx);

        const rows = await pickupsOf(tx, customerReturnId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(
          expect.objectContaining({ status: 'pending', attempts: 0, carrier: 'HANJIN', createdBy: null }),
        );
        expect(rows[0].custOrdNo).toMatch(/^AR[0-9A-Z]{26}$/);
      });
    });

    it('같은 사실 두 번 → 회수 행 여전히 1개', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);

        const first = await manager.recordRequested(fact, tx);
        await manager.recordRequested(fact, tx);

        expect(await pickupsOf(tx, first.customerReturnId)).toHaveLength(1);
      });
    });

    it('recordCancelled(attempts 0) → void, cancelled_at 없음', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);
        const { customerReturnId } = await manager.recordRequested(fact, tx);

        await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        const [row] = await pickupsOf(tx, customerReturnId);
        expect(row.status).toBe('void');
        expect(row.cancelledAt).toBeNull();
      });
    });

    it('reserved 였던 행 → cancel_pending, next_attempt_at null', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);
        const { customerReturnId } = await manager.recordRequested(fact, tx);
        await tx
          .update(wmsTables.customerReturnPickups)
          .set({ status: 'reserved', attempts: 1, nextAttemptAt: new Date() })
          .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));

        await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        const [row] = await pickupsOf(tx, customerReturnId);
        expect(row.status).toBe('cancel_pending');
        expect(row.nextAttemptAt).toBeNull();
      });
    });

    it('attempts 2 인 pending → cancel_pending', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);
        const { customerReturnId } = await manager.recordRequested(fact, tx);
        await tx
          .update(wmsTables.customerReturnPickups)
          .set({ attempts: 2 })
          .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));

        await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        const [row] = await pickupsOf(tx, customerReturnId);
        expect(row.status).toBe('cancel_pending');
      });
    });

    it('리스가 살아 있는 pending(attempts 0) → cancel_pending (워커가 보내는 중일 수 있다)', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);
        const { customerReturnId } = await manager.recordRequested(fact, tx);
        await tx
          .update(wmsTables.customerReturnPickups)
          .set({ leaseUntil: new Date(Date.now() + 60_000) })
          .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));

        await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        const [row] = await pickupsOf(tx, customerReturnId);
        expect(row.status).toBe('cancel_pending');
      });
    });

    it.each([
      ['attempts_exhausted: unknown_outcome: transport_error', 12],
      ['ERROR-03: 주문번호 중복', 1],
    ])(
      '예약이 남았을 수 있는 failed(%s, attempts %i) → cancel_pending, next_attempt_at null (R9)',
      async (lastError, attempts) => {
        await inRollbackTx(db, async (tx) => {
          const s = await seed(tx);
          const { manager } = makeManager(tx);
          const fact = requested(s);
          const { customerReturnId } = await manager.recordRequested(fact, tx);
          await tx
            .update(wmsTables.customerReturnPickups)
            .set({ status: 'failed', attempts, lastError, nextAttemptAt: new Date() })
            .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));

          await manager.recordCancelled(cancelled(s, fact.returnId), tx);

          const [row] = await pickupsOf(tx, customerReturnId);
          expect(row).toMatchObject({ status: 'cancel_pending', nextAttemptAt: null, attempts, lastError });
        });
      },
    );

    it('주소가 없어 못 보낸 failed(no_pickup_address:) 는 그대로 — 한진에 아무것도 없다', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);
        const { customerReturnId } = await manager.recordRequested(fact, tx);
        await tx
          .update(wmsTables.customerReturnPickups)
          .set({ status: 'failed', attempts: 1, lastError: 'no_pickup_address: no delivered shipment' })
          .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));

        await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        const [row] = await pickupsOf(tx, customerReturnId);
        expect(row.status).toBe('failed');
      });
    });

    it('마지막 행이 아닌 옛 failed 는 건드리지 않는다 — 마지막 행이 cancelled 면 그대로', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);
        const { customerReturnId } = await manager.recordRequested(fact, tx);
        await tx
          .update(wmsTables.customerReturnPickups)
          .set({
            status: 'failed',
            attempts: 12,
            lastError: 'attempts_exhausted: x',
            createdAt: new Date('2026-10-01T00:00:00Z'),
          })
          .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));
        await tx
          .insert(wmsTables.customerReturnPickups)
          .values({ ...newPickupRow(customerReturnId, 'cs-1'), status: 'cancelled', attempts: 1 });

        await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        const rows = await pickupsOf(tx, customerReturnId);
        expect(rows.map((r) => r.status).sort()).toEqual(['cancelled', 'failed']);
      });
    });

    it('활성 행이 없으면(failed) recordCancelled 는 회수 행을 건드리지 않는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const fact = requested(s);
        const { customerReturnId } = await manager.recordRequested(fact, tx);
        await tx
          .update(wmsTables.customerReturnPickups)
          .set({ status: 'failed', lastError: 'x' })
          .where(eq(wmsTables.customerReturnPickups.customerReturnId, customerReturnId));

        await manager.recordCancelled(cancelled(s, fact.returnId), tx);

        const [row] = await pickupsOf(tx, customerReturnId);
        expect(row.status).toBe('failed');
        expect(row.lastError).toBe('x');
      });
    });

    it('같은 반품에 활성 행 둘 → unique 위반', async () => {
      await inRollbackTx(db, async (tx) => {
        const s = await seed(tx);
        const { manager } = makeManager(tx);
        const { customerReturnId } = await manager.recordRequested(requested(s), tx);
        const extra = newPickupRow(customerReturnId, null);

        await expect(tx.insert(wmsTables.customerReturnPickups).values(extra)).rejects.toThrow();
      });
    });
  });
});
