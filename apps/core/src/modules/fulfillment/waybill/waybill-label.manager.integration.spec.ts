import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { ambientDbService, inRollbackTx, makeDb, seedPickableShipment, startBatchFor } from '../services/__support__';
import { assembleLabels, promoteToCarrierWaybill } from './__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WaybillLabelManager.render (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('시작된 배치의 한진 송장 박스면 ZPL 과 지문·판차 1 을 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      const label = await render.render(box.shipmentId, tx);
      expect(label).toMatchObject({ trackingNo, format: 'zpl', revision: 1 });
      expect(label.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(label.data.startsWith('^XA')).toBe(true);
      expect(label.data).toContain(`^B2R,96,N,N,N^FD${trackingNo}^FS`);
    });
  });

  it('시작 전 배치의 박스는 409 WAYBILL_LABEL_NOT_ALLOCATED (I4)', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      await expect(render.render(box.shipmentId, tx)).rejects.toThrow(/^WAYBILL_LABEL_NOT_ALLOCATED:/);
    });
  });

  it('지문은 배정 로케이션이 바뀌면 달라지고, 같으면 몇 번 그려도 같다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      const a = await render.render(box.shipmentId, tx);
      const b = await render.render(box.shipmentId, tx);
      expect(b.fingerprint).toBe(a.fingerprint);
      await tx
        .update(wmsTables.locations)
        .set({ code: `MOVED-${randomUUID()}` })
        .where(eq(wmsTables.locations.id, box.locationId));
      expect((await render.render(box.shipmentId, tx)).fingerprint).not.toBe(a.fingerprint);
    });
  });

  it('수기 송장은 409 WAYBILL_LABEL_UNAVAILABLE', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await startBatchFor(tx, box);
      const { render } = assembleLabels(ambientDbService(tx));
      await expect(render.render(box.shipmentId, tx)).rejects.toThrow(/WAYBILL_LABEL_UNAVAILABLE/);
    });
  });

  it('운송장이 없으면 409 WAYBILL_NOT_DISPATCHABLE', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.id, box.waybillId));
      const { render } = assembleLabels(ambientDbService(tx));
      await expect(render.render(box.shipmentId, tx)).rejects.toThrow(/WAYBILL_NOT_DISPATCHABLE/);
    });
  });

  it('발급 후 수하인이 바뀌면 409 WAYBILL_STALE (라벨이 한진 등록값과 달라진다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      await startBatchFor(tx, box);
      await tx
        .update(wmsTables.shipments)
        .set({
          recipientSnapshot: {
            recipientName: 'Simple Test',
            phone: '010-3333-4444',
            postalCode: '06236',
            roadAddress: 'Teheran-ro 123',
            detailAddress: 'CHANGED',
          },
        })
        .where(eq(wmsTables.shipments.id, box.shipmentId));
      const { render } = assembleLabels(ambientDbService(tx));
      await expect(render.render(box.shipmentId, tx)).rejects.toThrow(/WAYBILL_(STALE|NOT_DISPATCHABLE)/);
    });
  });

  it('없는 shipment 는 404 WAYBILL_SHIPMENT_NOT_FOUND', async () => {
    await inRollbackTx(db, async (tx) => {
      const { render } = assembleLabels(ambientDbService(tx));
      await expect(render.render(randomUUID(), tx)).rejects.toThrow(/WAYBILL_SHIPMENT_NOT_FOUND/);
    });
  });
});
