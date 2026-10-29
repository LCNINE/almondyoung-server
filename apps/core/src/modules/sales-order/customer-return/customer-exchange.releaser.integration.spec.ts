import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type { ChannelReturnRequestedPayload } from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService, wireLogistics } from '../../fulfillment/services/__support__';
import { seedSpareStock } from '../../fulfillment/services/__support__/short-pick-fixtures';
import { seedWorld, World } from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedComponentSku, seedDeliveredLine } from '../line-quantities/__support__/claim-facts.fixtures';
import { LineCompositionManager } from '../../product-matching/line-composition/line-composition.manager';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerExchangeReleaser } from './customer-exchange.releaser';
import { ExchangeShipmentOpener } from '../../fulfillment/exchange-shipment/exchange-shipment-opener';
import { exchangeBoxOf } from './__support__/exchange-box';

/**
 * 교환 상자 열기 (K8 PR11 N13). 접수는 실제 CustomerReturnManager(교환 줄을 만든다), 예약은 실제 ShipmentReservationService.
 * rollback 전용 트랜잭션.
 *
 * 실행: DATABASE_URL=<scratch core DB> npx jest --runTestsByPath <this file> --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CustomerExchangeReleaser — 교환 상자 열기 (K8 PR11)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  const dbService = makeDbService(db);
  const { location, shipmentReservations } = wireLogistics(dbService);
  afterAll(async () => {
    await client.end();
  });

  const releaser = new CustomerExchangeReleaser(new ExchangeShipmentOpener(shipmentReservations));
  const actorId = randomUUID();
  const PICKUP_ADDRESS = {
    recipientName: '회수지',
    phone: '010',
    postalCode: '1',
    roadAddress: 'r',
    detailAddress: 'd',
  };

  async function seed(
    tx: DbTx,
    w: World,
    opts: {
      quantity?: number;
      composition?: Array<{ skuId: string; qtyPerUnit: number }>;
      kind?: ChannelReturnRequestedPayload['kind'];
    } = {},
  ) {
    const quantity = opts.quantity ?? 2;
    const composition = opts.composition ?? [{ skuId: w.skuId, qtyPerUnit: 1 }];
    await location.ensureSystemLocations(w.warehouseId, tx);
    const line = await seedDeliveredLine(tx, w, {
      quantity,
      composition,
      parcels: [{ qtyBySku: Object.fromEntries(composition.map((c) => [c.skuId, c.qtyPerUnit * quantity])) }],
      customerId: randomUUID(),
      ledger: true,
    });
    // 배송완료 상자의 주소 = 회수지(readPickupSource) — 교환 상자의 받는 사람이 된다
    await tx
      .update(wmsTables.shipments)
      .set({ recipientSnapshot: PICKUP_ADDRESS })
      .where(eq(wmsTables.shipments.id, line.parcels[0].shipmentId));
    const channelOrderItemId = `item_${randomUUID().slice(0, 8)}`;
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId })
      .where(eq(wmsTables.salesOrderLines.id, line.lineId));
    const [so] = await tx
      .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, line.salesOrderId));
    const intake = new CustomerReturnManager(
      dbService,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as never,
      new LineCompositionManager(dbService),
    );
    const { customerReturnId } = await intake.recordRequested(
      {
        orderId: 'ignored',
        salesChannel: 'medusa',
        externalOrderId: so.channelOrderId,
        returnId: `ret_${randomUUID().slice(0, 8)}`,
        requestId: `req_${randomUUID().slice(0, 8)}`,
        reason: 'defective',
        feeBearer: 'seller',
        requestedBy: 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items: [{ channelOrderItemId, quantity }],
        kind: opts.kind ?? 'exchange',
      },
      tx,
    );
    const [fo] = await tx
      .select({ id: wmsTables.fulfillmentOrders.id })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, line.salesOrderId));
    return { ...line, customerReturnId, foId: fo.id };
  }

  const recordOf = async (tx: DbTx, id: string) => {
    const [row] = await tx.select().from(wmsTables.customerReturns).where(eq(wmsTables.customerReturns.id, id));
    return row;
  };

  it('단일 SKU 교환 줄 → 기존 FO 에 FOI 1, draft 상자 1(창고 = FO 창고, 받는 사람 = 회수지), 예약 = 수량, 열린 시각·사람', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      await seedSpareStock(tx, { skuId: w.skuId, warehouseId: w.warehouseId }, 5);

      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId })).toBe(true);

      const box = await exchangeBoxOf(tx, s.salesOrderId);
      expect(box.items).toEqual([
        expect.objectContaining({
          fulfillmentOrderId: s.foId,
          salesOrderId: s.salesOrderId,
          salesOrderLineId: box.lines[0].id,
          skuId: w.skuId,
          qty: 2,
          shippedQty: 0,
          reservedQty: 2,
          status: 'ready',
        }),
      ]);
      expect(box.shipments).toEqual([
        expect.objectContaining({ status: 'draft', warehouseId: w.warehouseId, recipientSnapshot: PICKUP_ADDRESS }),
      ]);
      expect(box.shipmentLines).toEqual([expect.objectContaining({ skuId: w.skuId, qty: 2 })]);
      expect(box.reserved).toBe(2);
      const record = await recordOf(tx, s.customerReturnId);
      expect(record.exchangeReleasedAt).toBeInstanceOf(Date);
      expect(record.exchangeReleasedBy).toBe(actorId);
      // FO 합계가 새 항목을 센다
      const [fo] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, s.foId));
      expect(fo).toMatchObject({ totalItems: 2, totalQty: 4 });
    });
  });

  it('세트 줄(구성품 2) → FOI 2·상자 줄 2', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const second = await seedComponentSku(tx, w);
      const s = await seed(tx, w, {
        quantity: 1,
        composition: [
          { skuId: w.skuId, qtyPerUnit: 1 },
          { skuId: second, qtyPerUnit: 2 },
        ],
      });
      await seedSpareStock(tx, { skuId: w.skuId, warehouseId: w.warehouseId }, 5);
      await seedSpareStock(tx, { skuId: second, warehouseId: w.warehouseId }, 5);

      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId })).toBe(true);

      const box = await exchangeBoxOf(tx, s.salesOrderId);
      expect(box.items.map((item) => [item.skuId, item.qty]).sort()).toEqual(
        [
          [w.skuId, 1],
          [second, 2],
        ].sort(),
      );
      expect(box.shipments).toHaveLength(1);
      expect(box.shipmentLines).toHaveLength(2);
      expect(box.reserved).toBe(3);
    });
  });

  it('재고 0 → 상자 draft·예약 0, 예외 없음', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);

      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId })).toBe(true);

      const box = await exchangeBoxOf(tx, s.salesOrderId);
      expect(box.shipments).toEqual([expect.objectContaining({ status: 'draft' })]);
      expect(box.reserved).toBe(0);
      expect(box.items).toEqual([expect.objectContaining({ qty: 2, reservedQty: 0, status: 'created' })]);
      expect((await recordOf(tx, s.customerReturnId)).exchangeReleasedAt).toBeInstanceOf(Date);
    });
  });

  it('두 번 부르면 false·FOI 그대로', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w);
      await seedSpareStock(tx, { skuId: w.skuId, warehouseId: w.warehouseId }, 5);

      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId })).toBe(true);
      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId })).toBe(false);

      const box = await exchangeBoxOf(tx, s.salesOrderId);
      expect(box.items).toHaveLength(1);
      expect(box.shipments).toHaveLength(1);
      expect(box.reserved).toBe(2);
    });
  });

  it('kind return 이면 false·아무것도 안 함', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await seedWorld(tx);
      const s = await seed(tx, w, { kind: 'return' });
      const itemsBefore = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, s.foId));

      expect(await releaser.release(tx, { customerReturnId: s.customerReturnId, actorId })).toBe(false);

      const itemsAfter = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, s.foId));
      expect(itemsAfter).toHaveLength(itemsBefore.length);
      expect((await recordOf(tx, s.customerReturnId)).exchangeReleasedAt).toBeNull();
    });
  });
});
