import { randomUUID } from 'crypto';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb } from './__support__';
import { seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { ambientDbService, assembleOutbound } from './__support__/simple-outbound-wiring';
import { assembleLabels, promoteToCarrierWaybill } from '../waybill/__support__/label-fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const actor = { id: randomUUID(), roles: ['master'] };

describeIfDb('빠지는 박스의 전진 명령 (스펙 §12 SHIPMENT_WITHDRAWN, PR 3)', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** 둘째 박스를 집고 뺀다 — withdrawing. */
  async function withdrawing(tx: DbTx) {
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
          custodyType: 'PACKING',
          custodyRef: `work-item:${second.workItemId}`,
          shipmentLineId: second.shipmentLineId,
        },
      },
      tx,
    );
    const out = await wiring.batches.excludeShipment(
      first.batchId,
      second.shipmentId,
      { reason: '고객 요청' },
      `x-${randomUUID()}`,
      actor,
      tx,
    );
    expect(out.workItem.status).toBe('withdrawing');
    return { first, second, wiring, sessionId: run.sessionId, workItem: out.workItem };
  }

  it('단순출고 스캔은 SHIPMENT_WITHDRAWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring } = await withdrawing(tx);
      await expect(
        tx.transaction((trx) =>
          wiring.simple.scan(
            second.shipmentId,
            { barcode: second.barcode, quantity: 1, actor, idempotencyKey: `sc-${randomUUID()}` },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
    });
  });

  it('피킹 스캔(전략)은 SHIPMENT_WITHDRAWN — 옛 리스로 와도', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring, sessionId, workItem } = await withdrawing(tx);
      await expect(
        tx.transaction((trx) =>
          wiring.picking.scan(
            {
              strategy: 'discrete',
              stage: 'source',
              batchId: workItem.batchId,
              sessionId,
              workItemId: workItem.id,
              shipmentId: second.shipmentId,
              shipmentLineId: second.shipmentLineId,
              skuId: second.skuId,
              sourceLocationId: second.locationId,
              quantity: 1,
              actor,
              expectedLeaseVersion: workItem.leaseVersion,
              idempotencyKey: `p-${randomUUID()}`,
            },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
    });
  });

  it('송장 게이트는 SHIPMENT_WITHDRAWN, 송장 렌더는 WAYBILL_LABEL_NOT_ALLOCATED', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, workItem } = await withdrawing(tx);
      // 수기 송장은 I4 면제 — 한진 송장이어야 렌더 경로가 I4 에 닿는다.
      await promoteToCarrierWaybill(tx, second);
      const labels = assembleLabels(ambientDbService(tx));
      await expect(labels.guard.assertCurrent(workItem.id, tx)).rejects.toMatchObject({
        response: { code: 'SHIPMENT_WITHDRAWN' },
      });
      await expect(labels.assembler.current(second.shipmentId, tx)).rejects.toThrow(/WAYBILL_LABEL_NOT_ALLOCATED/);
    });
  });

  it('검수·발송은 SHIPMENT_WITHDRAWN', async () => {
    await inRollbackTx(db, async (tx) => {
      const { second, wiring } = await withdrawing(tx);
      await expect(
        tx.transaction((trx) =>
          wiring.dispatch.inspectShipmentLines(
            second.shipmentId,
            {
              entries: [{ shipmentLineId: second.shipmentLineId, quantity: 1 }],
              actor,
              idempotencyKey: `i-${randomUUID()}`,
            },
            trx,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_WITHDRAWN' } });
    });
  });
});
