import type { BatchListItem, PreparationShipment, WorkItem, WorkItemStatus } from './core-api';
import { selectTargets } from './select';

const ship = (id: string, reason: string | null = null): PreparationShipment => ({
  shipmentId: id,
  orderNos: [`acme-${id}`],
  itemSummary: 'x',
  totalQty: 1,
  single: true,
  reason,
  lines: [],
  split: null,
});
const batch = (id: string, pickingMethod: string, started: boolean): BatchListItem => ({
  id,
  batchNumber: id,
  name: id,
  warehouseId: 'wh-acme',
  status: started ? 'in_progress' : 'planned',
  pickingMethod,
  cartCapacity: 1,
  totalItems: 1,
  totalQty: 1,
  withdrawingItems: 0,
  scheduledPickingAt: '2026-11-18T00:00:00Z',
  startedAt: started ? '2026-11-18T01:00:00Z' : null,
  createdAt: '2026-11-18T00:00:00Z',
});
const wi = (batchId: string, shipmentId: string, status: WorkItemStatus): WorkItem => ({
  id: `wi-${shipmentId}`,
  batchId,
  shipmentId,
  status,
});
const base = { ready: [], resume: [], otherBuckets: [], batches: [] };

describe('selectTargets', () => {
  it('ready -> draft', () => {
    expect(selectTargets({ ...base, ready: [ship('s1')] }).targets).toEqual([{ shipmentId: 's1', from: 'draft' }]);
  });
  it('resume -> planned', () => {
    expect(selectTargets({ ...base, resume: [ship('s1')] }).targets).toEqual([{ shipmentId: 's1', from: 'planned' }]);
  });
  it('started individual picking -> location', () => {
    const r = selectTargets({
      ...base,
      batches: [
        {
          batch: batch('b1', 'individual', true),
          workItems: [wi('b1', 's1', 'picking'), wi('b1', 's2', 'queued')],
        },
      ],
    });
    expect(r.targets).toEqual([
      { shipmentId: 's1', from: 'batch', batchId: 'b1', route: 'location' },
      { shipmentId: 's2', from: 'batch', batchId: 'b1', route: 'location' },
    ]);
  });
  it('packing in total_picking -> force', () => {
    const r = selectTargets({
      ...base,
      batches: [
        {
          batch: batch('b1', 'total_picking', true),
          workItems: [wi('b1', 's1', 'packing'), wi('b1', 's2', 'ready_to_pack')],
        },
      ],
    });
    expect(r.targets).toEqual([
      { shipmentId: 's1', from: 'batch', batchId: 'b1', route: 'force' },
      { shipmentId: 's2', from: 'batch', batchId: 'b1', route: 'force' },
    ]);
  });
  it('queued in total_picking -> skipped', () => {
    const r = selectTargets({
      ...base,
      batches: [{ batch: batch('b1', 'total_picking', true), workItems: [wi('b1', 's1', 'queued')] }],
    });
    expect(r.targets).toEqual([]);
    expect(r.skipped).toEqual([{ shipmentId: 's1', reason: '다른 피킹 방식 배치에서 피킹 중' }]);
  });
  it('queued in not-started individual -> skipped', () => {
    const r = selectTargets({
      ...base,
      batches: [{ batch: batch('b1', 'individual', false), workItems: [wi('b1', 's1', 'queued')] }],
    });
    expect(r.targets).toEqual([]);
    expect(r.skipped[0].reason).toBe('시작 전 배치 — 앱/화면에서 시작하거나 배치에서 뺀 뒤 다시');
  });
  it("treats the run's own not-started batch as resumable", () => {
    const r = selectTargets({
      ...base,
      ownBatchId: 'b1',
      batches: [
        {
          batch: batch('b1', 'individual', false),
          workItems: [wi('b1', 's1', 'queued'), wi('b1', 's2', 'picking')],
        },
        { batch: batch('b2', 'individual', false), workItems: [wi('b2', 's3', 'queued')] },
      ],
    });
    expect(r.targets).toEqual([
      { shipmentId: 's1', from: 'batch', batchId: 'b1', route: 'location' },
      { shipmentId: 's2', from: 'batch', batchId: 'b1', route: 'location' },
    ]);
    expect(r.skipped.map((s) => s.shipmentId)).toEqual(['s3']);
  });
  it('mergeable -> skipped with 합칠 수 있는', () => {
    const r = selectTargets({
      ...base,
      otherBuckets: [{ bucket: 'mergeable', shipments: [ship('s1')] }],
    });
    expect(r.skipped[0].reason).toContain('합칠 수 있는');
    expect(r.skipped[0].orderNos).toEqual(['acme-s1']);
  });
  it('other buckets use bucket name and reason', () => {
    const r = selectTargets({
      ...base,
      otherBuckets: [{ bucket: 'unavailable', shipments: [ship('s1', '재고 부족')] }],
    });
    expect(r.skipped[0].reason).toBe('unavailable: 재고 부족');
  });
  it('completed ignored; withdrawing and short_pick_recovery reported', () => {
    const r = selectTargets({
      ...base,
      batches: [
        {
          batch: batch('b1', 'individual', true),
          workItems: [
            wi('b1', 's1', 'completed'),
            wi('b1', 's2', 'excluded'),
            wi('b1', 's3', 'withdrawing'),
            wi('b1', 's4', 'short_pick_recovery'),
          ],
        },
      ],
    });
    expect(r.targets).toEqual([]);
    expect(r.skipped.map((s) => s.shipmentId)).toEqual(['s3', 's4']);
  });
  it('a shipment never appears twice (batch wins)', () => {
    const r = selectTargets({
      ...base,
      ready: [ship('s1')],
      resume: [ship('s1'), ship('s2')],
      otherBuckets: [{ bucket: 'mergeable', shipments: [ship('s1')] }],
      batches: [{ batch: batch('b1', 'individual', true), workItems: [wi('b1', 's1', 'picking')] }],
    });
    expect(r.targets).toEqual([
      { shipmentId: 's1', from: 'batch', batchId: 'b1', route: 'location' },
      { shipmentId: 's2', from: 'planned' },
    ]);
    expect(r.skipped).toEqual([]);
  });
});
