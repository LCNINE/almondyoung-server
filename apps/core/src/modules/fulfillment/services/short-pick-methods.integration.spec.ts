import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { startBatchPicking } from '../picking/allocation/batch-start';
import { PickingStrategyName } from '../picking/picking-strategy.interface';
import { assembleLabels, promoteToCarrierWaybill } from '../waybill/__support__/label-fixtures';
import { inRollbackTx, makeDb } from './__support__';
import { assertFulfillmentInvariantsFor } from './__support__/logistics-assertions';
import { PickableShipmentFixture, seedPickableShipment } from './__support__/logistics-fixtures';
import { seedSpareStock, startedShortPickBox } from './__support__/short-pick-fixtures';
import { seedReturnBin, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('결품 재배정 × 피킹 방식 (스펙 S1 §4.4, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 하나(3개, 재고 3)의 배치를 주어진 방식으로 시작한다 — 테스트 배선의 레지스트리는 discrete 만 알아 `startBatchPicking` 을 직접 부른다. */
  async function startedBox(tx: DbTx, method: 'total_picking' | 'multi_order', strategy: PickingStrategyName) {
    const box = await seedPickableShipment(tx, 3);
    await tx
      .update(wmsTables.outboundBatches)
      .set(method === 'multi_order' ? { pickingMethod: method, cartCapacity: 24 } : { pickingMethod: method })
      .where(eq(wmsTables.outboundBatches.id, box.batchId));
    const wiring = assembleOutbound(tx);
    const run = await startBatchPicking(
      wiring.startDeps,
      strategy,
      { batchId: box.batchId, actorId: box.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    return { box, wiring, sessionId: run.sessionId };
  }

  /** 최신 세션·작업 항목·줄·박스 버전을 읽어 L1 결품을 보고한다. */
  async function reportShort(
    tx: DbTx,
    wiring: ReturnType<typeof assembleOutbound>,
    box: PickableShipmentFixture,
    sessionId: string,
    shortQty: number,
  ) {
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId));
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, box.shipmentLineId));
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
    return wiring.shortPick.report(
      box.shipmentId,
      {
        workItemId: box.workItemId,
        expectedWorkItemLeaseVersion: workItem.leaseVersion,
        sessionId: session.id,
        expectedSessionVersion: session.version,
        expectedManifestVersion: shipment.manifestVersion,
        lines: [
          {
            shipmentLineId: line.id,
            sourceLocationId: box.locationId,
            expectedLineVersion: line.lineVersion,
            shortQty,
          },
        ],
        reason: 'inventory_shortage',
      },
      `sp-${randomUUID()}`,
      { id: box.actorId, roles: ['master'] },
      tx,
    );
  }

  const balancesOf = (tx: DbTx, sessionId: string, custodyType: string) =>
    tx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.custodyType, custodyType as never),
        ),
      );

  const scanBulk = (
    wiring: ReturnType<typeof assembleOutbound>,
    box: PickableShipmentFixture,
    sessionId: string,
    sourceLocationId: string,
    quantity: number,
    tx: DbTx,
  ) =>
    wiring.aggregate.bulkCartScan(
      {
        strategy: 'aggregate_then_sort',
        stage: 'bulk_collect',
        batchId: box.batchId,
        sessionId,
        skuId: box.skuId,
        sourceLocationId,
        quantity,
        cartId: 'CART-1',
        actor,
        idempotencyKey: `b-${randomUUID()}`,
      },
      tx,
    );

  it('토탈피킹 — 벌크 수집 전 결품은 여분 로케이션으로 다시 채우고, 카트 수집이 그 몫을 받는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId } = await startedBox(tx, 'total_picking', 'aggregate_then_sort');
      const spare = await seedSpareStock(tx, { skuId: box.skuId, warehouseId: box.warehouseId }, 5);

      const result = await reportShort(tx, wiring, box, sessionId, 2);
      expect(result.outcome).toBe('refilled');
      expect(result.refills).toEqual([
        expect.objectContaining({ shipmentLineId: box.shipmentLineId, sourceLocationId: spare.locationId, qty: 2 }),
      ]);
      const atSource = await balancesOf(tx, sessionId, 'AT_SOURCE');
      expect(atSource).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceLocationId: spare.locationId, qty: 2 }),
          expect.objectContaining({ sourceLocationId: box.locationId, qty: 1 }),
        ]),
      );

      // 합산 목록 = 위치별 AT_SOURCE 잔량 — 여분 로케이션은 2, 원래 로케이션은 남은 1 만 받는다.
      await scanBulk(wiring, box, sessionId, spare.locationId, 2, tx);
      await scanBulk(wiring, box, sessionId, box.locationId, 1, tx);
      const cart = await balancesOf(tx, sessionId, 'BULK_CART');
      expect(cart.find((b) => b.sourceLocationId === spare.locationId)).toMatchObject({ qty: 2 });
      expect(cart.find((b) => b.sourceLocationId === box.locationId)).toMatchObject({ qty: 1 });
      await expect(scanBulk(wiring, box, sessionId, box.locationId, 1, tx)).rejects.toBeDefined();

      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('토탈피킹 — 카트에 다 실은 뒤 결품은 SHORT_PICK_EXCEEDS_UNPICKED (AT_SOURCE 0)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId } = await startedBox(tx, 'total_picking', 'aggregate_then_sort');
      await seedSpareStock(tx, { skuId: box.skuId, warehouseId: box.warehouseId }, 5);
      await scanBulk(wiring, box, sessionId, box.locationId, 3, tx);

      await expect(tx.transaction((trx) => reportShort(trx, wiring, box, sessionId, 1))).rejects.toMatchObject({
        response: { code: 'SHORT_PICK_EXCEEDS_UNPICKED' },
      });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('바구니 피킹 — 집은 게 없고 여분도 없으면 전량(3개) 결품이 배치의 마지막 보관을 비워도 바로 나간다(exited, 초안)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId } = await startedBox(tx, 'multi_order', 'pick_to_tote');

      const result = await reportShort(tx, wiring, box, sessionId, 3);
      expect(result).toMatchObject({ outcome: 'exited', operationStatus: 'completed' });
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      expect(session).toMatchObject({ status: 'settled', shortageQty: 3, handedBackQty: 0 });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment.status).toBe('draft');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(item).toMatchObject({ status: 'excluded', waitingOperationId: null });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('바구니 피킹 — 토트에 1 개 담은 뒤 결품은 withdrawing, 되돌림 바구니로 TOTE 보관을 빼면 나가며 마무리된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, wiring, sessionId } = await startedBox(tx, 'multi_order', 'pick_to_tote');
      // 토트 배정 대신 TOTE 보관으로 직접 옮긴다(batch-inventory-session 스펙과 같은 방식).
      await wiring.sessions.moveCustody(
        {
          sessionId,
          idempotencyKey: `tote-${randomUUID()}`,
          actorId: box.actorId,
          quantity: 1,
          from: { skuId: box.skuId, sourceLocationId: box.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: box.skuId,
            sourceLocationId: box.locationId,
            custodyType: 'TOTE',
            custodyRef: randomUUID(),
            shipmentLineId: box.shipmentLineId,
          },
        },
        tx,
      );

      const result = await reportShort(tx, wiring, box, sessionId, 2);
      expect(result).toMatchObject({ outcome: 'withdrawing', operationStatus: 'pending' });
      const [waiting] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(waiting.status).toBe('withdrawing');

      const bin = await seedReturnBin(tx, box.warehouseId, box.actorId);
      const removed = await wiring.returns.removeToReturnBin(
        box.shipmentId,
        { barcode: box.barcode, returnBinBarcode: bin.barcode, quantity: 1 },
        actor,
        `r-${randomUUID()}`,
        tx,
      );
      expect(removed).toMatchObject({ removedQty: 1, exited: true, exitTo: 'draft' });

      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, box.shipmentId));
      expect(shipment.status).toBe('draft');
      const [item] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
      expect(item).toMatchObject({ status: 'excluded', waitingOperationId: null });
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, result.operationId));
      expect(operation.status).toBe('completed');
      expect((await balancesOf(tx, sessionId, 'TOTE')).reduce((t, b) => t + b.qty, 0)).toBe(0);
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [box.shipmentId]);
    });
  });

  it('개별 피킹 — 같은 로케이션을 나눠 가진 두 박스 중 한 박스만 결품이면 다른 박스의 배정·예약·지문은 그대로다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 3);
      await promoteToCarrierWaybill(tx, first);
      await promoteToCarrierWaybill(tx, second);
      const wiring = assembleOutbound(tx);
      const run = await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      await seedSpareStock(tx, { skuId: first.skuId, warehouseId: first.warehouseId }, 5);
      const labels = assembleLabels(ambientDbService(tx));
      const snapshotOfSecond = async () => ({
        allocations: await tx
          .select()
          .from(wmsTables.pickingSourceAllocations)
          .where(eq(wmsTables.pickingSourceAllocations.workItemId, second.workItemId)),
        reservations: await tx
          .select()
          .from(wmsTables.stockReservations)
          .where(eq(wmsTables.stockReservations.shipmentLineId, second.shipmentLineId)),
        workItem: (
          await tx
            .select()
            .from(wmsTables.outboundBatchWorkItems)
            .where(eq(wmsTables.outboundBatchWorkItems.id, second.workItemId))
        )[0],
        shipment: (await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId)))[0],
        label: await labels.assembler.current(second.shipmentId, tx),
      });
      const before = await snapshotOfSecond();

      const result = await reportShort(tx, wiring, first, run.sessionId, 1);
      expect(result.outcome).toBe('refilled');

      expect(await snapshotOfSecond()).toEqual(before);
      expect(before.label.kind).toBe('printable');
      await expect(wiring.recovery.reconcile(run.sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });

  it('(보존) 픽스처 박스의 startedShortPickBox 경로도 여분이 있으면 refilled', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report, sessionId, wiring } = await startedShortPickBox(tx);
      await seedSpareStock(tx, { skuId: box.skuId, warehouseId: box.warehouseId }, 3);
      await expect(report(1)).resolves.toMatchObject({ outcome: 'refilled' });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
    });
  });
});
