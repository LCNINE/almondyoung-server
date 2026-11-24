import { randomUUID } from 'crypto';
import { and, eq, sql as sqlQuery } from 'drizzle-orm';
import { ConfigService } from '@nestjs/config';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { buildWiring, makeInboundReceiptKernel } from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentProgressService } from '../services/fulfillment-progress.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { inRollbackTx, makeDb, seedPickableShipment, seedShipmentForExistingStock } from '../services/__support__';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { ArrivalReservationRetry } from './arrival-reservation-retry';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Box = Awaited<ReturnType<typeof seedPickableShipment>>;

describeIfDb('입고 직후 예약 재시도', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  // 정비 모드면 shouldRunReservationRetry 가 false — 크론과 같은 스위치
  const gateIn = (mode: 'v2' | 'maintenance') =>
    new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode, FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z' }),
    );

  const retry = (tx: DbTx, gate = gateIn('v2')) => {
    const { dbService, sellable } = buildWiring(tx as never);
    const reservations = new ShipmentReservationService(
      dbService,
      new UnifiedReservationService(dbService, sellable),
      new FulfillmentProgressService(),
      new FulfillmentInvariantService(),
    );
    return new ArrivalReservationRetry(ambientDbService(tx), gate, reservations);
  };

  const confirmedQty = async (tx: DbTx, box: Pick<Box, 'shipmentLineId'>) => {
    const [row] = await tx
      .select({ qty: sqlQuery<number>`COALESCE(SUM(${wmsTables.stockReservations.quantity}), 0)::int` })
      .from(wmsTables.stockReservations)
      .where(
        and(
          eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId),
          eq(wmsTables.stockReservations.status, 'confirmed'),
        ),
      );
    return Number(row.qty);
  };

  const setShelf = (tx: DbTx, box: Box, qty: number) =>
    tx
      .update(wmsTables.stockLedgers)
      .set({ qty })
      .where(and(eq(wmsTables.stockLedgers.skuId, box.skuId), eq(wmsTables.stockLedgers.locationId, box.locationId)));

  /** 예약을 놓고 배치에서 빠진 draft 상자 — 재고를 기다리는 줄 */
  async function waitForStock(tx: DbTx, box: Box) {
    await tx
      .update(wmsTables.stockReservations)
      .set({ status: 'released' })
      .where(eq(wmsTables.stockReservations.shipmentLineId, box.shipmentLineId));
    await tx
      .delete(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, box.shipmentId));
    await tx.update(wmsTables.shipments).set({ status: 'draft' }).where(eq(wmsTables.shipments.id, box.shipmentId));
  }

  /** 선반이 빈 상품에 기다리는 상자 하나 */
  async function waitingBox(tx: DbTx, qty = 2): Promise<Box> {
    const box = await seedPickableShipment(tx, qty);
    await setShelf(tx, box, 0);
    await waitForStock(tx, box);
    return box;
  }

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
    await waitForStock(tx, next);
    return next;
  }

  const arrive = (tx: DbTx, box: Pick<Box, 'warehouseId' | 'skuId'>, quantity: number) =>
    makeInboundReceiptKernel(tx as never).recordArrival(
      {
        source: 'direct',
        method: 'simple',
        warehouseId: box.warehouseId,
        reason: 'arrival reservation retry',
        lines: [{ skuId: box.skuId, quantity, eventKey: randomUUID() }],
      },
      tx,
    );

  const queuedAt = (tx: DbTx, box: Pick<Box, 'shipmentLineId'>, minutesAgo: number) =>
    tx
      .update(wmsTables.shipmentLines)
      .set({ demandRequestedAt: sqlQuery`now() - make_interval(mins => ${minutesAgo})` })
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));

  it('방금 들어온 상품의 미예약 draft 줄에 크론 없이 예약이 잡힌다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await waitingBox(tx, 2);
      await arrive(tx, box, 2);
      expect(await confirmedQty(tx, box)).toBe(0);

      await retry(tx).retryForSkus(box.warehouseId, [box.skuId], tx);

      expect(await confirmedQty(tx, box)).toBe(2);
    });
  });

  it('다른 상품·다른 창고의 줄은 건드리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await waitingBox(tx, 2);
      const other = await waitingBox(tx, 2);
      await arrive(tx, box, 2);
      await arrive(tx, other, 2);

      // 상품은 맞지만 창고가 다르다
      await retry(tx).retryForSkus(other.warehouseId, [box.skuId], tx);
      // 창고는 맞지만 상품이 다르다
      await retry(tx).retryForSkus(box.warehouseId, [other.skuId], tx);
      expect(await confirmedQty(tx, box)).toBe(0);
      expect(await confirmedQty(tx, other)).toBe(0);

      await retry(tx).retryForSkus(box.warehouseId, [box.skuId], tx);
      expect(await confirmedQty(tx, box)).toBe(2);
      expect(await confirmedQty(tx, other)).toBe(0);
    });
  });

  it('재고가 모자라면 대기 순번 앞의 줄부터 잡는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const later = await waitingBox(tx, 1);
      const earlier = await sibling(tx, later, 1);
      await queuedAt(tx, earlier, 10);
      await queuedAt(tx, later, 5);
      await arrive(tx, later, 1);

      await retry(tx).retryForSkus(later.warehouseId, [later.skuId], tx);

      expect(await confirmedQty(tx, earlier)).toBe(1);
      expect(await confirmedQty(tx, later)).toBe(0);
    });
  });

  it('재시도 스위치가 꺼져 있으면 아무것도 하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await waitingBox(tx, 2);
      await arrive(tx, box, 2);

      const gate = gateIn('maintenance');
      expect(gate.shouldRunReservationRetry()).toBe(false);
      await retry(tx, gate).retryForSkus(box.warehouseId, [box.skuId], tx);

      expect(await confirmedQty(tx, box)).toBe(0);
    });
  });
});
