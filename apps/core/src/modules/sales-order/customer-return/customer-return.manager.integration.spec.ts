import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import type {
  ChannelReturnCancelledPayload,
  ChannelReturnRequestedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from '../../fulfillment/services/__support__';
import { seedHolder, seedSku } from '../../fulfillment/services/__support__/logistics-fixtures';
import { seedOrder } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { CustomerReturnManager } from './customer-return.manager';
import { newPickupRow } from './customer-return-pickup.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 아웃박스 적재 호출을 모아 두는 발행자 — 실제 아웃박스 대신 payload 를 본다. */
function makeManager(tx: DbTx) {
  const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const dbService = { run: <T>(fn: (trx: DbTx) => Promise<T>, outer?: DbTx) => fn(outer ?? tx) };
  const manager = new CustomerReturnManager(dbService as never, publisher as never);
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
