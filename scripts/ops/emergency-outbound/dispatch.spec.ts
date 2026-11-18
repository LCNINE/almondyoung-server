import { CoreApiError, LocationOutboundState } from './core-api';
import { FakeCore } from './__support__/fake-core';
import { FORCE_REASON, runDispatch } from './dispatch';
import { CsvRow, toCsv } from './outputs';
import { idemKey } from './prepare';
import { RunBox, RunState } from './run-state';
import type { Route } from './select';

const RUN = '20261119-0830';
const WH = 'wh-acme';
const BATCH = 'b-acme';

type Source = LocationOutboundState['sources'][number];

function source(line: string, loc: string, allocated: number, remaining: number): Source {
  return {
    shipmentLineId: line,
    skuId: `sku-${line}`,
    sourceLocationId: loc,
    sourceLocationCode: `A-${loc}`,
    allocatedQty: allocated,
    pickedQty: allocated - remaining,
    remainingQty: remaining,
  };
}

const tracking = (id: string) => `TRK-ACME-${id}`;

function box(id: string, route: Route = 'location'): RunBox {
  return { shipmentId: id, route, batchId: BATCH, trackingNo: tracking(id), printed: true, orderNos: [`acme-${id}`] };
}

function state(...boxes: RunBox[]): RunState {
  return { run: RUN, warehouseId: WH, batchId: BATCH, boxes, excluded: [] };
}

function row(b: RunBox, over: Partial<CsvRow> = {}): CsvRow {
  return {
    shipmentId: b.shipmentId,
    orderNo: `acme-${b.shipmentId}`,
    trackingNo: b.trackingNo ?? '',
    route: b.route,
    batchId: b.batchId,
    ...over,
  };
}

/** 위치 피킹 중인 상자: 남은 수량 1 짜리 원천 하나. */
function locationBox(core: FakeCore, id: string, sources: Source[] = [source(`l-${id}`, 'loc-1', 1, 1)]): RunBox {
  core.addShipment({ id, status: 'planned', sources });
  core.addBatch({ id: `${BATCH}-${id}`, startedAt: '2026-11-19T00:00:00Z', status: 'picking' }, [
    { shipmentId: id, status: 'picking' },
  ]);
  core.setWaybill(id, tracking(id));
  return box(id, 'location');
}

function packingBox(core: FakeCore, id: string): RunBox {
  core.addShipment({ id, status: 'planned' });
  core.addBatch({ id: `${BATCH}-${id}`, startedAt: '2026-11-19T00:00:00Z', status: 'picking' }, [
    { shipmentId: id, status: 'packing' },
  ]);
  core.setWaybill(id, tracking(id));
  return box(id, 'force');
}

function run(core: FakeCore, s: RunState, rows: CsvRow[], apply: boolean) {
  const lines: string[] = [];
  const report = runDispatch(core, { csvText: toCsv(rows), state: s, apply, log: (l) => lines.push(l) });
  return { lines, report };
}

const outcomes = (r: { rows: { shipmentId: string; outcome: string }[] }) =>
  r.rows.map((x) => [x.shipmentId, x.outcome]);

