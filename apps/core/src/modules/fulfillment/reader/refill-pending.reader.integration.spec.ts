import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { RefillPendingReader } from './refill-pending.reader';
import { inRollbackTx, makeDb } from '../services/__support__';
import { seedSpareStock, startedShortPickBox } from '../services/__support__/short-pick-fixtures';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('보충 대기 조회 (스펙 A6)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  const readerFor = (tx: DbTx) => new RefillPendingReader(ambientDbService(tx));

  it('다른 위치에서 채운 박스는 가져올 위치·상품·수량과 함께 나온다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 5);
      expect((await started.report(1)).outcome).toBe('refilled');

      const pending = await readerFor(tx).pending(started.box.warehouseId);

      expect(pending).toEqual([
        expect.objectContaining({
          shipmentId: started.box.shipmentId,
          items: [
            expect.objectContaining({
              shipmentLineId: started.box.shipmentLineId,
              sourceLocationId: spare.locationId,
              locationCode: spare.code,
              qty: 1,
            }),
          ],
        }),
      ]);
    });
  });

  it('채운 몫을 집으면 목록에서 빠진다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, started.box, 5);
      await started.report(1);
      await started.wiring.sessions.moveCustody(
        {
          sessionId: started.sessionId,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId: started.box.actorId,
          quantity: 1,
          from: { skuId: started.box.skuId, sourceLocationId: spare.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: started.box.skuId,
            sourceLocationId: spare.locationId,
            custodyType: 'WORKER',
            custodyRef: started.box.actorId,
            shipmentLineId: started.box.shipmentLineId,
          },
        },
        tx,
      );
      expect(await readerFor(tx).pending(started.box.warehouseId)).toEqual([]);
    });
  });

  it('채우지 못한 결품(빼는 중)과 다른 창고는 나오지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const started = await startedShortPickBox(tx, 1);
      expect((await started.report(1)).outcome).not.toBe('refilled');
      expect(await readerFor(tx).pending(started.box.warehouseId)).toEqual([]);
      expect(await readerFor(tx).pending(randomUUID())).toEqual([]);
    });
  });

  it('여러 박스는 결품 오퍼레이션 완료 순으로 나온다 — 폴링마다 섞이지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await startedShortPickBox(tx, 0);
      const second = await startedShortPickBox(tx, 0);
      // 픽스처는 박스마다 창고를 새로 만든다 — 같은 창고의 두 박스로 만든다(리더는 shipments.warehouse_id 로 거른다).
      await tx
        .update(wmsTables.shipments)
        .set({ warehouseId: first.box.warehouseId })
        .where(eq(wmsTables.shipments.id, second.box.shipmentId));
      await seedSpareStock(tx, first.box, 5);
      await seedSpareStock(tx, second.box, 5);
      expect((await first.report(1)).outcome).toBe('refilled');
      expect((await second.report(1)).outcome).toBe('refilled');

      // 한 트랜잭션 안의 now() 는 같다 — 완료 시각을 명시해 «second 가 먼저 끝났다» 로 고정한다.
      const completedAt = async (shipmentId: string, at: string) => {
        const members = await tx
          .select({ operationId: wmsTables.shipmentOperationMembers.operationId })
          .from(wmsTables.shipmentOperationMembers)
          .where(eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId));
        await tx
          .update(wmsTables.shipmentOperations)
          .set({ completedAt: new Date(at) })
          .where(
            inArray(
              wmsTables.shipmentOperations.id,
              members.map((member) => member.operationId),
            ),
          );
      };
      await completedAt(second.box.shipmentId, '2030-01-01T00:00:00Z');
      await completedAt(first.box.shipmentId, '2030-01-01T00:05:00Z');

      const pending = await readerFor(tx).pending(first.box.warehouseId);

      expect(pending.map((box) => box.shipmentId)).toEqual([second.box.shipmentId, first.box.shipmentId]);
    });
  });
});
