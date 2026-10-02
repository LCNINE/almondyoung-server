import { randomUUID } from 'crypto';
import { and, eq, notInArray } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { maskName, readRecipientName } from '../reader/recipient-snapshot';
import { ambientDbService, inRollbackTx, makeDb, seedPickableShipment, startBatchFor } from '../services/__support__';
import { seedTwoBoxBatch } from '../services/__support__/simple-outbound-fixtures';
import { assembleLabels, promoteToCarrierWaybill } from './__support__/label-fixtures';
import { WAYBILL_TERMINAL_STATUSES } from './waybill.constants';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('송장 상태 리더 (DB integration)', () => {
  jest.setTimeout(120_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => sql.end({ timeout: 5 }));

  it('not_started → never_printed → current → reprint_required(바뀐 줄) — 조회는 아무것도 바꾸지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const box = await seedPickableShipment(tx, 2);
      await promoteToCarrierWaybill(tx, box);
      const labels = assembleLabels(ambientDbService(tx));
      expect((await labels.states.forShipment(box.shipmentId, tx))?.state).toBe('not_started');
      await startBatchFor(tx, box);
      expect((await labels.states.forShipment(box.shipmentId, tx))?.state).toBe('never_printed');
      const { fingerprint } = await labels.render.render(box.shipmentId, tx);
      await labels.confirm.confirm(box.shipmentId, fingerprint, { id: box.actorId }, tx);
      expect((await labels.states.forShipment(box.shipmentId, tx))?.state).toBe('current');
      const newCode = `MOVED-${randomUUID()}`;
      await tx.update(wmsTables.locations).set({ code: newCode }).where(eq(wmsTables.locations.id, box.locationId));
      const view = await labels.states.forShipment(box.shipmentId, tx);
      expect(view?.state).toBe('reprint_required');
      // 정렬은 로케이션 코드 순이라 시드 코드와 MOVED-… 의 앞뒤에 기대지 않는다 — 사라진 줄·새 줄 한 쌍만 본다.
      expect(
        view?.changes.map((c) => [c.locationCode === newCode ? 'new' : 'old', c.printedQty, c.currentQty]).sort(),
      ).toEqual([
        ['new', 0, 2],
        ['old', 2, 0],
      ]);
      expect(await labels.prints.listByShipments(tx, [box.shipmentId])).toHaveLength(1);
    });
  });

  it('수기 송장은 external, 송장이 무효화된 박스는 unavailable + 사유 코드', async () => {
    await inRollbackTx(db, async (tx) => {
      const manual = await seedPickableShipment(tx, 1);
      await startBatchFor(tx, manual);
      const labels = assembleLabels(ambientDbService(tx));
      expect((await labels.states.forShipment(manual.shipmentId, tx))?.state).toBe('external');
      await tx
        .update(wmsTables.waybills)
        .set({ status: 'voided', voidedAt: new Date() })
        .where(eq(wmsTables.waybills.id, manual.waybillId));
      expect(await labels.states.forShipment(manual.shipmentId, tx)).toMatchObject({
        state: 'unavailable',
        issue: 'WAYBILL_NOT_DISPATCHABLE',
      });
    });
  });

  it('forBatch 는 배치의 활성 박스마다 상태를 준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx);
      await promoteToCarrierWaybill(tx, first);
      await startBatchFor(tx, first);
      const labels = assembleLabels(ambientDbService(tx));
      const states = await labels.states.forBatch(first.batchId, tx);
      expect(states.map((s) => [s.shipmentId, s.state]).sort()).toEqual(
        [
          [first.shipmentId, 'never_printed'],
          [second.shipmentId, 'external'],
        ].sort(),
      );
    });
  });

  it('forBatch 는 박스마다 작업 상태·지금 송장번호·가린 받는 분을 싣는다(배치 현황 박스 목록)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { first, second } = await seedTwoBoxBatch(tx);
      await promoteToCarrierWaybill(tx, first);
      await startBatchFor(tx, first);
      const labels = assembleLabels(ambientDbService(tx));
      const states = await labels.states.forBatch(first.batchId, tx);
      for (const box of [first, second]) {
        const [waybill] = await tx
          .select({ trackingNo: wmsTables.waybills.trackingNo })
          .from(wmsTables.waybills)
          .where(
            and(
              eq(wmsTables.waybills.shipmentId, box.shipmentId),
              notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
            ),
          );
        const [shipment] = await tx
          .select({ snapshot: wmsTables.shipments.recipientSnapshot })
          .from(wmsTables.shipments)
          .where(eq(wmsTables.shipments.id, box.shipmentId));
        const [item] = await tx
          .select({ status: wmsTables.outboundBatchWorkItems.status })
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.id, box.workItemId));
        expect(states.find((s) => s.shipmentId === box.shipmentId)).toMatchObject({
          workItemStatus: item.status,
          trackingNo: waybill?.trackingNo ?? null,
          recipientMasked: maskName(readRecipientName(shipment.snapshot)),
        });
      }
      // 택배사 송장으로 올린 박스는 송장번호가 있다 — 비교가 null = null 로 헛돌지 않게
      expect(states.find((s) => s.shipmentId === first.shipmentId)?.trackingNo).toEqual(expect.any(String));
    });
  });
});
