import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentWaybillReader } from './shipment-waybill.reader';
import { inRollbackTx, makeDb } from '../services/__support__';
import { seedReturnBin, seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from '../services/__support__/simple-outbound-wiring';
import { assembleLabels } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('송장 스캔 — 빠지는·빠진 박스 (스펙 §10.5, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const readerFor = (tx: DbTx) => {
    const dbService = ambientDbService(tx);
    return new ShipmentWaybillReader(dbService, assembleLabels(dbService).states);
  };

  async function pickedAndWithdrawn(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const run = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    await wiring.sessions.moveCustody(
      {
        sessionId: run.sessionId,
        idempotencyKey: `m-${randomUUID()}`,
        actorId: second.actorId,
        quantity: 1,
        from: { skuId: second.skuId, sourceLocationId: second.locationId, custodyType: 'AT_SOURCE' },
        to: {
          skuId: second.skuId,
          sourceLocationId: second.locationId,
          custodyType: 'WORKER',
          custodyRef: second.actorId,
          shipmentLineId: second.shipmentLineId,
        },
      },
      tx,
    );
    await wiring.batches.excludeShipment(first.batchId, second.shipmentId, { reason: 'x' }, `x-${randomUUID()}`, actor, tx);
    return { first, second, wiring, sessionId: run.sessionId };
  }

  it('빼는 중이면 withdrawing + 뺄 목록 + exitTo', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second } = await pickedAndWithdrawn(tx);
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found).toMatchObject({
        labelState: 'withdrawing',
        workItemStatus: 'withdrawing',
        exitTo: 'draft',
        removals: [expect.objectContaining({ shipmentLineId: second.shipmentLineId, boxQty: 1, cartQty: 0 })],
      });
    });
  });

  it('다 빼서 나갔으면 withdrawn — 배치·작업 항목은 null', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring } = await pickedAndWithdrawn(tx);
      const bin = await seedReturnBin(tx, second.warehouseId, second.actorId);
      await wiring.returns.removeToReturnBin(
        second.shipmentId,
        { barcode: second.barcode, returnBinBarcode: bin.barcode, quantity: 1 },
        actor,
        `r-${randomUUID()}`,
        tx,
      );
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found).toMatchObject({ labelState: 'withdrawn', batchId: null, workItemId: null, removals: [] });
    });
  });

  it('전체 취소로 나가 송장이 무효여도 그 번호로 withdrawn 을 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
      const wiring = assembleOutbound(tx);
      await wiring.picking.start(
        { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
        tx,
      );
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, second.shipmentId));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, second.shipmentLineId));
      await wiring.planning.cancelOutstanding(
        second.shipmentId,
        {
          expectedManifestVersion: shipment.manifestVersion,
          reason: '고객 취소',
          lines: [{ shipmentLineId: line.id, expectedLineVersion: line.lineVersion, qty: line.qty }],
        },
        `c-${randomUUID()}`,
        actor,
        tx,
      );
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found).toMatchObject({ labelState: 'withdrawn', shipmentStatus: 'canceled', waybillStatus: 'voided' });
    });
  });

  it('시작 전 배치에서 제외된 박스는 withdrawn 이 아니다(null)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second, wiring } = await (async () => {
        const seeded = await seedTwoBoxBatch(tx, 1, 10);
        return { ...seeded, wiring: assembleOutbound(tx) };
      })();
      await wiring.batches.excludeShipment(first.batchId, second.shipmentId, { reason: 'x' }, `x-${randomUUID()}`, actor, tx);
      const found = await readerFor(tx).byTrackingNo(second.trackingNo);
      expect(found.labelState).toBeNull();
    });
  });
});
