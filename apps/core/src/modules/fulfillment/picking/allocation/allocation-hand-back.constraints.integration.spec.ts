import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { causeChainMessage, inRollbackTx, makeDb } from '../../services/__support__';
import { seedPickableShipment } from '../../services/__support__/logistics-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
// drizzle 이 에러를 감싸 최상위 message 에는 제약 이름이 없다 — cause 체인으로 본다.
async function expectViolation(tx: DbTx, action: (savepoint: DbTx) => Promise<unknown>, constraint: string) {
  let caught: unknown;
  try {
    await tx.transaction((savepoint) => action(savepoint as unknown as DbTx));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(causeChainMessage(caught)).toContain(constraint);
}

const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('배정 반납 스키마 (PR 2)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('배정 행은 0 을 허용하고 음수는 거절한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 2);
      const values = {
        workItemId: f.workItemId,
        shipmentLineId: f.shipmentLineId,
        sourceLocationId: f.locationId,
        sourceStockVersion: 1,
      };
      await expect(tx.insert(wmsTables.pickingSourceAllocations).values({ ...values, qty: 0 })).resolves.toBeDefined();
      await expectViolation(
        tx,
        (trx) =>
          trx
            .update(wmsTables.pickingSourceAllocations)
            .set({ qty: -1 })
            .where(eq(wmsTables.pickingSourceAllocations.workItemId, f.workItemId)),
        'ck_picking_source_allocations_qty_nonnegative',
      );
    });
  });

  it('세션은 handed_back_qty 를 보존식에 넣는다 — 정산+반환+부족+반납 ≤ 인계', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seedPickableShipment(tx, 2);
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batchId, handedInQty: 3, handedBackQty: 2, settledQty: 1 })
        .returning();
      expect(session.handedBackQty).toBe(2);
      await expectViolation(
        tx,
        (trx) =>
          trx
            .update(wmsTables.batchInventorySessions)
            .set({ handedBackQty: 3 })
            .where(eq(wmsTables.batchInventorySessions.id, session.id)),
        'ck_batch_inventory_sessions_settlement',
      );
      await expectViolation(
        tx,
        (trx) =>
          trx
            .update(wmsTables.batchInventorySessions)
            .set({ handedBackQty: -1 })
            .where(eq(wmsTables.batchInventorySessions.id, session.id)),
        'ck_batch_inventory_sessions_quantities',
      );
    });
  });
});
