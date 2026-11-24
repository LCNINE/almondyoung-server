import { randomUUID } from 'crypto';
import { and, eq, sql as sqlQuery } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { buildWiring, makeInboundReceiptKernel } from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { InboundPipelineReader } from '../../inventory/stock-projection/services/inbound-pipeline.reader';
import { WarehouseTransferReader } from '../../inventory/warehouse-transfer/services/warehouse-transfer.reader';
import { PurchaseOrderExpectedArrivalReader } from '../../inventory/procurement/services/purchase-order-expected-arrival.reader';
import { OutboundPreparationReader } from '../outbound-preparation/outbound-preparation.reader';
import { ConsolidationBoardReader } from '../services/consolidation-board.reader';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentProgressService } from '../services/fulfillment-progress.service';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { inRollbackTx, makeDb, seedPickableShipment, seedShipmentForExistingStock } from '../services/__support__';
import { seedHandedOverOrder } from '../services/__support__/sellmate-handed-over-fixtures';
import {
  addSecondSimpleOutboundLine,
  seedLooseBox,
  seedTwoBoxBatch,
} from '../services/__support__/simple-outbound-fixtures';
import { seedRegisteredWaybill } from '../services/__support__/outbound-v2-warehouse-harness';
import { ambientDbService, assembleOutbound, startBatchFor } from '../services/__support__/simple-outbound-wiring';
import { ReadyShipmentsReader } from './ready-shipments.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Box = Awaited<ReturnType<typeof seedPickableShipment>>;

