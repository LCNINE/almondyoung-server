import { assertStartEligibility } from './allocation.locks';
import { LockedAggregate } from './allocation.types';

/**
 * Only the two `assertStartEligibility`-specific branches (queued-set membership, no-drift-beyond-
 * queued) are covered here — both throw before `trx`/`waybills` are touched, so `{} as never` stands
 * in for them. The remainder (warehouse/profile/recipient/reservation/waybill checks)
 * already has DB-gated integration coverage via `outbound-preparation.concurrency.integration.spec.ts`
 * and friends.
 */
function aggregate(workItems: Array<{ shipmentId: string; status: string }>): LockedAggregate {
  return {
    batch: { warehouseId: 'wh-1' } as LockedAggregate['batch'],
    shipments: [],
    lines: [],
    workItems: workItems as LockedAggregate['workItems'],
  };
}

describe('assertStartEligibility', () => {
  it('queued 작업 항목의 shipment 집합이 요청과 다르면 PICKING_COMPONENT_CHANGED_RETRY', async () => {
    const aggregateWithOnlyShp1Queued = aggregate([{ shipmentId: 'shp-1', status: 'queued' }]);
    await expect(
      assertStartEligibility({} as never, {} as never, aggregateWithOnlyShp1Queued, ['shp-1', 'shp-2']),
    ).rejects.toMatchObject({ response: { code: 'PICKING_COMPONENT_CHANGED_RETRY' } });
  });

  it('queued 가 아닌 작업 항목이 하나라도 있으면 PICKING_BATCH_STATE_CORRUPT', async () => {
    // shp-1 만 요청했고 그 shipment 의 작업 항목은 queued 라 첫 번째(멤버십) 검사는 통과한다 —
    // 배치 안의 다른 shipment 의 작업 항목이 picking 인 손상만을 드러내야 한다.
    const aggregateWithStrayPickingItem = aggregate([
      { shipmentId: 'shp-1', status: 'queued' },
      { shipmentId: 'shp-2', status: 'picking' },
    ]);
    await expect(
      assertStartEligibility({} as never, {} as never, aggregateWithStrayPickingItem, ['shp-1']),
    ).rejects.toMatchObject({ response: { code: 'PICKING_BATCH_STATE_CORRUPT' } });
  });
});
