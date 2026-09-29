import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb, inRollbackTx, seedPickableShipment } from '../services/__support__';
import { latestPrint } from './label/label-print-policy';
import { WaybillLabelPrintRepository } from './waybill-label-print.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillLabelPrintRepository (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  const repo = new WaybillLabelPrintRepository();
  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('같은 지문을 다시 기록하면 행이 늘지 않고 printed_at 이 갱신돼 «마지막 출력»이 된다(A→B→A)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { shipmentId } = await seedPickableShipment(tx, 1);
      const base = { shipmentId, itemsSnapshot: [], printedBy: randomUUID() };
      await repo.record(tx, { ...base, fingerprint: 'a'.repeat(64), revision: 1 });
      await repo.record(tx, { ...base, fingerprint: 'b'.repeat(64), revision: 2 });
      // 한 트랜잭션 안의 now() 는 같다 — 되돌아온 A 가 더 늦게 찍히게 printed_at 을 과거로 민다.
      await tx
        .update(wmsTables.waybillLabelPrints)
        .set({ printedAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(wmsTables.waybillLabelPrints.shipmentId, shipmentId));
      const again = await repo.record(tx, { ...base, fingerprint: 'a'.repeat(64), revision: 1 });
      const rows = await repo.listByShipments(tx, [shipmentId]);
      expect(rows).toHaveLength(2);
      expect(again.revision).toBe(1);
      expect(latestPrint(rows)?.fingerprint).toBe('a'.repeat(64));
    });
  });

  it('다른 지문이 같은 판차를 쓰면 유니크 위반 — 판차는 박스 안에서 유일하다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { shipmentId } = await seedPickableShipment(tx, 1);
      const base = { shipmentId, itemsSnapshot: [], printedBy: randomUUID(), revision: 1 };
      await repo.record(tx, { ...base, fingerprint: 'a'.repeat(64) });
      const failure = await tx
        .transaction((sp) => repo.record(sp, { ...base, fingerprint: 'b'.repeat(64) }))
        .then(
          () => null,
          (e: unknown) => e,
        );
      // drizzle 이 PG 오류를 «Failed query» 로 감싼다 — 제약 이름은 cause 에 있다.
      const cause = failure instanceof Error ? failure.cause : undefined;
      expect(cause).toMatchObject({ constraint_name: 'uq_waybill_label_prints_shipment_revision' });
    });
  });

  describe('lockActiveWorkItem', () => {
    it('활성 작업 항목이 있으면 그 id 를 돌려준다', async () => {
      await inRollbackTx(db, async (tx) => {
        const { shipmentId, workItemId } = await seedPickableShipment(tx, 1);
        expect(await repo.lockActiveWorkItem(tx, shipmentId)).toEqual({ id: workItemId });
      });
    });

    it('작업 항목이 completed 뿐이면 null', async () => {
      await inRollbackTx(db, async (tx) => {
        const { shipmentId, workItemId } = await seedPickableShipment(tx, 1);
        await tx
          .update(wmsTables.outboundBatchWorkItems)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId));
        expect(await repo.lockActiveWorkItem(tx, shipmentId)).toBeNull();
      });
    });

    it('작업 항목이 excluded 뿐이면 null', async () => {
      await inRollbackTx(db, async (tx) => {
        const { shipmentId, workItemId } = await seedPickableShipment(tx, 1);
        await tx
          .update(wmsTables.outboundBatchWorkItems)
          .set({ status: 'excluded', exclusionReason: 'test' })
          .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId));
        expect(await repo.lockActiveWorkItem(tx, shipmentId)).toBeNull();
      });
    });

    it('작업 항목이 아예 없는 박스는 null', async () => {
      await inRollbackTx(db, async (tx) => {
        const { shipmentId, workItemId } = await seedPickableShipment(tx, 1);
        await tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.id, workItemId));
        expect(await repo.lockActiveWorkItem(tx, shipmentId)).toBeNull();
      });
    });
  });
});
