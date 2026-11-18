import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CoreApiError } from './core-api';
import { FakeCore } from './__support__/fake-core';
import { idemKey, runPrepare } from './prepare';
import { readRun, RunState, writeRun } from './run-state';

const RUN = '20261119-0830';
const WH = 'wh-acme';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'emergency-outbound-'));
  const lines: string[] = [];
  const opts = (apply: boolean, run = RUN) => ({ warehouseId: WH, run, dir, apply, log: (l: string) => lines.push(l) });
  return { dir, lines, opts };
}

function drafts(core: FakeCore, ...ids: string[]): FakeCore {
  for (const id of ids) core.addShipment({ id, status: 'draft' });
  return core;
}

const blocked = (...ids: string[]) =>
  new CoreApiError(
    409,
    'BATCH_START_BLOCKED',
    { code: 'BATCH_START_BLOCKED', errors: ids.map((shipmentId) => ({ shipmentId, reason: 'STOCK_SHORT' })) },
    'blocked',
  );

describe('runPrepare', () => {
  it('dry-run calls no write route', async () => {
    const { dir, opts } = setup();
    const core = drafts(new FakeCore(), 's1');
    core.addShipment({ id: 's2', status: 'planned' });
    core.addShipment({ id: 's3', status: 'planned' });
    core.addBatch({ id: 'bx', startedAt: '2026-11-19T00:00:00Z', status: 'picking' }, [
      { shipmentId: 's3', status: 'picking' },
    ]);

    const report = await runPrepare(core, opts(false));

    expect(core.writes()).toEqual([]);
    expect(report.state).toBeNull();
    expect(report.targets).toEqual([
      { shipmentId: 's3', from: 'batch', batchId: 'bx', route: 'location' },
      { shipmentId: 's1', from: 'draft' },
      { shipmentId: 's2', from: 'planned' },
    ]);
    expect(readRun(dir)).toBeNull();
  });

  it('runs plan → waybills → batch → add → start in order', async () => {
    const { dir, opts } = setup();
    const core = drafts(new FakeCore(), 's1');

    const report = await runPrepare(core, opts(true));

    expect(core.writes()).toEqual(['plan', 'issueWaybills', 'createBatch', 'addToBatch', 'startBatch']);
    expect(core.callsOf('createBatch')[0]).toEqual([WH, `비상 출고 ${RUN}`, idemKey(RUN, 'batch', RUN)]);
    const expected: RunState = {
      run: RUN,
      warehouseId: WH,
      batchId: 'b',
      boxes: [{ shipmentId: 's1', route: 'location', batchId: 'b', trackingNo: 'TRK-ACME-0001', printed: false }],
      excluded: [],
    };
    expect(report.state).toEqual(expected);
    expect(readRun(dir)).toEqual(expected);
  });

  it('drops a box whose waybill failed', async () => {
    const { opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2');
    core.waybillOverrides.set('s2', { status: 'failed', code: 'SHIPMENT_PROFILE_INCOMPATIBLE' });

    const report = await runPrepare(core, opts(true));

    expect(core.callsOf('addToBatch').map((a) => a[1])).toEqual([['s1']]);
    expect(report.state?.boxes.map((b) => b.shipmentId)).toEqual(['s1']);
    const ex = report.state?.excluded.find((e) => e.shipmentId === 's2');
    expect(ex?.reason).toContain('SHIPMENT_PROFILE_INCOMPATIBLE');
  });

  it('drops a box whose plan failed and a box whose waybill is still pending', async () => {
    const { opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2', 's3');
    core.planFailures.set('s2', 'SHIPMENT_NOT_FULLY_RESERVED');
    core.waybillOverrides.set('s3', { status: 'pending', reason: 'time-budget-exceeded' });

    const report = await runPrepare(core, opts(true));

    expect(core.callsOf('issueWaybills').map((a) => a[0])).toEqual([['s1', 's3']]);
    expect(core.callsOf('addToBatch').map((a) => a[1])).toEqual([['s1']]);
    const reasons = Object.fromEntries((report.state?.excluded ?? []).map((e) => [e.shipmentId, e.reason]));
    expect(reasons.s2).toContain('SHIPMENT_NOT_FULLY_RESERVED');
    expect(reasons.s3).toContain('time-budget-exceeded');
  });

  it('excludes start blockers and restarts', async () => {
    const { dir, opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2', 's3');
    core.startBlockers.set('s2', 'STOCK_SHORT');

    const report = await runPrepare(core, opts(true));

    expect(core.callsOf('excludeFromBatch')).toEqual([
      ['b', 's2', '비상 출고 — 시작 막힘: STOCK_SHORT', idemKey(RUN, 'exclude', 's2')],
    ]);
    expect(core.callsOf('startBatch')).toEqual([
      ['b', idemKey(RUN, 'start', 'b')],
      ['b', idemKey(RUN, 'start', 'b')],
    ]);
    expect(report.state?.boxes.map((b) => b.shipmentId)).toEqual(['s1', 's3']);
    expect(report.state?.excluded).toEqual([
      { shipmentId: 's2', reason: '비상 출고 — 시작 막힘: STOCK_SHORT', orderNos: ['acme-s2'] },
    ]);
    expect(readRun(dir)?.excluded.map((e) => e.shipmentId)).toEqual(['s2']);
  });

  it('gives up after 3 restarts and keeps the state on disk', async () => {
    const { dir, opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2', 's3', 's4', 's5');
    for (const id of ['s1', 's2', 's3', 's4']) core.failNext('startBatch', blocked(id));

    await expect(runPrepare(core, opts(true))).rejects.toThrow(/시작/);

    expect(core.callsOf('startBatch')).toHaveLength(4);
    expect(core.callsOf('excludeFromBatch').map((a) => a[1])).toEqual(['s1', 's2', 's3']);
    const onDisk = readRun(dir);
    expect(onDisk?.batchId).toBe('b');
    expect(onDisk?.excluded.map((e) => e.shipmentId)).toEqual(['s1', 's2', 's3']);
  });

  it('resumes without creating a second batch', async () => {
    const { dir, opts } = setup();
    const core = drafts(new FakeCore(), 's1');
    core.failNext('startBatch', new CoreApiError(503, 'HTTP_503', null, 'core 503'));

    await expect(runPrepare(core, opts(true))).rejects.toThrow('core 503');
    expect(readRun(dir)?.batchId).toBe('b');

    drafts(core, 's2'); // 그사이 들어온 상자 — 같은 배치에 들어간다
    const report = await runPrepare(core, opts(true));

    expect(core.callsOf('createBatch')).toHaveLength(1);
    const startKeys = core.callsOf('startBatch').map((a) => a[1]);
    expect(startKeys).toEqual([idemKey(RUN, 'start', 'b'), idemKey(RUN, 'start', 'b')]);
    const addCalls = core.callsOf('addToBatch');
    expect(addCalls.map((a) => a[0])).toEqual(['b', 'b']);
    expect(new Set(addCalls.map((a) => a[2]))).toEqual(new Set([idemKey(RUN, 'add', 'b')]));
    expect(new Set(core.callsOf('plan').map((a) => a[1]))).toEqual(new Set([idemKey(RUN, 'plan', RUN)]));
    expect(report.state?.batchId).toBe('b');
    expect(report.state?.boxes.map((b) => [b.shipmentId, b.batchId, b.route])).toEqual([
      ['s1', 'b', 'location'],
      ['s2', 'b', 'location'],
    ]);
  });

  it('keeps boxes excluded earlier in the run out on resume', async () => {
    const { opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2');
    core.startBlockers.set('s2', 'STOCK_SHORT');
    await runPrepare(core, opts(true));
    const writesBefore = core.writes().length;

    const report = await runPrepare(core, opts(true));

    // s2 는 배치에서 빠져 resume 분류로 돌아왔지만 이번 실행에선 다시 넣지 않는다
    expect(core.writes().length).toBe(writesBefore);
    expect(report.targets.map((t) => t.shipmentId)).toEqual(['s1']);
    expect(report.skipped.find((s) => s.shipmentId === 's2')?.reason).toContain('시작 막힘');
    expect(report.state?.boxes.map((b) => b.shipmentId)).toEqual(['s1']);
  });

  it('skips new boxes when the run batch has already started', async () => {
    const { opts } = setup();
    const core = drafts(new FakeCore(), 's1');
    await runPrepare(core, opts(true));
    drafts(core, 's9');
    const writesBefore = core.writes().length;

    const report = await runPrepare(core, opts(true));

    expect(core.writes().length).toBe(writesBefore);
    expect(report.skipped.find((s) => s.shipmentId === 's9')?.reason).toContain('새 --run');
    expect(report.state?.boxes.map((b) => b.shipmentId)).toEqual(['s1']);
  });

  it('refuses a run.json from another run or warehouse', async () => {
    const { dir, opts } = setup();
    writeRun(dir, { run: '20261118-0900', warehouseId: WH, batchId: null, boxes: [], excluded: [] });

    await expect(runPrepare(new FakeCore(), opts(false))).rejects.toThrow(/20261118-0900/);
  });

  it('puts boxes already in batches straight into boxes', async () => {
    const { opts } = setup();
    const core = new FakeCore();
    core.addShipment({ id: 's3', status: 'planned' }).setWaybill('s3', 'TRK-ACME-0300');
    core.addShipment({ id: 's4', status: 'planned' }).setWaybill('s4', 'TRK-ACME-0400');
    core.addBatch({ id: 'bx', startedAt: '2026-11-19T00:00:00Z', status: 'picking' }, [
      { shipmentId: 's3', status: 'picking' },
    ]);
    core.addBatch({ id: 'by', pickingMethod: 'bulk', startedAt: '2026-11-19T00:00:00Z', status: 'picking' }, [
      { shipmentId: 's4', status: 'packing' },
    ]);

    const report = await runPrepare(core, opts(true));

    expect(core.writes()).toEqual([]);
    expect(report.state?.batchId).toBeNull();
    expect(report.state?.boxes).toEqual([
      { shipmentId: 's3', route: 'location', batchId: 'bx', trackingNo: 'TRK-ACME-0300', printed: false },
      { shipmentId: 's4', route: 'force', batchId: 'by', trackingNo: 'TRK-ACME-0400', printed: false },
    ]);
  });

  it('chunks shipment ids by 100', async () => {
    const { opts } = setup();
    const ids = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const core = drafts(new FakeCore(), ...ids);

    const report = await runPrepare(core, opts(true));

    expect(
      core
        .callsOf('preparation')
        .filter((a) => a[1] === 'ready')
        .map((a) => a[2]),
    ).toEqual([0, 200]);
    expect(core.callsOf('plan').map((a) => (a[0] as string[]).length)).toEqual([100, 100, 50]);
    expect(core.callsOf('issueWaybills').map((a) => (a[0] as string[]).length)).toEqual([100, 100, 50]);
    expect(core.callsOf('addToBatch').map((a) => (a[1] as string[]).length)).toEqual([100, 100, 50]);
    expect(report.state?.boxes).toHaveLength(250);
  });

  it('does nothing when nothing is selectable', async () => {
    const { dir, lines, opts } = setup();
    const core = new FakeCore();

    const report = await runPrepare(core, opts(true));

    expect(core.writes()).toEqual([]);
    expect(lines.some((l) => l.includes('대상 0'))).toBe(true);
    expect(report.targets).toEqual([]);
    expect(readRun(dir)).toBeNull();
  });

  it('explains an idempotency mismatch', async () => {
    const { opts } = setup();
    const core = drafts(new FakeCore(), 's1');
    core.failNext('plan', new CoreApiError(409, 'FULFILLMENT_IDEMPOTENCY_MISMATCH', {}, 'mismatch'));

    const error: unknown = await runPrepare(core, opts(true)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('같은 사람만');
    expect(String(error)).toContain('새 --run');
  });

  it('explains an idempotency mismatch reported per shipment', async () => {
    const { opts } = setup();
    const core = drafts(new FakeCore(), 's1');
    core.planFailures.set('s1', 'FULFILLMENT_IDEMPOTENCY_MISMATCH');

    await expect(runPrepare(core, opts(true))).rejects.toThrow(/같은 사람만[\s\S]*새 --run/);
    expect(core.writes()).toEqual(['plan']);
  });
});

describe('idemKey', () => {
  it('is emergency:<run>:<step>:<id>', () => {
    expect(idemKey(RUN, 'plan', RUN)).toBe('emergency:20261119-0830:plan:20261119-0830');
  });
  it('refuses characters an Idempotency-Key header cannot carry', () => {
    expect(() => idemKey('2026 11 19', 'plan', 'x')).toThrow(/Idempotency-Key/);
    expect(() => idemKey(RUN, 'plan', 'x'.repeat(200))).toThrow(/Idempotency-Key/);
  });
});

describe('run-state', () => {
  it('round-trips run.json', () => {
    const { dir } = setup();
    const s: RunState = {
      run: RUN,
      warehouseId: WH,
      batchId: 'b',
      boxes: [{ shipmentId: 's1', route: 'force', batchId: 'b', trackingNo: null, printed: false }],
      excluded: [{ shipmentId: 's2', reason: 'x', orderNos: ['acme-1'] }],
    };
    writeRun(dir, s);
    expect(readRun(dir)).toEqual(s);
  });
  it('returns null without run.json and refuses a broken one', () => {
    const { dir } = setup();
    expect(readRun(dir)).toBeNull();
    writeFileSync(join(dir, 'run.json'), '{"run": 1}');
    expect(() => readRun(dir)).toThrow(/run\.json/);
  });
});
