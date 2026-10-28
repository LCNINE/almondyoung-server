import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { BadRequestError, ConflictError } from '@app/shared';
import type { ChannelReturnRequestedPayload } from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { StockStateEnum } from '../../inventory/schema/enum-values';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../../fulfillment/services/__support__';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedComponentSku, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import { CustomerReturnReceivingManager } from './customer-return-receiving.manager';
import { CustomerExchangeReleaser } from './customer-exchange.releaser';
import { ExchangeShipmentOpener } from '../../fulfillment/exchange-shipment/exchange-shipment-opener';
import { exchangeBoxOf } from './__support__/exchange-box';

/**
 * 반품 도착·검수 명령 (K8 PR6 Task 7). 원장은 실제 InventoryCommandService 로 쓰고, 두 발행자(고객 이벤트·채널 명령)는
 * 적재 호출만 모은다. rollback 전용 트랜잭션 — 거절 케이스는 쓰기 전에 던지므로 트랜잭션이 깨지지 않는다.
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

describeIfDb('CustomerReturnReceivingManager — 반품 도착·검수 (K8 PR6)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  const dbService = makeDbService(db);
  const { command, location, shipmentReservations } = wireLogistics(dbService);
  afterAll(async () => {
    await client.end();
  });

  function wire() {
    const coreOrders = recorder();
    const commands = recorder();
    const reader = new CustomerReturnReader(dbService);
    const intake = new CustomerReturnManager(
      dbService,
      coreOrders.publisher as never,
      new LineCompositionManager(dbService),
    );
    const manager = new CustomerReturnReceivingManager(
      dbService,
      reader,
      command,
      coreOrders.publisher as never,
      commands.publisher as never,
      new CustomerExchangeReleaser(new ExchangeShipmentOpener(shipmentReservations)),
    );
    const collected = () => coreOrders.calls().filter((e) => e.idempotencyKey.endsWith(':collected'));
    return { manager, intake, reader, collected, commands: commands.calls };
  }

  /**
   * 배송완료 소포가 있는 Medusa 회원 주문 + PR 5 반품 기록(+ 항목). 창고에는 return_default 가 있다.
   * 기본: 단품(SKU × 1) 2개를 한 소포로 배송완료, 2개 반품.
   */
  async function seed(
    tx: DbTx,
    w: World,
    opts: {
      quantity?: number;
      returnQuantity?: number;
      composition?: Array<{ skuId: string; qtyPerUnit: number }>;
      parcels?: Array<{ qtyBySku: Record<string, number> }>;
      requestedBy?: ChannelReturnRequestedPayload['requestedBy'];
      kind?: ChannelReturnRequestedPayload['kind'];
    } = {},
  ) {
    const quantity = opts.quantity ?? 2;
    const composition = opts.composition ?? [{ skuId: w.skuId, qtyPerUnit: 1 }];
    await location.ensureSystemLocations(w.warehouseId, tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity,
      composition,
      parcels: opts.parcels ?? [
        { qtyBySku: Object.fromEntries(composition.map((c) => [c.skuId, c.qtyPerUnit * quantity])) },
      ],
      customerId: randomUUID(),
      // 교환 상자 열기는 같은 FO 의 불변식을 검사한다 — 원래 소포의 출고 원장까지 남긴다
      ledger: opts.kind === 'exchange',
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
    const { intake } = wire();
    const channelReturnId = `ret_${randomUUID().slice(0, 8)}`;
    const { customerReturnId } = await intake.recordRequested(
      {
        orderId: 'ignored',
        salesChannel: 'medusa',
        externalOrderId: so.channelOrderId,
        returnId: channelReturnId,
        requestId: `req_${randomUUID().slice(0, 8)}`,
        reason: 'defective',
        feeBearer: 'seller',
        requestedBy: opts.requestedBy ?? 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items: [{ channelOrderItemId, quantity: opts.returnQuantity ?? quantity }],
        ...(opts.kind ? { kind: opts.kind } : {}),
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
    return {
      ...line,
      channelOrderItemId,
      channelOrderId: so.channelOrderId,
      channelReturnId,
      customerReturnId,
      itemOf,
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

  const stockEventsOf = (tx: DbTx, skuId: string, types: Array<'RETURN_RECEIVE' | 'RETURN_ACCEPT' | 'RETURN_REJECT'>) =>
    tx
      .select()
      .from(wmsTables.stockEvents)
      .where(and(eq(wmsTables.stockEvents.skuId, skuId), inArray(wmsTables.stockEvents.transitionType, types)));

  const arrivalsOf = (tx: DbTx, itemId: string) =>
    tx
      .select()
      .from(wmsTables.customerReturnArrivals)
      .where(eq(wmsTables.customerReturnArrivals.customerReturnItemId, itemId));

  const recordOf = async (tx: DbTx, id: string) => {
    const [row] = await tx.select().from(wmsTables.customerReturns).where(eq(wmsTables.customerReturns.id, id));
    return row;
  };

  const actorId = 'admin-1';

  it('첫 도착 → arrived, RETURNED 원장, collected 이벤트 1', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w, { requestedBy: 'operator' });
      const { manager, collected } = wire();
      const itemId = s.itemOf(w.skuId);

      const view = await manager.recordArrival(
        {
          customerReturnId: s.customerReturnId,
          warehouseId: w.warehouseId,
          items: [{ customerReturnItemId: itemId, quantity: 2 }],
          idempotencyKey: 'arrive-1',
          actorId,
        },
        tx,
      );

      expect(view).toMatchObject({
        id: s.customerReturnId,
        salesOrderId: s.salesOrderId,
        channelReturnId: s.channelReturnId,
        status: 'arrived',
        warehouseId: w.warehouseId,
        inspectedAt: null,
        settledAt: null,
        settlement: null,
        settlementOutcome: null,
      });
      expect(typeof view.arrivedAt).toBe('string');
      expect(view.lines).toEqual([
        expect.objectContaining({
          salesOrderLineId: s.lineId,
          channelOrderItemId: s.channelOrderItemId,
          quantity: 2,
          items: [
            expect.objectContaining({
              id: itemId,
              skuId: w.skuId,
              qtyPerUnit: 1,
              expectedQty: 2,
              arrivedQty: 2,
              acceptedQty: null,
              rejectedQty: null,
              heldQty: null,
            }),
          ],
        }),
      ]);
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'RETURNED')).toBe(2);
      const [arrival] = await arrivalsOf(tx, itemId);
      expect(arrival).toMatchObject({ quantity: 2, idempotencyKey: `arrive-1:${itemId}`, arrivedBy: actorId });
      const [event] = await stockEventsOf(tx, w.skuId, ['RETURN_RECEIVE']);
      expect(event).toMatchObject({
        id: arrival.stockEventId,
        idempotencyKey: `customer-return-arrival:${arrival.id}`,
      });
      const events = collected();
      expect(events).toHaveLength(1);
      expect(events[0].idempotencyKey).toBe(`so-claim:return:${s.customerReturnId}:collected`);
      expect(events[0].payload).toMatchObject({
        kind: 'return',
        stage: 'collected',
        requestId: s.customerReturnId,
        requestedBy: 'admin',
      });
    });
  });

  it('교환 반품 도착 → collected 이벤트 kind exchange (N19)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w, { kind: 'exchange' });
      const { manager, collected } = wire();

      await manager.recordArrival(
        {
          customerReturnId: s.customerReturnId,
          warehouseId: w.warehouseId,
          items: [{ customerReturnItemId: s.itemOf(w.skuId), quantity: 2 }],
          idempotencyKey: 'arrive-exchange',
          actorId,
        },
        tx,
      );

      const events = collected();
      expect(events).toHaveLength(1);
      expect(events[0].idempotencyKey).toBe(`so-claim:exchange:${s.customerReturnId}:collected`);
      expect(events[0].payload).toMatchObject({ kind: 'exchange', stage: 'collected', requestId: s.customerReturnId });
    });
  });

  it('두 소포로 나눠 도착 → 도착 행 2, collected 1, 합 초과 세 번째는 거절', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager, collected } = wire();
      const itemId = s.itemOf(w.skuId);
      const arrive = (key: string, quantity: number) =>
        manager.recordArrival(
          {
            customerReturnId: s.customerReturnId,
            warehouseId: w.warehouseId,
            items: [{ customerReturnItemId: itemId, quantity }],
            idempotencyKey: key,
            actorId,
          },
          tx,
        );

      await arrive('parcel-1', 1);
      const second = await arrive('parcel-2', 1);
      await expect(arrive('parcel-3', 1)).rejects.toBeInstanceOf(BadRequestError);

      expect(second.status).toBe('arrived');
      expect(second.lines[0].items[0].arrivedQty).toBe(2);
      expect(await arrivalsOf(tx, itemId)).toHaveLength(2);
      expect(await stockEventsOf(tx, w.skuId, ['RETURN_RECEIVE'])).toHaveLength(2);
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'RETURNED')).toBe(2);
      expect(collected()).toHaveLength(1);
    });
  });

  it('같은 키로 도착 두 번 → 행 1·원장 이벤트 1, 다른 수량이면 409', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager } = wire();
      const itemId = s.itemOf(w.skuId);
      const arrive = (quantity: number) =>
        manager.recordArrival(
          {
            customerReturnId: s.customerReturnId,
            warehouseId: w.warehouseId,
            items: [{ customerReturnItemId: itemId, quantity }],
            idempotencyKey: 'same-key',
            actorId,
          },
          tx,
        );

      const first = await arrive(1);
      const again = await arrive(1);
      await expect(arrive(2)).rejects.toBeInstanceOf(ConflictError);

      expect(again).toEqual(first);
      expect(await arrivalsOf(tx, itemId)).toHaveLength(1);
      expect(await stockEventsOf(tx, w.skuId, ['RETURN_RECEIVE'])).toHaveLength(1);
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'RETURNED')).toBe(1);
    });
  });

  it('배송완료하지 않은 창고로 도착 → BadRequest', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const other = await seedWorld(tx);
      await location.ensureSystemLocations(other.warehouseId, tx);
      const { manager, collected } = wire();

      await expect(
        manager.recordArrival(
          {
            customerReturnId: s.customerReturnId,
            warehouseId: other.warehouseId,
            items: [{ customerReturnItemId: s.itemOf(w.skuId), quantity: 1 }],
            idempotencyKey: 'wrong-wh',
            actorId,
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);

      expect((await recordOf(tx, s.customerReturnId)).status).toBe('expected');
      expect(await arrivalsOf(tx, s.itemOf(w.skuId))).toHaveLength(0);
      expect(collected()).toHaveLength(0);
    });
  });

  it('첫 도착과 다른 창고 → BadRequest (두 창고 다 배송완료했어도)', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w, { parcels: [{ qtyBySku: { [w.skuId]: 1 } }, { qtyBySku: { [w.skuId]: 1 } }] });
      const other = await seedWorld(tx);
      await location.ensureSystemLocations(other.warehouseId, tx);
      // 두 번째 소포는 다른 창고가 보냈다
      await tx
        .update(wmsTables.shipments)
        .set({ warehouseId: other.warehouseId })
        .where(eq(wmsTables.shipments.id, s.parcels[1].shipmentId));
      const { manager } = wire();
      const itemId = s.itemOf(w.skuId);
      const arrive = (warehouseId: string, key: string) =>
        manager.recordArrival(
          {
            customerReturnId: s.customerReturnId,
            warehouseId,
            items: [{ customerReturnItemId: itemId, quantity: 1 }],
            idempotencyKey: key,
            actorId,
          },
          tx,
        );

      await arrive(w.warehouseId, 'first');
      await expect(arrive(other.warehouseId, 'second')).rejects.toBeInstanceOf(BadRequestError);

      expect(await arrivalsOf(tx, itemId)).toHaveLength(1);
      expect((await recordOf(tx, s.customerReturnId)).warehouseId).toBe(w.warehouseId);
    });
  });

  it('그 반품의 항목이 아니면 BadRequest', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const t = await seed(tx, w);
      const { manager } = wire();

      await expect(
        manager.recordArrival(
          {
            customerReturnId: s.customerReturnId,
            warehouseId: w.warehouseId,
            items: [{ customerReturnItemId: t.itemOf(w.skuId), quantity: 1 }],
            idempotencyKey: 'foreign-item',
            actorId,
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  it('취소된 반품에 도착 → Conflict', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager, intake } = wire();
      await intake.recordCancelled(
        {
          orderId: 'ignored',
          salesChannel: 'medusa',
          externalOrderId: s.channelOrderId,
          returnId: s.channelReturnId,
          cancelledAt: '2026-10-27T02:00:00.000Z',
        },
        tx,
      );

      await expect(
        manager.recordArrival(
          {
            customerReturnId: s.customerReturnId,
            warehouseId: w.warehouseId,
            items: [{ customerReturnItemId: s.itemOf(w.skuId), quantity: 1 }],
            idempotencyKey: 'after-cancel',
            actorId,
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(await arrivalsOf(tx, s.itemOf(w.skuId))).toHaveLength(0);
    });
  });

  async function arriveAll(
    manager: CustomerReturnReceivingManager,
    tx: DbTx,
    s: { customerReturnId: string },
    warehouseId: string,
    items: Array<{ customerReturnItemId: string; quantity: number }>,
  ) {
    await manager.recordArrival(
      { customerReturnId: s.customerReturnId, warehouseId, items, idempotencyKey: `all-${randomUUID()}`, actorId },
      tx,
    );
  }

  it('검수 양품 1·불량 1 → inspected, ON_HAND 1·DEFECTIVE 1, SettleChannelReturn 1(received 1·dismissed 1), 정산 칸 in_progress', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager, commands } = wire();
      const itemId = s.itemOf(w.skuId);
      await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);

      const view = await manager.recordInspection(
        {
          customerReturnId: s.customerReturnId,
          items: [{ customerReturnItemId: itemId, accepted: 1, rejected: 1, held: 0 }],
          actorId,
        },
        tx,
      );

      expect(view.status).toBe('inspected');
      expect(typeof view.inspectedAt).toBe('string');
      expect(view.lines[0].items[0]).toMatchObject({ acceptedQty: 1, rejectedQty: 1, heldQty: 0, arrivedQty: 2 });
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'RETURNED')).toBe(0);
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'ON_HAND')).toBe(1);
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'DEFECTIVE')).toBe(1);
      const ledger = await stockEventsOf(tx, w.skuId, ['RETURN_ACCEPT', 'RETURN_REJECT']);
      expect(ledger.map((e) => e.idempotencyKey).sort()).toEqual(
        [`customer-return-inspect:${itemId}:accept`, `customer-return-inspect:${itemId}:reject`].sort(),
      );

      const sent = commands();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        eventType: 'SettleChannelReturn',
        idempotencyKey: `customer-return-settle:${s.customerReturnId}:issue:1`,
        partitionKey: `medusa:${s.channelOrderId}`,
      });
      const { requestedAt, ...payload } = sent[0].payload;
      expect(typeof requestedAt).toBe('string');
      expect(payload).toEqual({
        requestId: s.customerReturnId,
        salesChannel: 'medusa',
        externalOrderId: s.channelOrderId,
        returnId: s.channelReturnId,
        items: [{ channelOrderItemId: s.channelOrderItemId, received: 1, dismissed: 1 }],
        refundMode: 'auto',
      });

      const record = await recordOf(tx, s.customerReturnId);
      expect(record.settlement).toMatchObject({
        state: 'in_progress',
        refundMode: 'auto',
        attempts: 1,
        lastFailure: null,
      });
      expect(record.settlement?.startedAt).toBe(record.inspectedAt?.toISOString());
      expect(record.settlement?.lastIssuedAt).toBe(record.settlement?.startedAt);
      expect(view.settlement).toEqual(record.settlement);
    });
  });

  it('세트 A×2·B×1 1벌, B 불량 1 → 명령 dismissed 1', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const b = await seedComponentSku(tx, w);
      const s = await seed(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 2 },
          { skuId: b, qtyPerUnit: 1 },
        ],
      });
      const { manager, commands } = wire();
      await arriveAll(manager, tx, s, w.warehouseId, [
        { customerReturnItemId: s.itemOf(w.skuId), quantity: 2 },
        { customerReturnItemId: s.itemOf(b), quantity: 1 },
      ]);

      await manager.recordInspection(
        {
          customerReturnId: s.customerReturnId,
          items: [
            { customerReturnItemId: s.itemOf(w.skuId), accepted: 2, rejected: 0, held: 0 },
            { customerReturnItemId: s.itemOf(b), accepted: 0, rejected: 1, held: 0 },
          ],
          actorId,
        },
        tx,
      );

      // 양품만 있는 항목은 accept 하나, 불량만 있는 항목은 reject 하나 — 0 수량 호출은 없다
      expect(await stockEventsOf(tx, w.skuId, ['RETURN_ACCEPT', 'RETURN_REJECT'])).toHaveLength(1);
      expect(await stockEventsOf(tx, b, ['RETURN_ACCEPT', 'RETURN_REJECT'])).toHaveLength(1);
      expect(commands()[0].payload.items).toEqual([
        { channelOrderItemId: s.channelOrderItemId, received: 0, dismissed: 1 },
      ]);
    });
  });

  it('검수에 보류가 있으면 held, 명령 0, 보류 수량은 DEFECTIVE', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager, commands } = wire();
      const itemId = s.itemOf(w.skuId);
      await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);

      const view = await manager.recordInspection(
        {
          customerReturnId: s.customerReturnId,
          items: [{ customerReturnItemId: itemId, accepted: 1, rejected: 0, held: 1 }],
          actorId,
        },
        tx,
      );

      expect(view.status).toBe('held');
      expect(view.settlement).toBeNull();
      expect(commands()).toHaveLength(0);
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'ON_HAND')).toBe(1);
      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'DEFECTIVE')).toBe(1);
      const record = await recordOf(tx, s.customerReturnId);
      expect(record.settlement).toBeNull();
      expect(record.inspectedAt).not.toBeNull();
    });
  });

  it('부분 도착 상태의 검수 → BadRequest, 원장 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager, commands } = wire();
      const itemId = s.itemOf(w.skuId);
      await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 1 }]);

      await expect(
        manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted: 1, rejected: 0, held: 0 }],
            actorId,
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);

      expect(await ledgerQty(tx, w.skuId, w.warehouseId, 'RETURNED')).toBe(1);
      expect(await stockEventsOf(tx, w.skuId, ['RETURN_ACCEPT', 'RETURN_REJECT'])).toHaveLength(0);
      expect((await recordOf(tx, s.customerReturnId)).status).toBe('arrived');
      expect(commands()).toHaveLength(0);
    });
  });

  it('같은 검수 두 번 → 원장 이벤트·명령 각 1, 같은 응답 / 다른 결과 → Conflict', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager, commands } = wire();
      const itemId = s.itemOf(w.skuId);
      await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);
      const inspect = (accepted: number, rejected: number) =>
        manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted, rejected, held: 0 }],
            actorId,
          },
          tx,
        );

      const first = await inspect(1, 1);
      const again = await inspect(1, 1);
      await expect(inspect(2, 0)).rejects.toBeInstanceOf(ConflictError);

      expect(again).toEqual(first);
      expect(await stockEventsOf(tx, w.skuId, ['RETURN_ACCEPT'])).toHaveLength(1);
      expect(await stockEventsOf(tx, w.skuId, ['RETURN_REJECT'])).toHaveLength(1);
      expect(commands()).toHaveLength(1);
    });
  });

  it('처음 검수한 사람을 inspectedBy 로 남기고, 같은 결과 재요청은 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager } = wire();
      const itemId = s.itemOf(w.skuId);
      await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);
      const inspect = (by: string) =>
        manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted: 2, rejected: 0, held: 0 }],
            actorId: by,
          },
          tx,
        );

      const first = await inspect('u-1');
      expect(first.inspectedBy).toBe('u-1');
      const again = await inspect('u-2');
      expect(again.inspectedBy).toBe('u-1');
      expect((await recordOf(tx, s.customerReturnId)).inspectedBy).toBe('u-1');
    });
  });

  it('보류가 있는 검수(held)도 inspectedBy 를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager } = wire();
      const itemId = s.itemOf(w.skuId);
      await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);

      const view = await manager.recordInspection(
        {
          customerReturnId: s.customerReturnId,
          items: [{ customerReturnItemId: itemId, accepted: 1, rejected: 0, held: 1 }],
          actorId: 'u-3',
        },
        tx,
      );
      expect(view.status).toBe('held');
      expect(view.inspectedBy).toBe('u-3');
    });
  });

  it('합이 도착 수량과 다른 검수 → BadRequest', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      const { manager } = wire();
      const itemId = s.itemOf(w.skuId);
      await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);

      await expect(
        manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted: 1, rejected: 0, held: 0 }],
            actorId,
          },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect((await recordOf(tx, s.customerReturnId)).status).toBe('arrived');
    });
  });

  it('검수가 항목을 빠뜨리거나 두 번 적으면 BadRequest', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const b = await seedComponentSku(tx, w);
      const s = await seed(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: b, qtyPerUnit: 1 },
        ],
      });
      const { manager } = wire();
      await arriveAll(manager, tx, s, w.warehouseId, [
        { customerReturnItemId: s.itemOf(w.skuId), quantity: 1 },
        { customerReturnItemId: s.itemOf(b), quantity: 1 },
      ]);
      const a = { customerReturnItemId: s.itemOf(w.skuId), accepted: 1, rejected: 0, held: 0 };

      await expect(
        manager.recordInspection({ customerReturnId: s.customerReturnId, items: [a], actorId }, tx),
      ).rejects.toBeInstanceOf(BadRequestError);
      await expect(
        manager.recordInspection({ customerReturnId: s.customerReturnId, items: [a, a], actorId }, tx),
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });
  describe('교환 검수 (K8 PR11 N14 ①)', () => {
    const inspector = randomUUID();

    it('교환 + 보류 없음 → inspected + 정산 명령 1 + 교환 상자 1(같은 트랜잭션), 연 사람 = 검수자', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const s = await seed(tx, w, { kind: 'exchange' });
        const { manager, commands } = wire();
        const itemId = s.itemOf(w.skuId);
        await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);

        const view = await manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted: 2, rejected: 0, held: 0 }],
            actorId: inspector,
          },
          tx,
        );

        expect(view.status).toBe('inspected');
        expect(typeof view.exchangeReleasedAt).toBe('string');
        expect(commands().filter((e) => e.eventType === 'SettleChannelReturn')).toHaveLength(1);
        const box = await exchangeBoxOf(tx, s.salesOrderId);
        expect(box.shipments).toEqual([expect.objectContaining({ status: 'draft', warehouseId: w.warehouseId })]);
        expect(box.items).toEqual([expect.objectContaining({ skuId: w.skuId, qty: 2 })]);
        // 검수가 ON_HAND 로 돌린 양품 2 가 예약 후보다
        expect(box.reserved).toBe(2);
        expect((await recordOf(tx, s.customerReturnId)).exchangeReleasedBy).toBe(inspector);
      });
    });

    it('재고가 모자라도 검수는 커밋된다 — 상자는 덜 잡힌 draft', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const s = await seed(tx, w, { kind: 'exchange' });
        const { manager, commands } = wire();
        const itemId = s.itemOf(w.skuId);
        await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);

        // 모두 불량 — 팔 수 있는 재고가 0 이다
        const view = await manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted: 0, rejected: 2, held: 0 }],
            actorId: inspector,
          },
          tx,
        );

        expect(view.status).toBe('inspected');
        expect(commands().filter((e) => e.eventType === 'SettleChannelReturn')).toHaveLength(1);
        const box = await exchangeBoxOf(tx, s.salesOrderId);
        expect(box.shipments).toEqual([expect.objectContaining({ status: 'draft' })]);
        expect(box.reserved).toBe(0);
      });
    });

    it('교환 + 보류 → held, 상자 0', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const s = await seed(tx, w, { kind: 'exchange' });
        const { manager } = wire();
        const itemId = s.itemOf(w.skuId);
        await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);

        const view = await manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted: 1, rejected: 0, held: 1 }],
            actorId: inspector,
          },
          tx,
        );

        expect(view.status).toBe('held');
        expect(view.exchangeReleasedAt).toBeNull();
        const box = await exchangeBoxOf(tx, s.salesOrderId);
        expect(box.items).toHaveLength(0);
        expect(box.shipments).toHaveLength(0);
      });
    });

    it('반품(kind return) 검수 → 상자 0 (회귀)', async () => {
      await inRollbackTx(db, async (tx) => {
        const w = await seedWorld(tx);
        const s = await seed(tx, w);
        const { manager } = wire();
        const itemId = s.itemOf(w.skuId);
        await arriveAll(manager, tx, s, w.warehouseId, [{ customerReturnItemId: itemId, quantity: 2 }]);
        const shipmentsBefore = await tx.select({ id: wmsTables.shipments.id }).from(wmsTables.shipments);

        const view = await manager.recordInspection(
          {
            customerReturnId: s.customerReturnId,
            items: [{ customerReturnItemId: itemId, accepted: 2, rejected: 0, held: 0 }],
            actorId,
          },
          tx,
        );

        expect(view.status).toBe('inspected');
        expect(view.exchangeReleasedAt).toBeNull();
        const shipmentsAfter = await tx.select({ id: wmsTables.shipments.id }).from(wmsTables.shipments);
        expect(shipmentsAfter).toHaveLength(shipmentsBefore.length);
      });
    });
  });
});
