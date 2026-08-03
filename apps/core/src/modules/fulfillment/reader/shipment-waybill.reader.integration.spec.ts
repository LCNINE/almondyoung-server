import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { NotFoundException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ambientDbService,
  assembleSimpleOutbound,
  inRollbackTx,
  makeDb,
  seedPickableShipment,
} from '../services/__support__';
import { ShipmentWaybillReader } from './shipment-waybill.reader';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShipmentWaybillReader', () => {
  const { sql, db } = makeDb(DATABASE_URL as string);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('운송장번호로 박스와 라인 진행을 돌려준다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const reader = new ShipmentWaybillReader(ambientDbService(tx));

      const result = await reader.byTrackingNo(fixture.trackingNo);

      expect(result.shipmentId).toBe(fixture.shipmentId);
      expect(result.carrier).toBe('HANJIN');
      expect(result.batchId).toBe(fixture.batchId);
      expect(result.workItemId).toBe(fixture.workItemId);
      expect(result.workItemStatus).toBe('queued');
      expect(result.recipientMasked).toBe('Simple*****');
      expect(result.lines).toEqual([
        {
          shipmentLineId: fixture.shipmentLineId,
          skuId: fixture.skuId,
          skuCode: fixture.skuCode,
          skuName: 'Simple SKU',
          qty: 2,
          pickedQty: 0,
          inspectedQty: 0,
        },
      ]);
    });
  });

  // 리뷰 지적 2: 스펙 §4.1 은 by-waybill 라인에 pickedQty 를 요구한다. 박스를 내려놨다가
  // 다시 스캔하는 재개 흐름에서, inspectedQty 는 전량 스캔 전까지 0 에 머물기 때문에
  // pickedQty 가 없으면 화면이 매번 0/N 부터 다시 시작해 재스캔이 과다스캔(409)으로
  // 튕긴다. 이 테스트는 실제 서비스로 절반만 스캔한 뒤 reader 가 그 진행을 그대로
  // 보고하는지 — active session 의 batch_inventory_session_balances 집계(SETTLED 제외)를
  // 검증한다.
  it('절반만 스캔된 라인은 pickedQty 에 그 진행을 그대로 보고한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      const service = assembleSimpleOutbound(tx);
      const actor = { id: fixture.actorId, roles: ['logistics_worker'] };

      const state = await service.scan(
        fixture.shipmentId,
        { barcode: fixture.barcode, quantity: 1, actor, idempotencyKey: `scan-${randomUUID()}` },
        tx,
      );
      expect(state.status).toBe('in_progress');

      const reader = new ShipmentWaybillReader(ambientDbService(tx));
      const result = await reader.byTrackingNo(fixture.trackingNo);

      expect(result.lines).toEqual([
        {
          shipmentLineId: fixture.shipmentLineId,
          skuId: fixture.skuId,
          skuCode: fixture.skuCode,
          skuName: 'Simple SKU',
          qty: 2,
          pickedQty: 1,
          inspectedQty: 0,
        },
      ]);
    });
  });

  it('숏픽 회복 중인 박스는 활성 작업으로 보고된다 — 종결(completed/excluded) 만 빠져야 한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 2);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ status: 'short_pick_recovery', recoveryReason: 'short pick found during packing' })
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItemId));
      const reader = new ShipmentWaybillReader(ambientDbService(tx));

      const result = await reader.byTrackingNo(fixture.trackingNo);

      expect(result.batchId).toBe(fixture.batchId);
      expect(result.workItemId).toBe(fixture.workItemId);
      expect(result.workItemStatus).toBe('short_pick_recovery');
    });
  });

  it('없는 운송장번호는 404 다', async () => {
    await inRollbackTx(db, async (tx) => {
      const reader = new ShipmentWaybillReader(ambientDbService(tx));
      await expect(reader.byTrackingNo('NO-SUCH-TRACK')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('무효화된 운송장은 404 다 — 종결 상태는 작업 대상이 아니다', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedPickableShipment(tx, 1);
      await tx.update(wmsTables.waybills).set({ status: 'voided' }).where(eq(wmsTables.waybills.id, fixture.waybillId));
      const reader = new ShipmentWaybillReader(ambientDbService(tx));

      await expect(reader.byTrackingNo(fixture.trackingNo)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
