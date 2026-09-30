import { DbTx } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb } from '../services/__support__';
import { seedSpareStock, startedShortPickBox } from '../services/__support__/short-pick-fixtures';
import { ambientDbService } from '../services/__support__/simple-outbound-wiring';
import { assembleLabels, promoteToCarrierWaybill } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('송장 스캔 — 결품 (스펙 §10.5·§9, PR 4)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
  const readerFor = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    return new ShipmentWaybillReader(dbService, assembleLabels(dbService).states);
  };

  it('결품으로 빠진 박스의 옛 송장을 스캔하면 withdrawn(exitTo draft)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 0);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      await report(3);
      await expect(readerFor(tx).byTrackingNo(trackingNo)).resolves.toMatchObject({
        shipmentId: box.shipmentId,
        labelState: 'withdrawn',
        exitTo: 'draft',
        batchId: null,
        workItemId: null,
        shipmentStatus: 'draft',
      });
    });
  });

  it('채운 박스는 출력 기록이 있으면 reprint_required — 바뀐 줄에 새 로케이션', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 0);
      const spare = await seedSpareStock(tx, box, 5);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      const labels = assembleLabels(ambientDbService(tx));
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      await report(2);
      const found = await readerFor(tx).byTrackingNo(trackingNo);
      expect(found.labelState).toBe('reprint_required');
      expect(found.labelChanges).toEqual(
        expect.arrayContaining([expect.objectContaining({ locationCode: spare.code, printedQty: 0, currentQty: 2 })]),
      );
    });
  });

  it('활성 송장으로 찾은 채운 박스는 결품 폴백을 타지 않는다(무효 송장만 본다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { box, report } = await startedShortPickBox(tx, 0);
      await seedSpareStock(tx, box, 5);
      const { trackingNo } = await promoteToCarrierWaybill(tx, box);
      await report(2);
      const found = await readerFor(tx).byTrackingNo(trackingNo);
      expect(found.labelState).toBe('never_printed');
      expect(found.workItemId).toBe(box.workItemId);
    });
  });
});