describe('runDispatch', () => {
  it('dry-run dispatches nothing', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');
    const b = packingBox(core, 's2');

    const { report, lines } = run(core, state(a, b), [row(a), row(b)], false);
    const r = await report;

    expect(core.writes()).toEqual([]);
    expect(outcomes(r)).toEqual([
      ['s1', 'would-dispatch'],
      ['s2', 'would-dispatch'],
    ]);
    expect(core.shipments.get('s1')?.status).toBe('planned');
    expect(lines[lines.length - 1]).toBe('발송 2 · 이미 0 · 거절 0 · 불일치 0 · 빠진 상자 0');
  });

  it('sends every remaining source exactly once', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1', [
      source('l-2', 'loc-9', 2, 2),
      source('l-1', 'loc-5', 1, 0),
      source('l-1', 'loc-3', 3, 1),
    ]);

    const r = await run(core, state(a), [row(a)], true).report;

    expect(outcomes(r)).toEqual([['s1', 'dispatched']]);
    expect(core.writes()).toEqual(['locationForce']);
    expect(core.callsOf('locationForce')).toEqual([
      [
        's1',
        WH,
        FORCE_REASON,
        [
          { shipmentLineId: 'l-1', sourceLocationId: 'loc-3', quantity: 1 },
          { shipmentLineId: 'l-2', sourceLocationId: 'loc-9', quantity: 2 },
        ],
        idemKey(RUN, 'dispatch', 's1'),
      ],
    ]);
    expect(core.shipments.get('s1')?.status).toBe('shipped');
  });

  it('routes packing boxes to force-dispatch', async () => {
    const core = new FakeCore(WH);
    const b = packingBox(core, 's2');

    const r = await run(core, state(b), [row(b)], true).report;

    expect(outcomes(r)).toEqual([['s2', 'dispatched']]);
    expect(core.writes()).toEqual(['forceDispatch']);
    expect(core.callsOf('forceDispatch')).toEqual([['s2', FORCE_REASON, idemKey(RUN, 'dispatch', 's2')]]);
    expect(FORCE_REASON).toBe('앱 출고 경로 장애 — 비상 출고');
  });

  it('skips an already shipped box', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');
    core.shipments.get('s1')!.status = 'in_transit';

    const r = await run(core, state(a), [row(a)], true).report;

    expect(outcomes(r)).toEqual([['s1', 'already']]);
    expect(core.writes()).toEqual([]);
  });

  it('refuses a tracking number mismatch', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');
    const b = packingBox(core, 's2');
    core.setWaybill('s1', 'TRK-ACME-OTHER');

    const { report, lines } = run(core, state(a, b), [row(a), row(b, { trackingNo: '' })], true);
    const r = await report;

    expect(outcomes(r)).toEqual([
      ['s1', 'mismatch'],
      ['s2', 'mismatch'],
    ]);
    expect(core.writes()).toEqual([]);
    expect(lines[lines.length - 1]).toBe('발송 0 · 이미 0 · 거절 0 · 불일치 2 · 빠진 상자 0');
  });

  it('reports a 409 and continues', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');
    const b = locationBox(core, 's2');
    core.failNext('locationForce', new CoreApiError(409, 'SIMPLE_OUTBOUND_PLAN_INVALIDATED', null, 'invalidated'));

    const { report, lines } = run(core, state(a, b), [row(a), row(b)], true);
    const r = await report;

    expect(r.rows).toEqual([
      { shipmentId: 's1', route: 'location', outcome: 'rejected', detail: 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' },
      { shipmentId: 's2', route: 'location', outcome: 'dispatched' },
    ]);
    expect(core.shipments.get('s1')?.status).toBe('planned');
    expect(lines[lines.length - 1]).toBe('발송 1 · 이미 0 · 거절 1 · 불일치 0 · 빠진 상자 0');
  });

  it('rejects a force box that is not packing', async () => {
    const core = new FakeCore(WH);
    const b = locationBox(core, 's2'); // 작업 항목이 picking
    const forced: RunBox = { ...b, route: 'force' };

    const r = await run(core, state(forced), [row(forced)], true).report;

    expect(r.rows).toEqual([
      { shipmentId: 's2', route: 'force', outcome: 'rejected', detail: 'SHIPMENT_NOT_INSPECTION_READY' },
    ]);
    expect(core.shipments.get('s2')?.status).toBe('planned');
  });

  it('lists boxes deleted from the csv as missing', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');
    const b = locationBox(core, 's2');
    const c = packingBox(core, 's3');

    const { report, lines } = run(core, state(a, b, c), [row(b)], true);
    const r = await report;

    expect(outcomes(r)).toEqual([['s2', 'dispatched']]);
    expect(r.missing).toEqual(['s1', 's3']);
    expect(core.shipments.get('s1')?.status).toBe('planned');
    expect(core.shipments.get('s3')?.status).toBe('planned');
    expect(core.callsOf('locationForce').map((c) => c[0])).toEqual(['s2']);
    expect(lines[lines.length - 1]).toBe('발송 1 · 이미 0 · 거절 0 · 불일치 0 · 빠진 상자 2');
  });

  it('second apply run is all already', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');
    const b = packingBox(core, 's2');
    const s = state(a, b);

    const first = await run(core, s, [row(a), row(b)], true).report;
    const writesAfterFirst = core.writes().length;
    const { report, lines } = run(core, s, [row(a), row(b)], true);
    const second = await report;

    expect(outcomes(first)).toEqual([
      ['s1', 'dispatched'],
      ['s2', 'dispatched'],
    ]);
    expect(outcomes(second)).toEqual([
      ['s1', 'already'],
      ['s2', 'already'],
    ]);
    expect(core.writes().length).toBe(writesAfterFirst);
    expect(lines[lines.length - 1]).toBe('발송 0 · 이미 2 · 거절 0 · 불일치 0 · 빠진 상자 0');
  });

  it('rejects a row that is not a box of this run', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');
    const stranger = locationBox(core, 's9');

    const r = await run(core, state(a), [row(a), row(stranger)], true).report;

    expect(r.rows).toEqual([
      { shipmentId: 's1', route: 'location', outcome: 'dispatched' },
      { shipmentId: 's9', route: 'location', outcome: 'rejected', detail: '이번 실행의 상자가 아니다' },
    ]);
    expect(core.callsOf('locationForce').map((c) => c[0])).toEqual(['s1']);
    expect(core.calls.filter((c) => c.args[0] === 's9')).toEqual([]);
  });

  it('routes by run state, not by the editable csv', async () => {
    const core = new FakeCore(WH);
    const b = packingBox(core, 's2');

    const r = await run(core, state(b), [row(b, { route: 'location' })], true).report;

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ shipmentId: 's2', route: 'force', outcome: 'dispatched' });
    expect(r.rows[0].detail).toContain('route');
    expect(core.writes()).toEqual(['forceDispatch']);
  });

  it('processes a duplicated row once and reports it', async () => {
    const core = new FakeCore(WH);
    const a = locationBox(core, 's1');

    const { report, lines } = run(core, state(a), [row(a), row(a)], true);
    const r = await report;

    expect(outcomes(r)).toEqual([['s1', 'dispatched']]);
    expect(r.duplicates).toEqual(['s1']);
    expect(core.writes()).toEqual(['locationForce']);
    expect(lines.some((l) => l.includes('s1') && l.includes('중복'))).toBe(true);
  });
});
