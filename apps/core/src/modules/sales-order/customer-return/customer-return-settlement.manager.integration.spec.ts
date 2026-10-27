import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '@app/shared';
import type {
  ChannelReturnSettledPayload,
  ChannelReturnSettlementFailedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../../fulfillment/services/__support__';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import { CustomerReturnReceivingManager } from './customer-return-receiving.manager';
import {
  CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES,
  CUSTOMER_RETURN_SETTLEMENT_RETRY_MS,
  CustomerReturnSettlementManager,
} from './customer-return-settlement.manager';
import type { CustomerReturnSettlement } from './customer-return.types';

/**
 * 반품 정산 결과·실패·재발행 (K8 PR6 Task 9). 픽스처는 Task 7 의 도착·검수 명령으로 `inspected` 까지 간다.
 * 원장은 실제 InventoryCommandService 로 쓰고, 두 발행자(고객 이벤트·채널 명령)는 적재 호출만 모은다.
 *
 * 실행: DATABASE_URL=<scratch core DB> npx jest apps/core/src/modules/sales-order/customer-return --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type Enqueued = { eventType: string; idempotencyKey: string; partitionKey?: string; payload: Record<string, unknown> };

function recorder() {
  const publisher = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const calls = () => (publisher.enqueue.mock.calls as Array<[Enqueued]>).map(([params]) => params);
  return { publisher, calls };
}

describeIfDb('CustomerReturnSettlementManager — 반품 정산 결과·재발행 (K8 PR6)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  const dbService = makeDbService(db);
  const { command, location } = wireLogistics(dbService);
  afterAll(async () => {
    await client.end();
  });

  function wire() {
    const coreOrders = recorder();
    const commands = recorder();
    const reader = new CustomerReturnReader(dbService);
    const intake = new CustomerReturnManager(dbService, coreOrders.publisher as never);
    const receiving = new CustomerReturnReceivingManager(
      dbService,
      reader,
      command,
      coreOrders.publisher as never,
      commands.publisher as never,
    );
    const settlement = new CustomerReturnSettlementManager(
      dbService,
      coreOrders.publisher as never,
      commands.publisher as never,
    );
    const eventsOf = (type: string) => coreOrders.calls().filter((e) => e.eventType === type);
    return { intake, receiving, settlement, eventsOf, commands: commands.calls };
  }

  type Wired = ReturnType<typeof wire>;

  /** 배송완료 단품 2개 → 2개 반품 → 전부 도착 → 양품 2 검수(`inspected`, 명령 issue 1) */
  async function seedInspected(tx: DbTx, w: World, wired: Wired) {
    await location.ensureSystemLocations(w.warehouseId, tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity: 2,
      composition: [{ skuId: w.skuId, qtyPerUnit: 1 }],
      parcels: [{ qtyBySku: { [w.skuId]: 2 } }],
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
        reason: 'change_of_mind',
        feeBearer: 'customer',
        requestedBy: 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items: [{ channelOrderItemId, quantity: 2 }],
      },
      tx,
    );
    const [item] = await tx
      .select({ id: wmsTables.customerReturnItems.id })
      .from(wmsTables.customerReturnItems)
      .innerJoin(
        wmsTables.customerReturnLines,
        eq(wmsTables.customerReturnLines.id, wmsTables.customerReturnItems.customerReturnLineId),
      )
      .where(eq(wmsTables.customerReturnLines.customerReturnId, customerReturnId));
    await wired.receiving.recordArrival(
      {
        customerReturnId,
        warehouseId: w.warehouseId,
        items: [{ customerReturnItemId: item.id, quantity: 2 }],
        idempotencyKey: `all-${randomUUID()}`,
        actorId: 'admin-1',
      },
      tx,
    );
    await wired.receiving.recordInspection(
      {
        customerReturnId,
        items: [{ customerReturnItemId: item.id, accepted: 2, rejected: 0, held: 0 }],
        actorId: 'admin-1',
      },
      tx,
    );
    return {
      salesOrderId: line.salesOrderId,
      lineId: line.lineId,
      channelOrderItemId,
      channelOrderId: so.channelOrderId,
      channelReturnId,
      customerReturnId,
    };
  }

  type Seeded = Awaited<ReturnType<typeof seedInspected>>;

  const settledFact = (
    s: Seeded,
    overrides: Partial<ChannelReturnSettledPayload> = {},
  ): ChannelReturnSettledPayload => ({
    orderId: s.channelOrderId,
    salesChannel: 'medusa',
    externalOrderId: s.channelOrderId,
    returnId: s.channelReturnId,
    requestId: s.customerReturnId,
    refundAmount: 7000,
    deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0 },
    feeNotAdjusted: false,
    refundMode: 'auto',
    settledAt: '2026-10-27T03:00:00.000Z',
    items: [{ channelOrderItemId: s.channelOrderItemId, received: 2, dismissed: 0 }],
    ...overrides,
  });

  const failedFact = (
    s: Seeded,
    overrides: Partial<ChannelReturnSettlementFailedPayload> = {},
  ): ChannelReturnSettlementFailedPayload => ({
    requestId: s.customerReturnId,
    salesChannel: 'medusa',
    externalOrderId: s.channelOrderId,
    returnId: s.channelReturnId,
    received: false,
    retryable: true,
    failureCode: 'refund_failed',
    message: 'payment provider 502',
    at: '2026-10-27T02:00:00.000Z',
    ...overrides,
  });

  const recordOf = async (tx: DbTx, id: string) => {
    const [row] = await tx.select().from(wmsTables.customerReturns).where(eq(wmsTables.customerReturns.id, id));
    return row;
  };

  /** 정산 칸을 직접 고친다 — 마지막 발행 시각·발행 수를 시험 시각에 맞춘다 */
  async function patchSettlement(tx: DbTx, id: string, patch: Partial<CustomerReturnSettlement>) {
    const record = await recordOf(tx, id);
    if (!record.settlement) throw new Error(`no settlement on ${id}`);
    await tx
      .update(wmsTables.customerReturns)
      .set({ settlement: { ...record.settlement, ...patch } })
      .where(eq(wmsTables.customerReturns.id, id));
  }

  const settleCommandsOf = (wired: Wired, id: string) =>
    wired.commands().filter((c) => c.eventType === 'SettleChannelReturn' && c.payload.requestId === id);

  it('settled 사실 → settled, 결과 칸, completed·SalesOrderReturned 이벤트 각 1', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);

      const result = await wired.settlement.recordSettled(settledFact(s), tx);

      expect(result).toEqual({ changed: true });
      const record = await recordOf(tx, s.customerReturnId);
      expect(record.status).toBe('settled');
      expect(record.settledAt?.toISOString()).toBe('2026-10-27T03:00:00.000Z');
      expect(record.settlementOutcome).toEqual({
        refundAmount: 7000,
        deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0 },
        feeNotAdjusted: false,
        refundMode: 'auto',
        settledAt: '2026-10-27T03:00:00.000Z',
      });
      // 진행 기록은 이력으로 남는다 — 상태만 done
      expect(record.settlement).toMatchObject({ state: 'done', refundMode: 'auto', attempts: 1, lastFailure: null });

      const completed = wired.eventsOf('SalesOrderClaimProgressed').filter((e) => e.payload.stage === 'completed');
      expect(completed).toHaveLength(1);
      expect(completed[0]).toMatchObject({
        idempotencyKey: `so-claim:return:${s.customerReturnId}:completed`,
        payload: { kind: 'return', stage: 'completed', requestId: s.customerReturnId, requestedBy: 'customer' },
      });
      const returned = wired.eventsOf('SalesOrderReturned');
      expect(returned).toHaveLength(1);
      expect(returned[0]).toMatchObject({
        idempotencyKey: `so-returned:${s.customerReturnId}`,
        partitionKey: s.salesOrderId,
        payload: {
          orderId: s.salesOrderId,
          channelOrderId: s.channelOrderId,
          returnRequestId: s.customerReturnId,
          reason: 'change_of_mind',
          returnedAt: '2026-10-27T03:00:00.000Z',
          returnedLines: [
            {
              salesOrderLineId: s.lineId,
              channelOrderItemId: s.channelOrderItemId,
              orderedQuantity: 2,
              returnedQuantity: 2,
              remainingQuantity: 2,
            },
          ],
        },
      });
    });
  });

  it('같은 settled 두 번 → 이벤트 각 1, 두 번째 changed false', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);

      expect(await wired.settlement.recordSettled(settledFact(s), tx)).toEqual({ changed: true });
      expect(await wired.settlement.recordSettled(settledFact(s), tx)).toEqual({ changed: false });

      expect(wired.eventsOf('SalesOrderReturned')).toHaveLength(1);
      expect(wired.eventsOf('SalesOrderClaimProgressed').filter((e) => e.payload.stage === 'completed')).toHaveLength(
        1,
      );
      // 닫힌 뒤에 온 실패(늦은 실패)는 기록을 바꾸지 않는다
      expect(
        await wired.settlement.recordSettlementFailed(failedFact(s, { at: '2026-10-27T04:00:00.000Z' }), tx),
      ).toEqual({ changed: false });
      const record = await recordOf(tx, s.customerReturnId);
      expect(record.status).toBe('settled');
      expect(record.settlement?.lastFailure).toBeNull();
    });
  });

  it('received 실패 → refund_pending, 뒤이은 settled → settled', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);

      const failed = await wired.settlement.recordSettlementFailed(failedFact(s, { received: true }), tx);

      expect(failed).toEqual({ changed: true });
      let record = await recordOf(tx, s.customerReturnId);
      expect(record.status).toBe('refund_pending');
      expect(record.settlement).toMatchObject({
        state: 'in_progress',
        attempts: 1,
        lastFailure: {
          code: 'refund_failed',
          message: 'payment provider 502',
          retryable: true,
          received: true,
          at: '2026-10-27T02:00:00.000Z',
        },
      });

      // refund_pending 에서 또 온 실패 — 상태는 그대로, 마지막 실패만 바뀐다
      expect(
        await wired.settlement.recordSettlementFailed(
          failedFact(s, { received: true, at: '2026-10-27T02:30:00.000Z', message: 'again' }),
          tx,
        ),
      ).toEqual({ changed: true });
      record = await recordOf(tx, s.customerReturnId);
      expect(record.status).toBe('refund_pending');
      expect(record.settlement?.lastFailure).toMatchObject({ message: 'again', at: '2026-10-27T02:30:00.000Z' });

      expect(await wired.settlement.recordSettled(settledFact(s), tx)).toEqual({ changed: true });
      record = await recordOf(tx, s.customerReturnId);
      expect(record.status).toBe('settled');
      expect(record.settlement?.state).toBe('done');
      expect(wired.eventsOf('SalesOrderReturned')).toHaveLength(1);
    });
  });

  it('영구 거절 → refused, 크론이 건드리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);

      await wired.settlement.recordSettlementFailed(
        failedFact(s, { retryable: false, failureCode: 'return_not_found', message: 'gone' }),
        tx,
      );

      const record = await recordOf(tx, s.customerReturnId);
      expect(record.status).toBe('inspected');
      expect(record.settlement).toMatchObject({
        state: 'refused',
        attempts: 1,
        lastFailure: { code: 'return_not_found', retryable: false, received: false },
      });

      const later = new Date(Date.now() + 60 * 60_000);
      expect(await wired.settlement.reissueStalled(later, tx)).toBe(0);
      expect(settleCommandsOf(wired, s.customerReturnId)).toHaveLength(1);
      expect((await recordOf(tx, s.customerReturnId)).settlement).toEqual(record.settlement);
    });
  });

  it('순서가 뒤바뀐 실패(이른 at) → 무시', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);

      await wired.settlement.recordSettlementFailed(
        failedFact(s, { at: '2026-10-27T02:30:00.000Z', failureCode: 'late_code' }),
        tx,
      );
      const earlier = await wired.settlement.recordSettlementFailed(
        failedFact(s, { at: '2026-10-27T02:00:00.000Z', failureCode: 'early_code', retryable: false }),
        tx,
      );

      expect(earlier).toEqual({ changed: false });
      const record = await recordOf(tx, s.customerReturnId);
      expect(record.settlement).toMatchObject({
        state: 'in_progress',
        lastFailure: { code: 'late_code', at: '2026-10-27T02:30:00.000Z' },
      });
    });
  });

  it('기록이 없는 반품의 settled → NotFoundError', async () => {
    const wired = wire();
    await inRollbackTx(db, async (tx) => {
      await expect(
        wired.settlement.recordSettled(
          {
            orderId: 'order_x',
            salesChannel: 'medusa',
            externalOrderId: 'order_x',
            returnId: `ret_missing_${randomUUID().slice(0, 8)}`,
            requestId: randomUUID(),
            refundAmount: 0,
            deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 },
            feeNotAdjusted: false,
            refundMode: 'auto',
            settledAt: '2026-10-27T03:00:00.000Z',
            items: [{ channelOrderItemId: 'item_x', received: 1, dismissed: 0 }],
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  it('크론: 5분 지난 in_progress → 명령 재발행(issue 2), 1분 된 것은 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const stale = await seedInspected(tx, w, wired);
      const fresh = await seedInspected(tx, w, wired);
      const now = new Date(Date.now() + 60 * 60_000);
      await patchSettlement(tx, stale.customerReturnId, {
        lastIssuedAt: new Date(now.getTime() - CUSTOMER_RETURN_SETTLEMENT_RETRY_MS - 60_000).toISOString(),
      });
      await patchSettlement(tx, fresh.customerReturnId, {
        lastIssuedAt: new Date(now.getTime() - 60_000).toISOString(),
      });

      expect(await wired.settlement.reissueStalled(now, tx)).toBe(1);

      const staleCommands = settleCommandsOf(wired, stale.customerReturnId);
      expect(staleCommands.map((c) => c.idempotencyKey)).toEqual([
        `customer-return-settle:${stale.customerReturnId}:issue:1`,
        `customer-return-settle:${stale.customerReturnId}:issue:2`,
      ]);
      const withoutIssueTime = (payload: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'requestedAt'));
      const secondPayload = withoutIssueTime(staleCommands[1].payload);
      expect(secondPayload).toEqual(withoutIssueTime(staleCommands[0].payload));
      expect(secondPayload).toMatchObject({
        refundMode: 'auto',
        items: [{ channelOrderItemId: stale.channelOrderItemId, received: 2, dismissed: 0 }],
      });
      expect((await recordOf(tx, stale.customerReturnId)).settlement).toMatchObject({
        state: 'in_progress',
        attempts: 2,
        lastIssuedAt: now.toISOString(),
      });

      expect(settleCommandsOf(wired, fresh.customerReturnId)).toHaveLength(1);
      expect((await recordOf(tx, fresh.customerReturnId)).settlement).toMatchObject({ attempts: 1 });
    });
  });

  it('12번 낸 뒤 → stalled', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);
      const now = new Date(Date.now() + 60 * 60_000);
      await patchSettlement(tx, s.customerReturnId, {
        attempts: CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES - 1,
        lastIssuedAt: new Date(now.getTime() - CUSTOMER_RETURN_SETTLEMENT_RETRY_MS).toISOString(),
      });

      // 11 → 12 번째 발행 (정확히 5분 된 것도 재발행 대상)
      expect(await wired.settlement.reissueStalled(now, tx)).toBe(1);
      expect(settleCommandsOf(wired, s.customerReturnId).map((c) => c.idempotencyKey)).toContain(
        `customer-return-settle:${s.customerReturnId}:issue:12`,
      );

      // 12 번 낸 뒤 — 더 내지 않고 stalled
      const next = new Date(now.getTime() + CUSTOMER_RETURN_SETTLEMENT_RETRY_MS);
      expect(await wired.settlement.reissueStalled(next, tx)).toBe(0);
      const keys = settleCommandsOf(wired, s.customerReturnId).map((c) => c.idempotencyKey);
      expect(keys).not.toContain(`customer-return-settle:${s.customerReturnId}:issue:13`);
      const record = await recordOf(tx, s.customerReturnId);
      expect(record.status).toBe('inspected');
      expect(record.settlement).toMatchObject({ state: 'stalled', attempts: 12, lastIssuedAt: now.toISOString() });

      // stalled 는 다시 훑지 않는다
      expect(
        await wired.settlement.reissueStalled(new Date(next.getTime() + CUSTOMER_RETURN_SETTLEMENT_RETRY_MS), tx),
      ).toBe(0);
    });
  });
});
