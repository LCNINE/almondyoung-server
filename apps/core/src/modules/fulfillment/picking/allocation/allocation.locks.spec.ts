import { assertStartEligibility } from './allocation.locks';
import { LockedAggregate } from './allocation.types';

/**
 * Only the `assertStartEligibility`-specific branches (startable-set membership, no-drift-beyond-
 * picking, a claimed `picking` item passing, no shipment lines) are covered here. The rejections
 * throw before `trx`/`waybills` are touched, so `{} as never` stands in for them. The remainder
 * (warehouse/profile/recipient/reservation/waybill checks) already has DB-gated integration
 * coverage via `outbound-preparation.concurrency.integration.spec.ts` and friends.
 */
function aggregate(
  workItems: Array<{ shipmentId: string; status: string }>,
  shipments: Array<{ id: string; status: string; warehouseId: string }> = [],
): LockedAggregate {
  return {
    batch: { warehouseId: 'wh-1' } as LockedAggregate['batch'],
    shipments: shipments as LockedAggregate['shipments'],
    lines: [],
    workItems: workItems as LockedAggregate['workItems'],
  };
}

describe('assertStartEligibility', () => {
  it('시작 대상(queued·picking) 작업 항목의 shipment 집합이 요청과 다르면 PICKING_COMPONENT_CHANGED_RETRY', async () => {
    const aggregateWithOnlyShp1Queued = aggregate([{ shipmentId: 'shp-1', status: 'queued' }]);
    await expect(
      assertStartEligibility({} as never, {} as never, aggregateWithOnlyShp1Queued, ['shp-1', 'shp-2']),
    ).rejects.toMatchObject({ response: { code: 'PICKING_COMPONENT_CHANGED_RETRY' } });
  });

  it('queued·picking 을 지난 작업 항목이 하나라도 있으면 PICKING_BATCH_STATE_CORRUPT', async () => {
    // shp-1 만 요청했고 그 shipment 의 작업 항목은 queued 라 첫 번째(멤버십) 검사는 통과한다 —
    // 배치 안의 다른 shipment 의 작업 항목이 ready_to_pack 인 손상만을 드러내야 한다.
    const aggregateWithStrayPackedItem = aggregate([
      { shipmentId: 'shp-1', status: 'queued' },
      { shipmentId: 'shp-2', status: 'ready_to_pack' },
    ]);
    await expect(
      assertStartEligibility({} as never, {} as never, aggregateWithStrayPackedItem, ['shp-1']),
    ).rejects.toMatchObject({ response: { code: 'PICKING_BATCH_STATE_CORRUPT' } });
  });

  it('단독 picker-claim 으로 picking 이 된 작업 항목도 시작 대상이라 자격 검사를 통과한다', async () => {
    // 시작 전에는 인계(HAND_IN)가 없어 커스터디가 없으므로 claim 된 항목도 그대로 배정할 수 있다.
    // shipments 가 비어 있어 프로필·운송장 검사는 돌지 않고, 예약 조회만 가짜 trx 가 돌려준다.
    const claimedSibling: LockedAggregate = {
      ...aggregate([
        { shipmentId: 'shp-1', status: 'queued' },
        { shipmentId: 'shp-2', status: 'picking' },
      ]),
      lines: [{ id: 'line-1', shipmentId: 'shp-1', skuId: 'sku-1', qty: 1 } as LockedAggregate['lines'][number]],
    };
    const reservations = [{ shipmentLineId: 'line-1', skuId: 'sku-1', warehouseId: 'wh-1', qty: 1 }];
    const trx = { select: () => ({ from: () => ({ where: () => Promise.resolve(reservations) }) }) };
    await expect(
      assertStartEligibility(trx as never, {} as never, claimedSibling, ['shp-1', 'shp-2']),
    ).resolves.toBeUndefined();
  });

  it('배치의 shipment 에 라인이 하나도 없으면 PICKING_BATCH_EMPTY', async () => {
    const aggregateWithoutLines = aggregate(
      [{ shipmentId: 'shp-1', status: 'queued' }],
      [{ id: 'shp-1', status: 'planned', warehouseId: 'wh-1' }],
    );
    await expect(
      assertStartEligibility({} as never, {} as never, aggregateWithoutLines, ['shp-1']),
    ).rejects.toMatchObject({ response: { code: 'PICKING_BATCH_EMPTY', message: 'Batch has no shipment lines' } });
  });
});
