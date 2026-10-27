import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { StockStateEnum } from '../../inventory/schema/enum-values';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../../fulfillment/services/__support__';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedComponentSku, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import { CustomerReturnReceivingManager } from './customer-return-receiving.manager';
import { CustomerReturnCsManager } from './customer-return-cs.manager';

/**
 * 반품 CS 문 — 미도착 닫기·보류 정산·선환불 요청 (K8 PR6b Task 7). 픽스처는 PR 6 의 도착·검수 명령으로 간다.
 * 원장은 실제 InventoryCommandService 로 쓰고, 두 발행자(고객 이벤트·채널 명령)는 적재 호출만 모은다.
 * rollback 전용 트랜잭션 — 거절 케이스는 쓰기 전에 던지므로 트랜잭션이 깨지지 않는다.
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

describeIfDb('CustomerReturnCsManager — 미도착 닫기·보류 정산·선환불 요청 (K8 PR6b)', () => {
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
    const cs = new CustomerReturnCsManager(dbService, reader, commands.publisher as never);
    const commandsOf = (type: string) => commands.calls().filter((e) => e.eventType === type);
    return { intake, receiving, cs, commandsOf };
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

  async function ledgerQty(tx: DbTx, skuId: string, warehouseId: string, state: StockStateEnum) {
    const returnLocation = await location.getSystemLocationByRole(warehouseId, 'return_default', tx);
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, returnLocation.id),
          eq(wmsTables.stockLedgers.stockState, state),
        ),
      );
    return row?.qty ?? 0;
  }

  const recordOf = async (tx: DbTx, id: string) => {
    const [row] = await tx.select().from(wmsTables.customerReturns).where(eq(wmsTables.customerReturns.id, id));
    return row;
  };

  const actorId = 'cs-1';

  describe('미도착 닫기 (N8·N15)', () => {
    it('2개 중 1개 도착 → 닫기 → 검수 → 정산 명령 품목 1·closesMissing', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 1 }]);

        const closed = await wired.cs.closeMissing(
          { customerReturnId: s.customerReturnId, memo: '고객이 1개만 보냈다고 함', actorId },
          tx,
        );
        expect(closed.status).toBe('arrived');
        expect(closed.lines[0]).toMatchObject({ quantity: 2, missingQty: 1 });
        expect(closed.csResolution?.missing).toMatchObject({ memo: '고객이 1개만 보냈다고 함', by: actorId });
        expect(Number.isNaN(Date.parse(closed.csResolution?.missing?.at ?? ''))).toBe(false);
        expect(closed.csResolution?.hold).toBeUndefined();
        expect(wired.commandsOf('SettleChannelReturn')).toHaveLength(0);

        // 이미 닫힌 반품을 또 닫으면 그대로
        const again = await wired.cs.closeMissing(
          { customerReturnId: s.customerReturnId, memo: '다른 메모', actorId: 'cs-2' },
          tx,
        );
        expect(again).toEqual(closed);

        // 닫힌 뒤 검수는 «합 = 도착»만 본다(1개 도착 → 1개 검수)
        const inspected = await s.inspect([{ skuId: w.skuId, accepted: 1 }]);
        expect(inspected.status).toBe('inspected');
        const sent = wired.commandsOf('SettleChannelReturn');
        expect(sent).toHaveLength(1);
        expect(sent[0].idempotencyKey).toBe(`customer-return-settle:${s.customerReturnId}:issue:1`);
        expect(sent[0].payload).toMatchObject({
          items: [{ channelOrderItemId: s.channelOrderItemId, received: 1, dismissed: 0 }],
          closesMissing: true,
        });
        expect(sent[0].payload).not.toHaveProperty('holdDeduction');
        expect(inspected.settlement).toMatchObject({
          state: 'in_progress',
          attempts: 1,
          issues: 1,
          command: { closesMissing: true },
        });
      });
    });

    it('닫은 뒤 늦은 소포 → Conflict, 원장 그대로 (같은 키의 재전송은 그대로)', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        const first = await s.arrive([{ skuId: w.skuId, quantity: 1 }], 'parcel-1');
        await wired.cs.closeMissing({ customerReturnId: s.customerReturnId, memo: '1개 미도착', actorId }, tx);

        await expect(s.arrive([{ skuId: w.skuId, quantity: 1 }], 'parcel-2')).rejects.toThrow(
          new ConflictError('미도착으로 닫은 반품입니다'),
        );
        expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'RETURNED')).toBe(1);
        const arrivals = await tx
          .select()
          .from(wmsTables.customerReturnArrivals)
          .where(eq(wmsTables.customerReturnArrivals.customerReturnItemId, s.itemOf(w.skuId)));
        expect(arrivals).toHaveLength(1);

        const replay = await s.arrive([{ skuId: w.skuId, quantity: 1 }], 'parcel-1');
        expect(replay.lines[0].items[0].arrivedQty).toBe(first.lines[0].items[0].arrivedQty);
        expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'RETURNED')).toBe(1);
      });
    });

    it('다 온 반품 닫기 → BadRequest', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 2 }]);

        await expect(
          wired.cs.closeMissing({ customerReturnId: s.customerReturnId, memo: '메모', actorId }, tx),
        ).rejects.toBeInstanceOf(BadRequestError);
        const record = await recordOf(tx, s.customerReturnId);
        expect(record.csResolution).toBeNull();
      });
    });

    it('도착 전(expected) 닫기 → Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);

        await expect(
          wired.cs.closeMissing({ customerReturnId: s.customerReturnId, memo: '메모', actorId }, tx),
        ).rejects.toBeInstanceOf(ConflictError);
        expect((await recordOf(tx, s.customerReturnId)).csResolution).toBeNull();
      });
    });

    it('세트 A×2·B×1 1벌에 A 2개만 왔다 → 온전한 벌 없음 BadRequest', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const b = await seedComponentSku(tx, w);
        const wired = wire();
        const s = await seed(tx, w, wired, {
          quantity: 1,
          composition: [
            { skuId: w.skuId, qtyPerUnit: 2 },
            { skuId: b, qtyPerUnit: 1 },
          ],
        });
        await s.arrive([{ skuId: w.skuId, quantity: 2 }]);

        await expect(
          wired.cs.closeMissing({ customerReturnId: s.customerReturnId, memo: '메모', actorId }, tx),
        ).rejects.toBeInstanceOf(BadRequestError);
        const [line] = await tx
          .select({ missingQty: wmsTables.customerReturnLines.missingQty })
          .from(wmsTables.customerReturnLines)
          .where(eq(wmsTables.customerReturnLines.customerReturnId, s.customerReturnId));
        expect(line.missingQty).toBe(0);
      });
    });

    it('선환불 중 미도착 닫기 → Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 1 }]);
        await wired.cs.requestPrepay(
          { customerReturnId: s.customerReturnId, amount: null, refundMode: 'auto', memo: '먼저 환불', actorId },
          tx,
        );

        await expect(
          wired.cs.closeMissing({ customerReturnId: s.customerReturnId, memo: '메모', actorId }, tx),
        ).rejects.toBeInstanceOf(ConflictError);
        const record = await recordOf(tx, s.customerReturnId);
        expect(record.csResolution).toBeNull();
      });
    });
  });

  describe('보류 정산 (N2)', () => {
    it('보류 → 차감 3,000 정산 → inspected, 명령 holdDeduction 3,000, 같은 요청 두 번 → 명령 1', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 2 }]);
        const held = await s.inspect([{ skuId: w.skuId, accepted: 1, held: 1 }]);
        expect(held.status).toBe('held');

        const input = { customerReturnId: s.customerReturnId, deduction: 3000, memo: '포장 훼손', actorId };
        const settled = await wired.cs.settleHeld(input, tx);
        expect(settled.status).toBe('inspected');
        expect(settled.inspectedAt).toBe(held.inspectedAt);
        expect(settled.csResolution?.hold).toMatchObject({ deduction: 3000, memo: '포장 훼손', by: actorId });
        expect(Number.isNaN(Date.parse(settled.csResolution?.hold?.at ?? ''))).toBe(false);
        expect(settled.csResolution?.missing).toBeUndefined();
        expect(settled.settlement).toMatchObject({
          state: 'in_progress',
          refundMode: 'auto',
          attempts: 1,
          issues: 1,
          lastFailure: null,
          command: { holdDeduction: { amount: 3000, memo: '포장 훼손' } },
        });

        const sent = wired.commandsOf('SettleChannelReturn');
        expect(sent).toHaveLength(1);
        expect(sent[0].idempotencyKey).toBe(`customer-return-settle:${s.customerReturnId}:issue:1`);
        const { requestedAt, ...payload } = sent[0].payload;
        expect(typeof requestedAt).toBe('string');
        // 보류 1 은 Medusa 에 폐기로 알린다(N14)
        expect(payload).toEqual({
          requestId: s.customerReturnId,
          salesChannel: 'medusa',
          externalOrderId: s.channelOrderId,
          returnId: s.channelReturnId,
          items: [{ channelOrderItemId: s.channelOrderItemId, received: 1, dismissed: 1 }],
          refundMode: 'auto',
          holdDeduction: { amount: 3000, memo: '포장 훼손' },
        });

        // 같은 요청(더블클릭) → 그대로, 명령 1
        const again = await wired.cs.settleHeld({ ...input, actorId: 'cs-2' }, tx);
        expect(again).toEqual(settled);
        expect(wired.commandsOf('SettleChannelReturn')).toHaveLength(1);

        // 다른 차감 → Conflict
        await expect(wired.cs.settleHeld({ ...input, deduction: 5000 }, tx)).rejects.toBeInstanceOf(ConflictError);
        expect(wired.commandsOf('SettleChannelReturn')).toHaveLength(1);
      });
    });

    it('보류 차감 0 → 명령에 holdDeduction 없음', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 2 }]);
        await s.inspect([{ skuId: w.skuId, accepted: 0, held: 2 }]);

        const view = await wired.cs.settleHeld(
          { customerReturnId: s.customerReturnId, deduction: 0, memo: '문제 없음 확인', actorId },
          tx,
        );
        expect(view.status).toBe('inspected');
        expect(view.settlement?.command).toEqual({});
        const [sent] = wired.commandsOf('SettleChannelReturn');
        expect(sent.payload).not.toHaveProperty('holdDeduction');
        expect(sent.payload).not.toHaveProperty('closesMissing');
        expect(sent.payload.items).toEqual([{ channelOrderItemId: s.channelOrderItemId, received: 0, dismissed: 2 }]);
      });
    });

    it('미도착을 닫은 반품의 보류 정산 → 명령에 closesMissing, 줄 수량은 도착분만', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 1 }]);
        await wired.cs.closeMissing({ customerReturnId: s.customerReturnId, memo: '1개 미도착', actorId }, tx);
        await s.inspect([{ skuId: w.skuId, accepted: 0, held: 1 }]);

        const view = await wired.cs.settleHeld(
          { customerReturnId: s.customerReturnId, deduction: 1000, memo: '사용감', actorId },
          tx,
        );
        expect(view.settlement?.command).toEqual({
          holdDeduction: { amount: 1000, memo: '사용감' },
          closesMissing: true,
        });
        const [sent] = wired.commandsOf('SettleChannelReturn');
        expect(sent.payload).toMatchObject({
          items: [{ channelOrderItemId: s.channelOrderItemId, received: 0, dismissed: 1 }],
          closesMissing: true,
          holdDeduction: { amount: 1000, memo: '사용감' },
        });
        expect(view.csResolution).toMatchObject({ missing: { memo: '1개 미도착' }, hold: { deduction: 1000 } });
      });
    });

    it('보류가 아닌 반품의 보류 정산 → Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 2 }]);

        await expect(
          wired.cs.settleHeld({ customerReturnId: s.customerReturnId, deduction: 0, memo: '메모', actorId }, tx),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(wired.commandsOf('SettleChannelReturn')).toHaveLength(0);
      });
    });
  });

  describe('선환불 요청 (N4·N15)', () => {
    it('선환불 요청 → prepayment in_progress, PrepayChannelReturn 1, 상태 그대로', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);

        const input = {
          customerReturnId: s.customerReturnId,
          amount: 10_000,
          refundMode: 'auto' as const,
          memo: '고객 요청으로 먼저 환불',
          actorId,
        };
        const view = await wired.cs.requestPrepay(input, tx);
        expect(view.status).toBe('expected');
        const { startedAt, lastIssuedAt, ...prepayment } = view.prepayment ?? { startedAt: '', lastIssuedAt: '' };
        expect(prepayment).toEqual({
          state: 'in_progress',
          refundMode: 'auto',
          requestedAmount: 10_000,
          memo: '고객 요청으로 먼저 환불',
          requestedBy: actorId,
          attempts: 1,
          issues: 1,
          lastFailure: null,
          outcome: null,
        });
        expect(Number.isNaN(Date.parse(startedAt))).toBe(false);
        expect(lastIssuedAt).toBe(startedAt);

        const sent = wired.commandsOf('PrepayChannelReturn');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
          idempotencyKey: `customer-return-prepay:${s.customerReturnId}:issue:1`,
          partitionKey: `medusa:${s.channelOrderId}`,
        });
        const { requestedAt, ...payload } = sent[0].payload;
        expect(typeof requestedAt).toBe('string');
        expect(payload).toEqual({
          requestId: s.customerReturnId,
          salesChannel: 'medusa',
          externalOrderId: s.channelOrderId,
          returnId: s.channelReturnId,
          amount: 10_000,
          refundMode: 'auto',
          memo: '고객 요청으로 먼저 환불',
        });
        expect(wired.commandsOf('SettleChannelReturn')).toHaveLength(0);

        // 같은 금액·메모 → 그대로, 명령 1. 다르면 Conflict
        expect(await wired.cs.requestPrepay({ ...input, actorId: 'cs-2' }, tx)).toEqual(view);
        await expect(wired.cs.requestPrepay({ ...input, amount: 20_000 }, tx)).rejects.toBeInstanceOf(ConflictError);
        await expect(wired.cs.requestPrepay({ ...input, memo: '다른 메모' }, tx)).rejects.toBeInstanceOf(ConflictError);
        expect(wired.commandsOf('PrepayChannelReturn')).toHaveLength(1);
      });
    });

    it('금액 없이 선환불 → 명령에 amount 없음(Medusa 기본값), 기록 requestedAmount null', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 1 }]);

        const view = await wired.cs.requestPrepay(
          { customerReturnId: s.customerReturnId, amount: null, refundMode: 'manual', memo: '계좌로', actorId },
          tx,
        );
        expect(view.status).toBe('arrived');
        expect(view.prepayment).toMatchObject({ requestedAmount: null, refundMode: 'manual' });
        const [sent] = wired.commandsOf('PrepayChannelReturn');
        expect(sent.payload).not.toHaveProperty('amount');
        expect(sent.payload).toMatchObject({ refundMode: 'manual', memo: '계좌로' });
      });
    });

    it('검수가 끝난 반품에 선환불 → Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 2 }]);
        await s.inspect([{ skuId: w.skuId, accepted: 2 }]);

        await expect(
          wired.cs.requestPrepay(
            { customerReturnId: s.customerReturnId, amount: null, refundMode: 'auto', memo: '메모', actorId },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(wired.commandsOf('PrepayChannelReturn')).toHaveLength(0);
        expect((await recordOf(tx, s.customerReturnId)).prepayment).toBeNull();
      });
    });

    it('미도착을 닫은 반품에 선환불 → Conflict', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const wired = wire();
        const s = await seed(tx, w, wired);
        await s.arrive([{ skuId: w.skuId, quantity: 1 }]);
        await wired.cs.closeMissing({ customerReturnId: s.customerReturnId, memo: '1개 미도착', actorId }, tx);

        await expect(
          wired.cs.requestPrepay(
            { customerReturnId: s.customerReturnId, amount: null, refundMode: 'auto', memo: '메모', actorId },
            tx,
          ),
        ).rejects.toBeInstanceOf(ConflictError);
        expect(wired.commandsOf('PrepayChannelReturn')).toHaveLength(0);
      });
    });
  });

  it('반품 기록이 없으면 세 문 모두 NotFound', async () => {
    await inRollbackTx(db, async (tx) => {
      const { cs } = wire();
      const id = randomUUID();
      await expect(cs.closeMissing({ customerReturnId: id, memo: 'm', actorId }, tx)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(
        cs.settleHeld({ customerReturnId: id, deduction: 0, memo: 'm', actorId }, tx),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        cs.requestPrepay({ customerReturnId: id, amount: null, refundMode: 'auto', memo: 'm', actorId }, tx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
