import { randomUUID } from 'crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, seedPickableShipment } from './__support__';
import { assembleSimpleOutbound, startBatchFor } from './__support__/simple-outbound-wiring';
import { isPreparationBlocked } from './outbound-preparation-result';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 줄 3개를 L1(SIMPLE-ZONE-…, 재고 2) 과 앞 코드 위치(AAA-…, 재고 1)로 나눈다. 앞 위치의 UUID 는 뒤로 심는다. */
async function splitLineBox(tx: DbTx) {
  const box = await seedPickableShipment(tx, 3);
  await tx
    .update(wmsTables.stockLedgers)
    .set({ qty: 2 })
    .where(and(eq(wmsTables.stockLedgers.skuId, box.skuId), eq(wmsTables.stockLedgers.locationId, box.locationId)));
  const [front] = await tx
    .insert(wmsTables.locations)
    .values({
      id: `ffffffff-ffff-4fff-8fff-${randomUUID().slice(-12)}`,
      warehouseId: box.warehouseId,
      code: `AAA-${randomUUID()}`,
      locationType: 'zone',
    })
    .returning();
  await tx.insert(wmsTables.stockLedgers).values({
    skuId: box.skuId,
    warehouseId: box.warehouseId,
    locationId: front.id,
    stockState: 'ON_HAND',
    qty: 1,
  });
  const run = await startBatchFor(tx, box);
  return { box, frontId: front.id, sessionId: run.sessionId };
}

async function attributed(tx: DbTx, sessionId: string, shipmentLineId: string, sourceLocationId: string) {
  const [row] = await tx
    .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
    .from(wmsTables.batchInventorySessionBalances)
    .where(
      and(
        eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
        eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
        eq(wmsTables.batchInventorySessionBalances.sourceLocationId, sourceLocationId),
        ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
      ),
    );
  return Number(row?.qty ?? 0);
}

describeIfDb('위치 없는 스캔의 귀속 순서 (스펙 A1)', () => {
  const { sql: pg, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await pg.end({ timeout: 5 });
  });

  it('나뉜 줄은 배정이 코드 순(AAA 1 → SIMPLE 2)으로 잡힌다 — 전제 확인', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, frontId } = await splitLineBox(tx);
      const rows = await tx
        .select({
          sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
          qty: wmsTables.pickingSourceAllocations.qty,
        })
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.workItemId, box.workItemId));
      expect(rows).toEqual(
        expect.arrayContaining([
          { sourceLocationId: frontId, qty: 1 },
          { sourceLocationId: box.locationId, qty: 2 },
        ]),
      );
    });
  });

  it('첫 스캔은 송장에 먼저 찍힌(코드 순 첫) 위치에 귀속한다 — UUID 순이 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, frontId, sessionId } = await splitLineBox(tx);
      const actor = { id: box.actorId, roles: ['logistics_worker'] };
      const state = await assembleSimpleOutbound(tx).scan(
        box.shipmentId,
        { barcode: box.barcode, quantity: 1, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );
      if (isPreparationBlocked(state)) throw new Error('Expected prepared outbound state');
      expect(await attributed(tx, sessionId, box.shipmentLineId, frontId)).toBe(1);
      expect(await attributed(tx, sessionId, box.shipmentLineId, box.locationId)).toBe(0);
    });
  });
});
