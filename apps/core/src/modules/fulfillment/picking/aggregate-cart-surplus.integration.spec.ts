import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { startBatchPicking } from './allocation/batch-start';
import { inRollbackTx, makeDb } from '../services/__support__';
import { assertFulfillmentInvariantsFor } from '../services/__support__/logistics-assertions';
import { seedReturnBin, seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { assembleOutbound } from '../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('토탈피킹 카트 여분 되돌림 (스펙 §8, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 박스 둘(첫 2 + 둘째 1)을 전부 카트에 싣고 첫 박스를 뺀다 — 첫 박스 몫 2 가 카트 여분이다. */
  async function cartLoaded(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    await tx
      .update(wmsTables.outboundBatches)
      .set({ pickingMethod: 'total_picking' })
      .where(eq(wmsTables.outboundBatches.id, first.batchId));
    const wiring = assembleOutbound(tx);
    const run = await startBatchPicking(
      wiring.startDeps,
      'aggregate_then_sort',
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.aggregate.bulkCartScan(
      {
        strategy: 'aggregate_then_sort',
        stage: 'bulk_collect',
        batchId: first.batchId,
        sessionId: run.sessionId,
        skuId: first.skuId,
        sourceLocationId: first.locationId,
        quantity: 3,
        cartId: 'CART-1',
        actor,
        idempotencyKey: `b-${randomUUID()}`,
      },
      tx,
    );
    const out = await wiring.batches.excludeShipment(
      first.batchId,
      first.shipmentId,
      { reason: '고객 요청' },
      `x-${randomUUID()}`,
      actor,
      tx,
    );
    expect(out.workItem.status).toBe('withdrawing');
    const bin = await seedReturnBin(tx, first.warehouseId, first.actorId);
    return { first, second, wiring, sessionId: run.sessionId, bin };
  }

  const returnSurplus = (
    wiring: ReturnType<typeof assembleOutbound>,
    input: {
      batchId: string;
      sessionId: string;
      skuId: string;
      sourceLocationId: string;
      quantity: number;
      returnBinBarcode: string;
    },
    tx: DbTx,
  ) =>
    wiring.aggregate.returnCartSurplus({ ...input, cartId: 'CART-1', actor, idempotencyKey: `cs-${randomUUID()}` }, tx);

  it('빼는 박스 몫만큼만 받는다 — 넘으면 CART_SURPLUS_NOT_PENDING', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, wiring, sessionId, bin } = await cartLoaded(tx);
      await expect(
        tx.transaction((trx) =>
          returnSurplus(
            wiring,
            {
              batchId: first.batchId,
              sessionId,
              skuId: first.skuId,
              sourceLocationId: first.locationId,
              quantity: 3,
              returnBinBarcode: bin.barcode,
            },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'CART_SURPLUS_NOT_PENDING' } });
    });
  });

  it('여분 2 를 바구니에 넣으면 그 박스가 나가고, 카트에는 남는 박스 몫 1 만 남는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring, sessionId, bin } = await cartLoaded(tx);
      const result = await returnSurplus(
        wiring,
        {
          batchId: first.batchId,
          sessionId,
          skuId: first.skuId,
          sourceLocationId: first.locationId,
          quantity: 2,
          returnBinBarcode: bin.barcode,
        },
        tx,
      );

      expect(result.exited).toEqual([expect.objectContaining({ workItemId: first.workItemId, exitTo: 'draft' })]);
      const balances = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionBalances.skuId, first.skuId),
          ),
        );
      expect(balances.filter((b) => b.custodyType === 'BULK_CART').reduce((t, b) => t + b.qty, 0)).toBe(1);
      expect(balances.find((b) => b.custodyType === 'RETURN_PENDING')).toMatchObject({
        qty: 2,
        custodyRef: bin.barcode,
      });
      await expect(wiring.recovery.reconcile(sessionId, tx)).resolves.toMatchObject({ healthy: true });
      await assertFulfillmentInvariantsFor(tx, [first.shipmentId, second.shipmentId]);
    });
  });
});
