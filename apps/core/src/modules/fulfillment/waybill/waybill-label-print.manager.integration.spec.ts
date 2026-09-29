import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ambientDbService, inRollbackTx, makeDb, seedPickableShipment, startBatchFor } from '../services/__support__';
import { assembleLabels, promoteToCarrierWaybill } from './__support__/label-fixtures';
import { latestPrint } from './label/label-print-policy';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('송장 출력 확인 (DB integration)', () => {
  jest.setTimeout(120_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => sql.end({ timeout: 5 }));

  async function startedCarrierBox(tx: DbTx) {
    const box = await seedPickableShipment(tx, 2);
    await promoteToCarrierWaybill(tx, box);
    await startBatchFor(tx, box);
    return { box, labels: assembleLabels(ambientDbService(tx)) };
  }

  const setPassword = (tx: DbTx, shipmentId: string, value: string | null) =>
    tx.update(wmsTables.shipments).set({ entrancePassword: value }).where(eq(wmsTables.shipments.id, shipmentId));

  it('렌더한 지문을 확인하면 판차 1 로 기록한다 — 같은 지문을 두 번 확인해도 한 행', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, labels } = await startedCarrierBox(tx);
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      const first = await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      const second = await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      expect([first.revision, second.revision]).toEqual([1, 1]);
      expect(await labels.prints.listByShipments(tx, [box.shipmentId])).toHaveLength(1);
    });
  });

  it('렌더 뒤 내용이 바뀌었으면 409 LABEL_CONTENT_CHANGED — 기록하지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, labels } = await startedCarrierBox(tx);
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await setPassword(tx, box.shipmentId, '#9999');
      await expect(labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx)).rejects.toThrow(
        /^LABEL_CONTENT_CHANGED:/,
      );
      expect(await labels.prints.listByShipments(tx, [box.shipmentId])).toEqual([]);
    });
  });

  it('내용이 바뀐 뒤 새로 렌더해 확인하면 판차 2, 원래 내용으로 되돌아와 다시 확인하면 판차 1 이 «마지막 출력»이 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, labels } = await startedCarrierBox(tx);
      const a = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, a.fingerprint, { id: box.actorId }, tx);
      await setPassword(tx, box.shipmentId, '#9999');
      const b = await labels.render.render(box.shipmentId, tx);
      expect(b.revision).toBe(2);
      await labels.confirm.confirm(box.shipmentId, b.fingerprint, { id: box.actorId }, tx);
      await tx
        .update(wmsTables.waybillLabelPrints)
        .set({ printedAt: new Date('2026-01-01T00:00:00Z') })
        .where(eq(wmsTables.waybillLabelPrints.shipmentId, box.shipmentId));
      await setPassword(tx, box.shipmentId, null); // 픽스처 초기값은 NULL
      const again = await labels.render.render(box.shipmentId, tx);
      expect(again).toMatchObject({ fingerprint: a.fingerprint, revision: 1 });
      await labels.confirm.confirm(box.shipmentId, again.fingerprint, { id: box.actorId }, tx);
      expect(latestPrint(await labels.prints.listByShipments(tx, [box.shipmentId]))?.fingerprint).toBe(a.fingerprint);
    });
  });
});
