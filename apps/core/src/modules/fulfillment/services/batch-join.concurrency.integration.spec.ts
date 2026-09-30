import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb } from './__support__';
import { overlap } from './__support__/committed-overlap';
import { cleanupPreparationFixture } from './__support__/outbound-preparation-cleanup';
import { seedLooseBox, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_WAREHOUSE_DEMO_DB === '1' && !DATABASE_URL) throw new Error('DATABASE_URL is required');
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('합류 커밋 동시성', () => {
  const observer = makeDb(DATABASE_URL!);
  afterAll(() => observer.sql.end());

  it('같은 배치의 마지막 재고를 두 합류가 다투면 하나만 성공하고 다른 하나는 무변경 STOCK_SHORT', async () => {
    // 커밋형 픽스처: 시작된 배치(2·1개, 재고 6 → 일반 가용 3) + 떠 있는 박스 둘(각 2개)
    const setup = await observer.db.transaction(async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 6);
      await assembleOutbound(tx).picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      return { first, second, a: await seedLooseBox(tx, first, 2), b: await seedLooseBox(tx, first, 2) };
    });
    // 픽스처 행위자로 부른다 — 정리(cleanupPreparationFixture)가 그 행위자의 감사 로그를 지운다.
    const actor = { id: setup.first.actorId, roles: ['master'] };
    try {
      const add = (shipmentId: string) => (tx: DbTx) =>
        assembleOutbound(tx).batches.addShipment(setup.first.batchId, shipmentId, `j-${randomUUID()}`, actor, tx);
      const { first, second } = await overlap(observer, add(setup.a.shipmentId), add(setup.b.shipmentId));
      expect(first.workItem.shipmentId).toBe(setup.a.shipmentId);
      expect(second.ok).toBe(false);
      expect(second.ok ? null : second.error).toMatchObject({
        response: { code: 'BATCH_JOIN_BLOCKED', errors: [expect.objectContaining({ reason: 'STOCK_SHORT' })] },
      });
      await observer.db.transaction(async (tx) => {
        const items = await tx
          .select()
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.shipmentId, setup.b.shipmentId));
        expect(items.filter((item) => item.batchId === setup.first.batchId)).toEqual([]);
        const [session] = await tx
          .select()
          .from(wmsTables.batchInventorySessions)
          .where(eq(wmsTables.batchInventorySessions.batchId, setup.first.batchId));
        // 시작 3 + 합류 a 2 — 진 쪽의 인계는 남지 않는다.
        expect(session.handedInQty).toBe(5);
      });
    } finally {
      await observer.db.transaction((tx) =>
        cleanupPreparationFixture(tx, setup.first, [setup.second, setup.a, setup.b]),
      );
    }
  });
});