describeIfDb('입고로 갖춰진 상자', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const reader = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    const preparation = new OutboundPreparationReader(
      dbService,
      new ConsolidationBoardReader(dbService),
      new InboundPipelineReader(
        dbService,
        new WarehouseTransferReader(dbService),
        new PurchaseOrderExpectedArrivalReader(dbService),
      ),
    );
    return new ReadyShipmentsReader(dbService, preparation);
  };
  // 입고 뒤 예약 재시도가 부르는 것과 같은 예약 경로
  const reservations = (tx: DbTx) => {
    const { dbService, sellable } = buildWiring(tx as never);
    return new ShipmentReservationService(
      dbService,
      new UnifiedReservationService(dbService, sellable),
      new FulfillmentProgressService(),
      new FulfillmentInvariantService(),
    );
  };
  const ready = (tx: DbTx, warehouseId: string, receiptLineIds: string[]) =>
    reader(tx).forReceiptLines(warehouseId, receiptLineIds);
  const idsOf = async (tx: DbTx, warehouseId: string, receiptLineIds: string[]) =>
    (await ready(tx, warehouseId, receiptLineIds)).items.map((item) => item.shipmentId);

  const setShipment = (
    tx: DbTx,
    box: Pick<Box, 'shipmentId'>,
    values: Partial<typeof wmsTables.shipments.$inferInsert>,
  ) => tx.update(wmsTables.shipments).set(values).where(eq(wmsTables.shipments.id, box.shipmentId));

  // 픽스처는 상자마다 대기 중인 작업 항목을 만든다 — 배치에 들지 않은 상자로 만든다
  const leaveBatch = (tx: DbTx, box: Pick<Box, 'shipmentId'>) =>
    tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.shipmentId, box.shipmentId));

  async function salesOrderOf(tx: DbTx, box: Pick<Box, 'shipmentLineId'>) {
    const [row] = await tx
      .select({
        fulfillmentOrderId: wmsTables.fulfillmentOrders.id,
        salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
      })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
    return row;
  }

  /** 다른 상자 — 같은 상품·같은 창고, 배치에 들지 않은 draft */
  async function sibling(tx: DbTx, box: Box, qty: number): Promise<Box> {
    const [shipment] = await tx
      .select({ shippingProfileId: wmsTables.shipments.shippingProfileId })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, box.shipmentId));
    const next = await seedShipmentForExistingStock(
      tx,
      { ...box, deliveryProfileId: shipment.shippingProfileId ?? '' },
      qty,
    );
    await leaveBatch(tx, next);
    await setShipment(tx, next, { status: 'draft' });
    return next;
  }

  const setShelf = (tx: DbTx, box: Box, qty: number) =>
    tx
      .update(wmsTables.stockLedgers)
      .set({ qty })
      .where(and(eq(wmsTables.stockLedgers.skuId, box.skuId), eq(wmsTables.stockLedgers.locationId, box.locationId)));

  // 입고 전에 만들고 마지막으로 늘린 예약으로 만든다
  const reservedBeforeArrival = (tx: DbTx, box: Pick<Box, 'shipmentLineId'>, quantity?: number) =>
    tx
      .update(wmsTables.stockReservations)
      .set({
        createdAt: sqlQuery`now() - interval '1 minute'`,
        updatedAt: sqlQuery`now() - interval '1 minute'`,
        ...(quantity === undefined ? {} : { quantity }),
      })
      .where(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId));

  /**
   * 입고 뒤 잡힌 예약으로 다 찬 상자. 선반을 비우고 예약을 푼 상자에 입고하고, 그 줄을 다시 예약한다.
   * 한 트랜잭션 안이라 입고 줄의 created_at 과 새 예약의 updated_at 은 같다(기준은 `>=`).
   */
  async function filledByArrival(tx: DbTx, qty = 2) {
    const box = await seedPickableShipment(tx, qty);
    await setShelf(tx, box, 0);
    await tx
      .update(wmsTables.stockReservations)
      .set({ status: 'released' })
      .where(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId));
    await leaveBatch(tx, box);
    await setShipment(tx, box, { status: 'draft' });

    const kernel = makeInboundReceiptKernel(tx as never);
    const receipt = await kernel.recordArrival(
      {
        source: 'direct',
        method: 'simple',
        warehouseId: box.warehouseId,
        reason: 'ready shipments',
        lines: [{ skuId: box.skuId, quantity: qty, eventKey: randomUUID() }],
      },
      tx,
    );
    const receiptLineId = receipt.lines[0].id;
    expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([]);

    const reserved = await reservations(tx).reservePartial(box.shipmentLineId, qty, tx);
    expect(reserved.totalReservedQty).toBe(qty);

    const putaway = () =>
      kernel.putaway({ receiptLineId, toLocationId: box.locationId, quantity: qty, eventKey: randomUUID() }, tx);
    return { box, receiptLineId, receiptId: receipt.receipt.id, putaway };
  }

  it('입고 뒤 잡힌 예약으로 다 찬 상자가 적치 전에는 putaway_required, 적치하면 ready', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId, putaway } = await filledByArrival(tx);

      const before = await ready(tx, box.warehouseId, [receiptLineId]);
      expect(before.waitingOnOtherSkus).toBe(0);
      expect(
        before.items.map((item) => ({
          shipmentId: item.shipmentId,
          status: item.status,
          skuCount: item.skuCount,
          totalQty: item.totalQty,
          readiness: item.readiness,
        })),
      ).toEqual([
        { shipmentId: box.shipmentId, status: 'draft', skuCount: 1, totalQty: 2, readiness: 'putaway_required' },
      ]);
      const [{ orderNos, recipientMasked }] = before.items;
      expect(orderNos).toHaveLength(1);
      expect(orderNos[0]).not.toBe('');
      expect(recipientMasked).not.toBe('Simple Test');
      expect(recipientMasked.startsWith('Simple')).toBe(true);

      await putaway();
      const after = await ready(tx, box.warehouseId, [receiptLineId]);
      expect(after.items.map((item) => [item.shipmentId, item.readiness])).toEqual([[box.shipmentId, 'ready']]);
    });
  });

  it('입고 전부터 다 갖춰져 있던 상자는 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId } = await filledByArrival(tx);
      const earlier = await sibling(tx, box, 1);
      await reservedBeforeArrival(tx, earlier);
      // 재고가 모자라 빠지는 것이 아님을 보인다 — 선반에 그 상자 몫이 있다
      await setShelf(tx, box, 1);

      expect(await ready(tx, box.warehouseId, [receiptLineId])).toEqual({
        items: [expect.objectContaining({ shipmentId: box.shipmentId })],
        waitingOnOtherSkus: 0,
      });
    });
  });

  it('입고 전에 일부만 예약됐다가 이번 입고로 다 찬 상자도 나온다', async () => {
    await inRollbackTx(db, async (tx) => {
      // 줄 수량 2 중 선반의 1 만 입고 전에 예약됐다
      const box = await seedPickableShipment(tx, 2);
      await setShelf(tx, box, 1);
      await reservedBeforeArrival(tx, box, 1);
      await leaveBatch(tx, box);
      await setShipment(tx, box, { status: 'draft' });

      const receipt = await makeInboundReceiptKernel(tx as never).recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: box.warehouseId,
          reason: 'ready shipments',
          lines: [{ skuId: box.skuId, quantity: 1, eventKey: randomUUID() }],
        },
        tx,
      );
      const receiptLineId = receipt.lines[0].id;
      expect(await ready(tx, box.warehouseId, [receiptLineId])).toEqual({ items: [], waitingOnOtherSkus: 0 });

      // 재시도는 있던 예약 행을 제자리에서 늘린다
      const reserved = await reservations(tx).reservePartial(box.shipmentLineId, 1, tx);
      expect(reserved.totalReservedQty).toBe(2);
      const rows = await tx
        .select({ id: wmsTables.stockReservations.id })
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      expect(rows).toHaveLength(1);

      const { items } = await ready(tx, box.warehouseId, [receiptLineId]);
      expect(items.map((item) => [item.shipmentId, item.readiness])).toEqual([[box.shipmentId, 'putaway_required']]);
    });
  });

  it('다른 창고·취소된 회차·없는 입고 줄은 무시한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId, receiptId } = await filledByArrival(tx);
      const [warehouse] = await tx.insert(wmsTables.warehouses).values({ name: randomUUID() }).returning();
      const empty = { items: [], waitingOnOtherSkus: 0 };

      expect(await ready(tx, warehouse.id, [receiptLineId])).toEqual(empty);
      expect(await ready(tx, box.warehouseId, [randomUUID()])).toEqual(empty);
      expect(await ready(tx, box.warehouseId, [])).toEqual(empty);

      await tx
        .update(wmsTables.inboundReceipts)
        .set({ status: 'voided' })
        .where(eq(wmsTables.inboundReceipts.id, receiptId));
      expect(await ready(tx, box.warehouseId, [receiptLineId])).toEqual(empty);
    });
  });

  it('예약이 덜 찬 상자는 빠지고, 다른 상품이 모자라면 waitingOnOtherSkus 에 센다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId } = await filledByArrival(tx);
      const other = await addSecondSimpleOutboundLine(tx, box, 1);
      await tx
        .update(wmsTables.stockReservations)
        .set({ status: 'released' })
        .where(eq(wmsTables.stockReservations.shipmentLineId, other.shipmentLineId));
      // 기준 상품 줄 자체가 덜 찬 상자 — 입고 뒤 예약이 있지만 3 중 1 만
      const short = await sibling(tx, box, 3);
      await tx
        .update(wmsTables.stockReservations)
        .set({ quantity: 1 })
        .where(eq(wmsTables.stockReservations.shipmentLineId, short.shipmentLineId));

      expect(await ready(tx, box.warehouseId, [receiptLineId])).toEqual({ items: [], waitingOnOtherSkus: 1 });
    });
  });

  it('진행 중인 배치에 든 상자는 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId, putaway } = await filledByArrival(tx);
      await putaway();
      expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([box.shipmentId]);

      await setShipment(tx, box, { status: 'planned' });
      await tx
        .insert(wmsTables.outboundBatchWorkItems)
        .values({ batchId: box.batchId, shipmentId: box.shipmentId, status: 'queued', leaseVersion: 0 });
      await startBatchFor(tx, box);
      // 재고가 모자라 빠지는 것이 아님을 보인다 — 배치가 쥔 몫 밖에 그 상자 몫이 또 있다
      await setShelf(tx, box, 4);
      expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([]);
    });
  });

  it('셀메이트가 넘겨받은 상자는 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId } = await filledByArrival(tx);
      expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([box.shipmentId]);

      const { salesOrderId } = await salesOrderOf(tx, box);
      if (!salesOrderId) throw new Error('sales order is required');
      await seedHandedOverOrder(tx, salesOrderId);
      expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([]);
    });
  });

  it('정보가 부족한 상자는 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId } = await filledByArrival(tx);
      expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([box.shipmentId]);

      await setShipment(tx, box, {
        recipientSnapshot: {
          recipientName: '',
          phone: '010-3333-4444',
          postalCode: '06236',
          roadAddress: 'Teheran-ro 123',
          detailAddress: '4F',
        },
      });
      expect(await ready(tx, box.warehouseId, [receiptLineId])).toEqual({ items: [], waitingOnOtherSkus: 0 });
    });
  });

  it('주문번호가 없는 상자는 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId } = await filledByArrival(tx);
      expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([box.shipmentId]);

      const { fulfillmentOrderId } = await salesOrderOf(tx, box);
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ salesOrderId: null })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
      expect(await idsOf(tx, box.warehouseId, [receiptLineId])).toEqual([]);
    });
  });

  it('planned 상자도 나온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, receiptLineId } = await filledByArrival(tx);
      await setShipment(tx, box, { status: 'planned' });

      const { items } = await ready(tx, box.warehouseId, [receiptLineId]);
      expect(items.map((item) => [item.shipmentId, item.status])).toEqual([[box.shipmentId, 'planned']]);
    });
  });

  /**
   * 시작한 배치(재고 3을 다 쥠) + 배치 밖 상자 하나. 그 상자를 재고를 기다리는 draft 로 돌리고(예약·송장 없음), 같은 상품 2개를
   * 입고한 뒤 다시 예약하고 계획한다. 송장 발급은 이 경로 밖이라 계획 뒤 registered 송장 행으로 대신한다.
   * 적치 전에는 입고분이 적치 대기라 putaway_required, 적치하면 ready 다.
   */
  async function startedBatchAndArrivedBox(tx: DbTx) {
    const { first } = await seedTwoBoxBatch(tx, 1, 3);
    const actor = { id: first.actorId, roles: ['master'] };
    const wiring = assembleOutbound(tx);
    await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const loose = await seedLooseBox(tx, first, 2);
    await tx
      .update(wmsTables.stockReservations)
      .set({ status: 'released' })
      .where(eq(wmsTables.stockReservations.shipmentLineId, loose.shipmentLineId));
    await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, loose.waybillId));
    await setShipment(tx, loose, { status: 'draft' });

    const kernel = makeInboundReceiptKernel(tx as never);
    const receipt = await kernel.recordArrival(
      {
        source: 'direct',
        method: 'simple',
        warehouseId: first.warehouseId,
        reason: 'ready shipments join',
        lines: [{ skuId: first.skuId, quantity: 2, eventKey: randomUUID() }],
      },
      tx,
    );
    const receiptLineId = receipt.lines[0].id;
    const reserved = await reservations(tx).reservePartial(loose.shipmentLineId, 2, tx);
    expect(reserved.totalReservedQty).toBe(2);
    const [draft] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, loose.shipmentId));
    await wiring.planning.plan(
      loose.shipmentId,
      {
        shippingProfileId: draft.shippingProfileId ?? '',
        expectedManifestVersion: draft.manifestVersion,
        expectedReservationVersion: draft.reservationVersion,
      },
      `plan-${randomUUID()}`,
      actor,
      tx,
    );
    await seedRegisteredWaybill(tx, loose.shipmentId);
    const putaway = () =>
      kernel.putaway({ receiptLineId, toLocationId: first.locationId, quantity: 2, eventKey: randomUUID() }, tx);
    const join = () =>
      tx.transaction((trx) =>
        wiring.batches.addShipment(first.batchId, loose.shipmentId, `j-${randomUUID()}`, actor, trx),
      );
    return { first, loose, receiptLineId, putaway, join };
  }

  it('ready 로 나온 상자는 시작한 배치에 INBOUND_PENDING 없이 들어간다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, receiptLineId, putaway, join } = await startedBatchAndArrivedBox(tx);
      await putaway();
      const { items } = await ready(tx, first.warehouseId, [receiptLineId]);
      expect(items.map((item) => [item.shipmentId, item.status, item.readiness])).toEqual([
        [loose.shipmentId, 'planned', 'ready'],
      ]);

      const joined = await join();
      expect(joined.workItem).toMatchObject({ batchId: first.batchId, shipmentId: loose.shipmentId });
    });
  });

  it('putaway_required 로 나온 상자는 합류가 INBOUND_PENDING 으로 막힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, loose, receiptLineId, join } = await startedBatchAndArrivedBox(tx);
      const { items } = await ready(tx, first.warehouseId, [receiptLineId]);
      expect(items.map((item) => [item.shipmentId, item.readiness])).toEqual([[loose.shipmentId, 'putaway_required']]);

      await expect(join()).rejects.toMatchObject({
        response: {
          code: 'BATCH_JOIN_BLOCKED',
          errors: [expect.objectContaining({ shipmentId: loose.shipmentId, reason: 'INBOUND_PENDING' })],
        },
      });
    });
  });
});
