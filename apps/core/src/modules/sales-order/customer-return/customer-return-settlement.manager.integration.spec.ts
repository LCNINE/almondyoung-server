import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import type {
  ChannelReturnPrepaidPayload,
  ChannelReturnPrepayFailedPayload,
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
import { CustomerReturnCsManager } from './customer-return-cs.manager';
import {
  CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES,
  CUSTOMER_RETURN_SETTLEMENT_RETRY_MS,
  CustomerReturnSettlementManager,
} from './customer-return-settlement.manager';
import type { CustomerReturnPrepayment, CustomerReturnSettlement } from './customer-return.types';

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
      reader,
      coreOrders.publisher as never,
      commands.publisher as never,
    );
    const cs = new CustomerReturnCsManager(dbService, reader, commands.publisher as never);
    const eventsOf = (type: string) => coreOrders.calls().filter((e) => e.eventType === type);
    return { intake, receiving, settlement, cs, eventsOf, commands: commands.calls };
  }

  type Wired = ReturnType<typeof wire>;

  /** 배송완료 단품 2개 → 2개 반품(`expected`). `arrive`·`inspect` 로 이어 간다 */
  async function seedExpected(tx: DbTx, w: World, wired: Wired) {
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
    const arrive = () =>
      wired.receiving.recordArrival(
        {
          customerReturnId,
          warehouseId: w.warehouseId,
          items: [{ customerReturnItemId: item.id, quantity: 2 }],
          idempotencyKey: `all-${randomUUID()}`,
          actorId: 'admin-1',
        },
        tx,
      );
    const inspect = () =>
      wired.receiving.recordInspection(
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
      arrive,
      inspect,
    };
  }

  /** 배송완료 단품 2개 → 2개 반품 → 전부 도착 → 양품 2 검수(`inspected`, 명령 issue 1) */
  async function seedInspected(tx: DbTx, w: World, wired: Wired) {
    const s = await seedExpected(tx, w, wired);
    await s.arrive();
    await s.inspect();
    return s;
  }

  type Seeded = Awaited<ReturnType<typeof seedExpected>>;

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

  it('settled 의 requestId 가 그 반품 기록이 아니면 → ConflictError, 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);
      const before = await recordOf(tx, s.customerReturnId);
      const eventsBefore = wired.eventsOf('SalesOrderReturned').length;

      await expect(
        wired.settlement.recordSettled(settledFact(s, { requestId: randomUUID() }), tx),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(await recordOf(tx, s.customerReturnId)).toEqual(before);
      expect(wired.eventsOf('SalesOrderReturned')).toHaveLength(eventsBefore);
    });
  });

  it('실패 사실의 requestId 가 그 반품 기록이 아니면 → ConflictError, 아무것도 쓰지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const wired = wire();
      const s = await seedInspected(tx, w, wired);
      const before = await recordOf(tx, s.customerReturnId);

      await expect(
        wired.settlement.recordSettlementFailed(failedFact(s, { requestId: randomUUID(), received: true }), tx),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(await recordOf(tx, s.customerReturnId)).toEqual(before);
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
        issues: CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES - 1,
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

  // ===== K8 PR6b Task 8 — 선환불 결과·다시 시도·계좌 송금·재발행 =====

  const prepaidFact = (
    s: Seeded,
    overrides: Partial<ChannelReturnPrepaidPayload> = {},
  ): ChannelReturnPrepaidPayload => ({
    orderId: s.channelOrderId,
    salesChannel: 'medusa',
    externalOrderId: s.channelOrderId,
    returnId: s.channelReturnId,
    requestId: s.customerReturnId,
    amount: 5000,
    refundMode: 'auto',
    prepaidAt: '2026-10-27T02:10:00.000Z',
    ...overrides,
  });

  const prepayFailedFact = (
    s: Seeded,
    overrides: Partial<ChannelReturnPrepayFailedPayload> = {},
  ): ChannelReturnPrepayFailedPayload => ({
    requestId: s.customerReturnId,
    salesChannel: 'medusa',
    externalOrderId: s.channelOrderId,
    returnId: s.channelReturnId,
    retryable: true,
    failureCode: 'http_502',
    message: 'bad gateway',
    at: '2026-10-27T02:05:00.000Z',
    ...overrides,
  });

  /** 선환불 칸을 직접 고친다 — 마지막 발행 시각·발행 수를 시험 시각에 맞춘다 */
  async function patchPrepayment(tx: DbTx, id: string, patch: Partial<CustomerReturnPrepayment>) {
    const record = await recordOf(tx, id);
    if (!record.prepayment) throw new Error(`no prepayment on ${id}`);
    await tx
      .update(wmsTables.customerReturns)
      .set({ prepayment: { ...record.prepayment, ...patch } })
      .where(eq(wmsTables.customerReturns.id, id));
  }

  const prepayCommandsOf = (wired: Wired, id: string) =>
    wired.commands().filter((c) => c.eventType === 'PrepayChannelReturn' && c.payload.requestId === id);

  const withoutIssueTime = (payload: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'requestedAt'));

  /** 선환불 요청(5,000·메모) 뒤의 `expected` 반품 — 선환불 명령 issue 1 */
  async function seedPrepaying(tx: DbTx, w: World, wired: Wired) {
    const s = await seedExpected(tx, w, wired);
    await wired.cs.requestPrepay(
      {
        customerReturnId: s.customerReturnId,
        amount: 5000,
        refundMode: 'auto',
        memo: '고객 요청 선환불',
        actorId: 'cs-1',
      },
      tx,
    );
    return s;
  }

  const EXTERNAL_REFUND_UNRESOLVED = 'return_settle_rejected:external_refund_unresolved';

  describe('정산 다시 시도·계좌 송금 (N10·N11)', () => {
    it('stalled(attempts 12) → 다시 시도 → issue 13 명령, 5분 뒤 크론 issue 14', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedInspected(tx, w, wired);
        await patchSettlement(tx, s.customerReturnId, {
          state: 'stalled',
          attempts: CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES,
          issues: CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES,
        });

        const before = Date.now();
        const view = await wired.settlement.restart(
          { customerReturnId: s.customerReturnId, target: 'settlement', kind: 'retry', actorId: 'cs-1' },
          tx,
        );

        expect(view.settlement).toMatchObject({ state: 'in_progress', refundMode: 'auto', attempts: 1, issues: 13 });
        expect(Date.parse(view.settlement?.lastIssuedAt ?? '')).toBeGreaterThanOrEqual(before);
        expect(settleCommandsOf(wired, s.customerReturnId).map((c) => c.idempotencyKey)).toEqual([
          `customer-return-settle:${s.customerReturnId}:issue:1`,
          `customer-return-settle:${s.customerReturnId}:issue:13`,
        ]);

        // 5분 뒤 — 크론이 옛 키와 겹치지 않는 issue 14 를 낸다
        const later = new Date(Date.parse(view.settlement?.lastIssuedAt ?? '') + CUSTOMER_RETURN_SETTLEMENT_RETRY_MS);
        expect(await wired.settlement.reissueStalled(later, tx)).toBe(1);
        const sent = settleCommandsOf(wired, s.customerReturnId);
        expect(sent.map((c) => c.idempotencyKey)).toEqual([
          `customer-return-settle:${s.customerReturnId}:issue:1`,
          `customer-return-settle:${s.customerReturnId}:issue:13`,
          `customer-return-settle:${s.customerReturnId}:issue:14`,
        ]);
        expect(withoutIssueTime(sent[2].payload)).toEqual(withoutIssueTime(sent[0].payload));
        expect((await recordOf(tx, s.customerReturnId)).settlement).toMatchObject({
          state: 'in_progress',
          attempts: 2,
          issues: 14,
          lastIssuedAt: later.toISOString(),
        });
      });
    });

    it('refused → 계좌 송금 → refundMode manual 명령, 이미 수동이면 Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedInspected(tx, w, wired);
        await wired.settlement.recordSettlementFailed(
          failedFact(s, { retryable: false, failureCode: 'wallet_refund_refused:ALREADY_CANCELED', message: 'no' }),
          tx,
        );

        const view = await wired.settlement.restart(
          { customerReturnId: s.customerReturnId, target: 'settlement', kind: 'manual', actorId: 'cs-1' },
          tx,
        );

        expect(view.status).toBe('inspected');
        expect(view.settlement).toMatchObject({ state: 'in_progress', refundMode: 'manual', attempts: 1, issues: 2 });
        const sent = settleCommandsOf(wired, s.customerReturnId);
        expect(sent).toHaveLength(2);
        expect(sent[1]).toMatchObject({
          idempotencyKey: `customer-return-settle:${s.customerReturnId}:issue:2`,
          payload: { requestId: s.customerReturnId, refundMode: 'manual' },
        });

        // 수동도 거절 → 다시 계좌 송금은 Conflict(이미 수동), 다시 시도는 수동 그대로
        await wired.settlement.recordSettlementFailed(
          failedFact(s, { retryable: false, failureCode: 'wallet_refund_refused:X', at: '2026-10-27T05:00:00.000Z' }),
          tx,
        );
        await expect(
          wired.settlement.restart(
            { customerReturnId: s.customerReturnId, target: 'settlement', kind: 'manual', actorId: 'cs-1' },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        const retried = await wired.settlement.restart(
          { customerReturnId: s.customerReturnId, target: 'settlement', kind: 'retry', actorId: 'cs-1' },
          tx,
        );
        expect(retried.settlement).toMatchObject({ state: 'in_progress', refundMode: 'manual', issues: 3 });
        expect(settleCommandsOf(wired, s.customerReturnId)[2].payload).toMatchObject({ refundMode: 'manual' });
      });
    });

    it('진행 중 다시 시도 → Conflict, 닫힌 정산도 Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedInspected(tx, w, wired);
        const before = await recordOf(tx, s.customerReturnId);

        for (const kind of ['retry', 'manual'] as const) {
          await expect(
            wired.settlement.restart(
              { customerReturnId: s.customerReturnId, target: 'settlement', kind, actorId: 'cs-1' },
              tx,
            ),
          ).rejects.toBeInstanceOf(ConflictError);
        }
        expect(await recordOf(tx, s.customerReturnId)).toEqual(before);
        expect(settleCommandsOf(wired, s.customerReturnId)).toHaveLength(1);

        await wired.settlement.recordSettled(settledFact(s), tx);
        await expect(
          wired.settlement.restart(
            { customerReturnId: s.customerReturnId, target: 'settlement', kind: 'retry', actorId: 'cs-1' },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        // 정산 기록이 없는 반품(검수 전)
        const fresh = await seedExpected(tx, w, wired);
        await expect(
          wired.settlement.restart(
            { customerReturnId: fresh.customerReturnId, target: 'settlement', kind: 'retry', actorId: 'cs-1' },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        await expect(
          wired.settlement.restart(
            { customerReturnId: randomUUID(), target: 'settlement', kind: 'retry', actorId: 'cs-1' },
            tx,
          ),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    it('외부 환불 거절 뒤 이미 환불한 금액 10,000 → 명령 alreadyRefundedAmount 10,000, 크론 재발행도 같은 값', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedInspected(tx, w, wired);
        await wired.settlement.recordSettlementFailed(
          failedFact(s, { retryable: false, failureCode: EXTERNAL_REFUND_UNRESOLVED, message: 'external' }),
          tx,
        );

        const view = await wired.settlement.restart(
          {
            customerReturnId: s.customerReturnId,
            target: 'settlement',
            kind: 'retry',
            alreadyRefundedAmount: 10_000,
            actorId: 'cs-1',
          },
          tx,
        );

        expect(view.settlement).toMatchObject({
          state: 'in_progress',
          issues: 2,
          command: { alreadyRefundedAmount: 10_000 },
        });
        const later = new Date(Date.parse(view.settlement?.lastIssuedAt ?? '') + CUSTOMER_RETURN_SETTLEMENT_RETRY_MS);
        expect(await wired.settlement.reissueStalled(later, tx)).toBe(1);
        const sent = settleCommandsOf(wired, s.customerReturnId);
        expect(sent.map((c) => c.idempotencyKey)).toEqual([
          `customer-return-settle:${s.customerReturnId}:issue:1`,
          `customer-return-settle:${s.customerReturnId}:issue:2`,
          `customer-return-settle:${s.customerReturnId}:issue:3`,
        ]);
        expect(sent[0].payload).not.toHaveProperty('alreadyRefundedAmount');
        expect(sent[1].payload).toMatchObject({ alreadyRefundedAmount: 10_000 });
        expect(sent[2].payload).toMatchObject({ alreadyRefundedAmount: 10_000 });
      });
    });

    it('다른 실패 뒤 이미 환불한 금액 → BadRequest, 선환불에 이미 환불한 금액도 BadRequest', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedInspected(tx, w, wired);
        await wired.settlement.recordSettlementFailed(
          failedFact(s, { retryable: false, failureCode: 'return_not_found', message: 'gone' }),
          tx,
        );
        const before = await recordOf(tx, s.customerReturnId);

        await expect(
          wired.settlement.restart(
            {
              customerReturnId: s.customerReturnId,
              target: 'settlement',
              kind: 'retry',
              alreadyRefundedAmount: 10_000,
              actorId: 'cs-1',
            },
            tx,
          ),
        ).rejects.toBeInstanceOf(BadRequestError);
        expect(await recordOf(tx, s.customerReturnId)).toEqual(before);
        expect(settleCommandsOf(wired, s.customerReturnId)).toHaveLength(1);

        const p = await seedPrepaying(tx, w, wired);
        await wired.settlement.recordPrepayFailed(prepayFailedFact(p, { retryable: false, failureCode: 'x' }), tx);
        await expect(
          wired.settlement.restart(
            {
              customerReturnId: p.customerReturnId,
              target: 'prepayment',
              kind: 'retry',
              alreadyRefundedAmount: 1,
              actorId: 'cs-1',
            },
            tx,
          ),
        ).rejects.toBeInstanceOf(BadRequestError);
      });
    });
  });

  describe('선환불 결과 (N4·N7)', () => {
    it('선환불 성공 사실 → done·outcome, 두 번 → changed false', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);

        expect(await wired.settlement.recordPrepaid(prepaidFact(s), tx)).toEqual({ changed: true });
        const record = await recordOf(tx, s.customerReturnId);
        expect(record.status).toBe('expected');
        expect(record.prepayment).toMatchObject({
          state: 'done',
          requestedAmount: 5000,
          memo: '고객 요청 선환불',
          attempts: 1,
          issues: 1,
          outcome: { amount: 5000, refundMode: 'auto', prepaidAt: '2026-10-27T02:10:00.000Z' },
        });

        expect(await wired.settlement.recordPrepaid(prepaidFact(s, { amount: 9999 }), tx)).toEqual({
          changed: false,
        });
        expect((await recordOf(tx, s.customerReturnId)).prepayment).toEqual(record.prepayment);
        // 성공 뒤에 온 실패는 버린다
        expect(
          await wired.settlement.recordPrepayFailed(prepayFailedFact(s, { at: '2026-10-27T03:00:00.000Z' }), tx),
        ).toEqual({ changed: false });
        expect((await recordOf(tx, s.customerReturnId)).prepayment).toEqual(record.prepayment);
      });
    });

    it('선환불 사실의 requestId 가 그 반품 기록이 아니면 → Conflict, 선환불이 없는 반품도 Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);
        const before = await recordOf(tx, s.customerReturnId);

        await expect(
          wired.settlement.recordPrepaid(prepaidFact(s, { requestId: randomUUID() }), tx),
        ).rejects.toBeInstanceOf(ConflictError);
        await expect(
          wired.settlement.recordPrepayFailed(prepayFailedFact(s, { requestId: randomUUID() }), tx),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(await recordOf(tx, s.customerReturnId)).toEqual(before);

        const none = await seedExpected(tx, w, wired);
        await expect(wired.settlement.recordPrepaid(prepaidFact(none), tx)).rejects.toBeInstanceOf(ConflictError);
      });
    });

    it('선환불 실패 — 일시는 in_progress, 영구는 refused, 이른 at 은 버린다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);

        expect(await wired.settlement.recordPrepayFailed(prepayFailedFact(s), tx)).toEqual({ changed: true });
        expect((await recordOf(tx, s.customerReturnId)).prepayment).toMatchObject({
          state: 'in_progress',
          lastFailure: { code: 'http_502', message: 'bad gateway', retryable: true, at: '2026-10-27T02:05:00.000Z' },
        });

        expect(
          await wired.settlement.recordPrepayFailed(
            prepayFailedFact(s, {
              retryable: false,
              failureCode: 'wallet_refund_refused:NOT_FOUND',
              at: '2026-10-27T02:06:00.000Z',
            }),
            tx,
          ),
        ).toEqual({ changed: true });
        expect(
          await wired.settlement.recordPrepayFailed(
            prepayFailedFact(s, { failureCode: 'early', at: '2026-10-27T02:00:00.000Z' }),
            tx,
          ),
        ).toEqual({ changed: false });
        const record = await recordOf(tx, s.customerReturnId);
        expect(record.status).toBe('expected');
        expect(record.prepayment).toMatchObject({
          state: 'refused',
          lastFailure: { code: 'wallet_refund_refused:NOT_FOUND', retryable: false },
        });
      });
    });

    it('선환불 거절 return_already_settled → superseded', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);

        expect(
          await wired.settlement.recordPrepayFailed(
            prepayFailedFact(s, {
              retryable: false,
              failureCode: 'return_prepay_rejected:return_already_settled',
              message: 'already settled',
            }),
            tx,
          ),
        ).toEqual({ changed: true });

        const record = await recordOf(tx, s.customerReturnId);
        expect(record.prepayment).toMatchObject({
          state: 'superseded',
          outcome: null,
          lastFailure: { code: 'return_prepay_rejected:return_already_settled', retryable: false },
        });
        // 대체된 선환불은 크론도 다시 시도도 건드리지 않는다
        expect(await wired.settlement.reissueStalled(new Date(Date.now() + 60 * 60_000), tx)).toBe(0);
        await expect(
          wired.settlement.restart(
            { customerReturnId: s.customerReturnId, target: 'prepayment', kind: 'retry', actorId: 'cs-1' },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(prepayCommandsOf(wired, s.customerReturnId)).toHaveLength(1);
      });
    });

    it('settled 사실 → 진행 중 선환불 superseded, 결과에 prepaidAmount·externalRefundApplied·보류 차감', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);
        await s.arrive();
        await s.inspect();

        expect(
          await wired.settlement.recordSettled(
            settledFact(s, {
              refundAmount: 2000,
              prepaidAmount: 5000,
              externalRefundApplied: 0,
              deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0, hold: 0 },
            }),
            tx,
          ),
        ).toEqual({ changed: true });

        const record = await recordOf(tx, s.customerReturnId);
        expect(record.status).toBe('settled');
        expect(record.settlementOutcome).toEqual({
          refundAmount: 2000,
          deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0, hold: 0 },
          feeNotAdjusted: false,
          refundMode: 'auto',
          settledAt: '2026-10-27T03:00:00.000Z',
          prepaidAmount: 5000,
          externalRefundApplied: 0,
        });
        expect(record.prepayment).toMatchObject({ state: 'superseded', outcome: null });
      });
    });

    it('settled 뒤에 온 선환불 성공(잃은 응답의 재시도) → 상태와 무관하게 done', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);
        await s.arrive();
        await s.inspect();
        await wired.settlement.recordSettled(settledFact(s, { prepaidAmount: 5000 }), tx);
        expect((await recordOf(tx, s.customerReturnId)).prepayment?.state).toBe('superseded');

        expect(await wired.settlement.recordPrepaid(prepaidFact(s), tx)).toEqual({ changed: true });
        const record = await recordOf(tx, s.customerReturnId);
        expect(record.status).toBe('settled');
        expect(record.prepayment).toMatchObject({
          state: 'done',
          outcome: { amount: 5000, refundMode: 'auto', prepaidAt: '2026-10-27T02:10:00.000Z' },
        });
        // 이미 done 인 선환불은 settled 가 덮지 않는다
        expect(await wired.settlement.recordSettled(settledFact(s), tx)).toEqual({ changed: false });
      });
    });

    it('done 선환불은 정산 성공이 superseded 로 덮지 않는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);
        await wired.settlement.recordPrepaid(prepaidFact(s), tx);
        await s.arrive();
        await s.inspect();

        await wired.settlement.recordSettled(settledFact(s, { prepaidAmount: 5000 }), tx);
        const record = await recordOf(tx, s.customerReturnId);
        expect(record.prepayment).toMatchObject({ state: 'done', outcome: { amount: 5000 } });
        expect(record.settlementOutcome).toMatchObject({ prepaidAmount: 5000 });
      });
    });
  });

  describe('선환불 다시 시도·계좌 송금·재발행 (N10·N11)', () => {
    it('refused 선환불 → 계좌 송금 → 같은 금액·메모, refundMode manual, issue 2. 수령 뒤엔 Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedPrepaying(tx, w, wired);
        await wired.settlement.recordPrepayFailed(
          prepayFailedFact(s, { retryable: false, failureCode: 'wallet_refund_refused:X' }),
          tx,
        );

        const view = await wired.settlement.restart(
          { customerReturnId: s.customerReturnId, target: 'prepayment', kind: 'manual', actorId: 'cs-1' },
          tx,
        );

        expect(view.status).toBe('expected');
        expect(view.prepayment).toMatchObject({
          state: 'in_progress',
          refundMode: 'manual',
          requestedAmount: 5000,
          memo: '고객 요청 선환불',
          attempts: 1,
          issues: 2,
        });
        const sent = prepayCommandsOf(wired, s.customerReturnId);
        expect(sent.map((c) => c.idempotencyKey)).toEqual([
          `customer-return-prepay:${s.customerReturnId}:issue:1`,
          `customer-return-prepay:${s.customerReturnId}:issue:2`,
        ]);
        // 바뀐 것은 refundMode 뿐 — Medusa 는 금액·메모로 같은 선환불을 잇는다
        expect(withoutIssueTime(sent[1].payload)).toEqual({
          ...withoutIssueTime(sent[0].payload),
          refundMode: 'manual',
        });
        expect(sent[1].payload).toMatchObject({ amount: 5000, memo: '고객 요청 선환불' });

        // 진행 중 다시 시도 → Conflict
        await expect(
          wired.settlement.restart(
            { customerReturnId: s.customerReturnId, target: 'prepayment', kind: 'retry', actorId: 'cs-1' },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);

        // 다시 거절 — 그사이 수령·검수로 넘어갔으면 선환불은 다시 열지 않는다
        await wired.settlement.recordPrepayFailed(
          prepayFailedFact(s, {
            retryable: false,
            failureCode: 'wallet_refund_refused:Y',
            at: '2026-10-27T04:00:00.000Z',
          }),
          tx,
        );
        await s.arrive();
        await s.inspect();
        await expect(
          wired.settlement.restart(
            { customerReturnId: s.customerReturnId, target: 'prepayment', kind: 'retry', actorId: 'cs-1' },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(prepayCommandsOf(wired, s.customerReturnId)).toHaveLength(2);
      });
    });

    it('크론이 in_progress 선환불도 5분 뒤 다시 낸다(같은 금액·메모), 12번 뒤 stalled', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const stale = await seedPrepaying(tx, w, wired);
        const fresh = await seedPrepaying(tx, w, wired);
        const now = new Date(Date.now() + 60 * 60_000);
        await patchPrepayment(tx, stale.customerReturnId, {
          lastIssuedAt: new Date(now.getTime() - CUSTOMER_RETURN_SETTLEMENT_RETRY_MS).toISOString(),
        });
        await patchPrepayment(tx, fresh.customerReturnId, {
          lastIssuedAt: new Date(now.getTime() - 60_000).toISOString(),
        });

        expect(await wired.settlement.reissueStalled(now, tx)).toBe(1);

        const sent = prepayCommandsOf(wired, stale.customerReturnId);
        expect(sent.map((c) => c.idempotencyKey)).toEqual([
          `customer-return-prepay:${stale.customerReturnId}:issue:1`,
          `customer-return-prepay:${stale.customerReturnId}:issue:2`,
        ]);
        expect(withoutIssueTime(sent[1].payload)).toEqual(withoutIssueTime(sent[0].payload));
        expect((await recordOf(tx, stale.customerReturnId)).prepayment).toMatchObject({
          state: 'in_progress',
          attempts: 2,
          issues: 2,
          lastIssuedAt: now.toISOString(),
        });
        expect(prepayCommandsOf(wired, fresh.customerReturnId)).toHaveLength(1);

        // 12번 낸 뒤 — 더 내지 않고 stalled, 다시 시도가 사람 길이다(issue 13)
        await patchPrepayment(tx, stale.customerReturnId, {
          attempts: CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES,
          issues: CUSTOMER_RETURN_SETTLEMENT_MAX_ISSUES,
        });
        const next = new Date(now.getTime() + CUSTOMER_RETURN_SETTLEMENT_RETRY_MS);
        expect(await wired.settlement.reissueStalled(next, tx)).toBe(1); // fresh 만
        expect((await recordOf(tx, stale.customerReturnId)).prepayment?.state).toBe('stalled');
        const restarted = await wired.settlement.restart(
          { customerReturnId: stale.customerReturnId, target: 'prepayment', kind: 'retry', actorId: 'cs-1' },
          tx,
        );
        expect(restarted.prepayment).toMatchObject({ state: 'in_progress', attempts: 1, issues: 13 });
        expect(prepayCommandsOf(wired, stale.customerReturnId).map((c) => c.idempotencyKey)).toContain(
          `customer-return-prepay:${stale.customerReturnId}:issue:13`,
        );
      });
    });

    it('정산·선환불이 함께 밀렸으면 한 번에 둘 다 낸다(수를 합친다)', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const settling = await seedInspected(tx, w, wired);
        const prepaying = await seedPrepaying(tx, w, wired);
        const now = new Date(Date.now() + 60 * 60_000);
        const old = new Date(now.getTime() - CUSTOMER_RETURN_SETTLEMENT_RETRY_MS).toISOString();
        await patchSettlement(tx, settling.customerReturnId, { lastIssuedAt: old });
        await patchPrepayment(tx, prepaying.customerReturnId, { lastIssuedAt: old });

        expect(await wired.settlement.reissueStalled(now, tx)).toBe(2);
        expect(settleCommandsOf(wired, settling.customerReturnId)).toHaveLength(2);
        expect(prepayCommandsOf(wired, prepaying.customerReturnId)).toHaveLength(2);
      });
    });

    it('issues 가 없는 PR 6 정산 행 → attempts 로 읽어 키를 잇는다', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seedInspected(tx, w, wired);
        const now = new Date(Date.now() + 60 * 60_000);
        const record = await recordOf(tx, s.customerReturnId);
        if (!record.settlement) throw new Error('no settlement');
        // PR 6 이 쓴 꼴 그대로 — issues·command 칸이 없다
        const pr6Row: CustomerReturnSettlement = {
          state: 'in_progress',
          refundMode: record.settlement.refundMode,
          startedAt: record.settlement.startedAt,
          lastIssuedAt: new Date(now.getTime() - CUSTOMER_RETURN_SETTLEMENT_RETRY_MS).toISOString(),
          attempts: 3,
          lastFailure: null,
        };
        await tx
          .update(wmsTables.customerReturns)
          .set({ settlement: pr6Row })
          .where(eq(wmsTables.customerReturns.id, s.customerReturnId));

        expect(await wired.settlement.reissueStalled(now, tx)).toBe(1);
        expect(settleCommandsOf(wired, s.customerReturnId).map((c) => c.idempotencyKey)).toContain(
          `customer-return-settle:${s.customerReturnId}:issue:4`,
        );
        expect((await recordOf(tx, s.customerReturnId)).settlement).toMatchObject({ attempts: 4, issues: 4 });
      });
    });
  });
});
