import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { causeChainMessage, inRollbackTx, makeDb } from './__support__';
import { seedPickableShipment } from './__support__/logistics-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// drizzle 이 쿼리 에러를 감싸 최상위 message 에는 제약 이름이 없다 — cause 체인으로 본다.
async function expectConstraint(run: Promise<unknown>, name: RegExp) {
  const error = await run.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeDefined();
  expect(causeChainMessage(error)).toMatch(name);
}

describeIfDb('이탈·되돌림 스키마 (PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('withdrawing 은 exit_to 가 있어야 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      await expectConstraint(
        tx.transaction((trx) =>
          trx
            .update(wmsTables.outboundBatchWorkItems)
            .set({ status: 'withdrawing' })
            .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId)),
        ),
        /ck_outbound_work_items_withdrawing_exit/,
      );
      const [row] = await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'withdrawing', exitTo: 'draft', exclusionReason: '고객 요청' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId))
        .returning();
      expect(row).toMatchObject({ status: 'withdrawing', exitTo: 'draft' });
    });
  });

  it('되돌림 바구니 바코드는 RB- 로 시작하고 전역 유일하다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const barcode = `RB-${randomUUID().slice(0, 8)}`;
      await tx.insert(wmsTables.returnBins).values({ warehouseId: f.warehouseId, barcode, registeredBy: f.actorId });
      await expectConstraint(
        tx.transaction((trx) =>
          trx.insert(wmsTables.returnBins).values({ warehouseId: f.warehouseId, barcode, registeredBy: f.actorId }),
        ),
        /uq_return_bins_barcode/,
      );
      await expectConstraint(
        tx.transaction((trx) =>
          trx.insert(wmsTables.returnBins).values({
            warehouseId: f.warehouseId,
            barcode: `TOTE-${randomUUID().slice(0, 8)}`,
            registeredBy: f.actorId,
          }),
        ),
        /ck_return_bins_barcode_prefix/,
      );
    });
  });

  it('RETURN_PENDING 보관은 바구니 ref 가 있고 줄이 없다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batchId, handedInQty: 3 })
        .returning();
      const base = { sessionId: session.id, skuId: f.skuId, sourceLocationId: f.locationId, qty: 1 } as const;
      await expect(
        tx
          .insert(wmsTables.batchInventorySessionBalances)
          .values({ ...base, custodyType: 'RETURN_PENDING', custodyRef: 'RB-1' }),
      ).resolves.toBeDefined();
      await expectConstraint(
        tx.transaction((trx) =>
          trx.insert(wmsTables.batchInventorySessionBalances).values({
            ...base,
            custodyType: 'RETURN_PENDING',
            custodyRef: 'RB-2',
            shipmentLineId: f.shipmentLineId,
          }),
        ),
        /ck_batch_inventory_session_balances_custody/,
      );
      await expectConstraint(
        tx.transaction((trx) =>
          trx.insert(wmsTables.batchInventorySessionBalances).values({ ...base, custodyType: 'RETURN_PENDING' }),
        ),
        /ck_batch_inventory_session_balances_custody/,
      );
      // SETTLED 는 그대로 — 줄 있음·ref 없음.
      await expectConstraint(
        tx.transaction((trx) =>
          trx.insert(wmsTables.batchInventorySessionBalances).values({
            ...base,
            custodyType: 'SETTLED',
            custodyRef: 'RB-3',
            shipmentLineId: f.shipmentLineId,
          }),
        ),
        /ck_batch_inventory_session_balances_custody/,
      );
    });
  });

  it('RETURN_PENDING 이벤트 grain 도 같다(to 쪽)', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 1);
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batchId, handedInQty: 1 })
        .returning();
      const event = {
        sessionId: session.id,
        eventType: 'REMOVE_TO_RETURN_BIN',
        skuId: f.skuId,
        quantity: 1,
        fromCustodyType: 'WORKER',
        fromCustodyRef: f.actorId,
        fromSourceLocationId: f.locationId,
        fromShipmentLineId: f.shipmentLineId,
        toCustodyType: 'RETURN_PENDING',
        toSourceLocationId: f.locationId,
      } as const;
      await expect(
        tx
          .insert(wmsTables.batchInventorySessionEvents)
          .values({ ...event, idempotencyKey: 'k1', toCustodyRef: 'RB-1' }),
      ).resolves.toBeDefined();
      await expectConstraint(
        tx.transaction((trx) =>
          trx
            .insert(wmsTables.batchInventorySessionEvents)
            .values({ ...event, idempotencyKey: 'k2', toCustodyRef: 'RB-1', toShipmentLineId: f.shipmentLineId }),
        ),
        /ck_batch_inventory_session_events_to_grain/,
      );
    });
  });
});
