import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CoreApiError } from './core-api';
import { FakeCore, realConflict } from './__support__/fake-core';
import { idemKey, runPrepare } from './prepare';
import { readRun, RunState, writeRun } from './run-state';

const RUN = '20261119-0830';
const WH = 'wh-acme';

function setup() {
  // 실제 배치처럼 <뿌리>/<실행 id> — prepare 가 옆 폴더(다른 실행)의 run.json 을 읽는다.
  const root = mkdtempSync(join(tmpdir(), 'emergency-outbound-'));
  const dir = join(root, RUN);
  mkdirSync(dir);
  const lines: string[] = [];
  const opts = (apply: boolean, run = RUN) => ({
    warehouseId: WH,
    run,
    dir,
    apply,
    outputs: false,
    log: (l: string) => lines.push(l),
  });
  return { root, dir, lines, opts };
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
      boxes: [
        {
          shipmentId: 's1',
          route: 'location',
          batchId: 'b',
          trackingNo: 'TRK-ACME-0001',
          printed: false,
          orderNos: ['acme-s1'],
        },
      ],
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

  it('does not put a box back after core excluded it but the run died before saving', async () => {
    const { dir, opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2');
    core.startBlockers.set('s2', 'STOCK_SHORT');
    core.failAfter('excludeFromBatch', new Error('fetch reset after commit'));

    await expect(runPrepare(core, opts(true))).rejects.toThrow('fetch reset after commit');
    expect(core.items.find((w) => w.shipmentId === 's2')?.status).toBe('excluded');
    expect(readRun(dir)?.excluded.map((e) => e.shipmentId)).toEqual(['s2']);

    const report = await runPrepare(core, opts(true));

    // s2 는 resume 분류로 돌아왔지만 다시 담기지 않는다(같은 담기 키면 core 가 옛 성공을 재생한다)
    expect(core.callsOf('addToBatch').map((a) => a[1])).toEqual([['s1', 's2']]);
    expect(report.state?.boxes.map((b) => b.shipmentId)).toEqual(['s1']);
    expect(report.state?.excluded.map((e) => e.shipmentId)).toEqual(['s2']);
    expect(readRun(dir)?.boxes.map((b) => b.shipmentId)).toEqual(['s1']);
    expect(core.batchRows.get('b')?.startedAt).not.toBeNull();
  });

  it('finishes an exclusion recorded before the run died, with the stored reason', async () => {
    const { opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2');
    core.startBlockers.set('s2', 'STOCK_SHORT');
    core.failNext('excludeFromBatch', new Error('core unreachable'));

    await expect(runPrepare(core, opts(true))).rejects.toThrow('core unreachable');
    expect(core.items.find((w) => w.shipmentId === 's2')?.status).toBe('queued');

    const report = await runPrepare(core, opts(true));

    const excludes = core.callsOf('excludeFromBatch');
    expect(excludes).toHaveLength(2);
    expect(excludes[1]).toEqual(excludes[0]); // 같은 키·같은 사유 — 불일치가 나지 않는다
    expect(core.items.find((w) => w.shipmentId === 's2')?.status).toBe('excluded');
    expect(report.state?.boxes.map((b) => b.shipmentId)).toEqual(['s1']);
    expect(core.batchRows.get('b')?.startedAt).not.toBeNull();
  });

  it('finishes a pending exclusion even when no target remains', async () => {
    const { dir, lines, opts } = setup();
    const core = drafts(new FakeCore(), 's1');
    core.startBlockers.set('s1', 'STOCK_SHORT');
    core.failNext('excludeFromBatch', new Error('core unreachable'));

    await expect(runPrepare(core, opts(true))).rejects.toThrow('core unreachable');
    expect(core.items.find((w) => w.shipmentId === 's1')?.status).toBe('queued');

    // dry-run 은 남은 빼기를 알리기만 한다
    const dry = await runPrepare(core, opts(false));
    expect(dry.targets).toEqual([]);
    expect(core.callsOf('excludeFromBatch')).toHaveLength(1);
    expect(lines.some((l) => l.includes('마저 뺀다') && l.includes('--apply'))).toBe(true);

    const report = await runPrepare(core, opts(true));

    const excludes = core.callsOf('excludeFromBatch');
    expect(excludes).toHaveLength(2);
    expect(excludes[1]).toEqual(['b', 's1', '비상 출고 — 시작 막힘: STOCK_SHORT', idemKey(RUN, 'exclude', 's1')]);
    expect(excludes[1]).toEqual(excludes[0]);
    expect(core.items.find((w) => w.shipmentId === 's1')?.status).toBe('excluded');
    expect(report.targets).toEqual([]);
    expect(report.state?.excluded.map((e) => e.shipmentId)).toEqual(['s1']);
    expect(readRun(dir)?.boxes).toEqual([]);
    expect(core.callsOf('startBatch')).toHaveLength(1); // 빈 배치는 시작하지 않는다
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

  it('leaves the undispatched boxes of an earlier run on the same day to that run', async () => {
    const { root, opts } = setup();
    const core = drafts(new FakeCore(), 's1', 's2');
    const morning = '20261119-0700';
    const morningDir = join(root, morning);
    await runPrepare(core, { ...opts(true), run: morning, dir: morningDir });
    expect(core.batchRows.get('b')?.startedAt).not.toBeNull();
    drafts(core, 's9');
    const callsBefore = core.calls.length;

    const report = await runPrepare(core, opts(true));

    const reason = `앞 실행 ${morning} 의 상자 — 그 실행의 dispatch 로`;
    expect(report.targets).toEqual([{ shipmentId: 's9', from: 'draft' }]);
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        { shipmentId: 's1', reason },
        { shipmentId: 's2', reason },
      ]),
    );
    expect(report.state?.boxes.map((b) => b.shipmentId)).toEqual(['s9']);
    expect(report.state?.batchId).not.toBe('b');
    const added = core.calls.slice(callsBefore).filter((c) => c.method === 'addToBatch');
    expect(added.map((c) => c.args[1])).toEqual([['s9']]);
  });

  it('stops when another run folder has a broken run.json', async () => {
    const { root, opts } = setup();
    mkdirSync(join(root, '20261119-0700'));
    writeFileSync(join(root, '20261119-0700', 'run.json'), '{"run": ');

    await expect(runPrepare(drafts(new FakeCore(), 's1'), opts(false))).rejects.toThrow(/20261119-0700/);
  });

  it('refuses a run.json from another run or warehouse', async () => {
    const { dir, opts } = setup();
    writeRun(dir, { run: '20261118-0900', warehouseId: WH, batchId: null, boxes: [], excluded: [] });

    await expect(runPrepare(new FakeCore(), opts(false))).rejects.toThrow(/20261118-0900/);
  });

  it('reports boxes of the other preparation buckets one by one', async () => {
    const { lines, opts } = setup();
    const core = drafts(new FakeCore(), 's1');
    core.addShipment({ id: 's5', status: 'draft', bucket: 'partial', reason: '재고 일부만', orderNos: ['acme-5'] });
    core.addShipment({ id: 's6', status: 'draft', bucket: 'mergeable', orderNos: ['acme-6'] });

    const report = await runPrepare(core, opts(false));

    expect(core.callsOf('preparation').map((a) => a[1])).toEqual(
      expect.arrayContaining(['partial', 'unavailable', 'mergeable', 'needs_info']),
    );
    expect(report.targets).toEqual([{ shipmentId: 's1', from: 'draft' }]);
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        { shipmentId: 's5', reason: 'partial: 재고 일부만', orderNos: ['acme-5'] },
        expect.objectContaining({ shipmentId: 's6', orderNos: ['acme-6'] }),
      ]),
    );
    expect(lines.some((l) => l.includes('s5') && l.includes('acme-5'))).toBe(true);
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

describe('runPrepare outputs', () => {
  const withOutputs = (o: ReturnType<ReturnType<typeof setup>['opts']>) => ({ ...o, outputs: true });
  const located = (core: FakeCore, id: string, code: string) =>
    core.addShipment({
      id,
      status: 'draft',
      orderNos: [`acme-${id}`],
      lines: [{ id: `l-${id}`, skuId: `k-${id}`, skuName: `상품-${id}`, qty: 1 }],
      sources: [
        {
          shipmentLineId: `l-${id}`,
          skuId: `k-${id}`,
          sourceLocationId: `loc-${code}`,
          sourceLocationCode: code,
          allocatedQty: 1,
          pickedQty: 0,
          remainingQty: 1,
        },
      ],
    });

  const labelErr = (code: string) => realConflict(code);

  it('keeps a manual-waybill box in the files without a label and without a problem', async () => {
    const { dir, opts, lines } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    located(core, 's2', 'B-01');
    core.manualWaybills.add('s1');

    const report = await runPrepare(core, withOutputs(opts(true)));

    expect(report.problems).toEqual([]);
    const tracking = report.state?.boxes.map((b) => b.trackingNo) ?? [];
    expect(readFileSync(join(dir, 'labels.zpl'), 'utf8')).toBe(`^XA^FD${tracking[1]}^FS^XZ\n`);
    const csv = readFileSync(join(dir, 'shipments.csv'), 'utf8');
    expect(csv).toContain('s1,');
    expect(csv).toContain('s2,');
    expect(readFileSync(join(dir, 'pick-list.html'), 'utf8')).toContain('수기 송장 — 라벨은 따로 (이 파일에 없음)');
    expect(core.prints.map((p) => p.shipmentId)).toEqual(['s2']);
    expect(readRun(dir)?.boxes.find((b) => b.shipmentId === 's1')?.printed).toBe(false);
    expect(lines.some((l) => l.includes('수기 송장 1'))).toBe(true);
  });

  it('records another label error as a problem and still writes every box', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    located(core, 's2', 'B-01');
    core.failNext('label', labelErr('SOMETHING_ELSE'));

    const report = await runPrepare(core, withOutputs(opts(true)));

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('s1');
    expect(report.problems[0]).toContain('SOMETHING_ELSE');
    expect(readFileSync(join(dir, 'shipments.csv'), 'utf8')).toContain('s1,');
    expect(core.prints.map((p) => p.shipmentId)).toEqual(['s2']);
  });

  it('records a confirm error as a problem and goes on', async () => {
    const { opts } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    located(core, 's2', 'B-01');
    core.failNext('confirmLabelPrint', labelErr('BOOM'));

    const report = await runPrepare(core, withOutputs(opts(true)));

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('BOOM');
    expect(core.prints.map((p) => p.shipmentId)).toEqual(['s2']);
  });

  it('resumes the same run after a manual-waybill box without a new batch', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    core.failNext('label', labelErr('WAYBILL_LABEL_UNAVAILABLE'));
    await runPrepare(core, withOutputs(opts(true)));

    const again = await runPrepare(core, withOutputs(opts(true)));

    expect(core.callsOf('createBatch')).toHaveLength(1);
    expect(again.problems).toEqual([]);
    expect(readFileSync(join(dir, 'labels.zpl'), 'utf8')).toContain('^XA');
    expect(readRun(dir)?.boxes[0].printed).toBe(true);
  });

  it('lists the remaining qty and drops fully picked sources', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    const src = (code: string, allocatedQty: number, pickedQty: number) => ({
      shipmentLineId: 'l-s1',
      skuId: 'k-s1',
      sourceLocationId: `loc-${code}`,
      sourceLocationCode: code,
      allocatedQty,
      pickedQty,
      remainingQty: allocatedQty - pickedQty,
    });
    core.addShipment({
      id: 's1',
      status: 'draft',
      lines: [{ id: 'l-s1', skuId: 'k-s1', skuName: '상품-s1', qty: 5 }],
      sources: [src('A-01', 3, 1), src('A-02', 2, 2)],
    });

    await runPrepare(core, withOutputs(opts(true)));

    const html = readFileSync(join(dir, 'pick-list.html'), 'utf8');
    expect(html).toContain('A-01 · 상품-s1 × 2');
    expect(html).not.toContain('A-02');
  });

  it('keeps every order number of a multi-order box after a resume', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    core.addShipment({ id: 's1', status: 'draft', orderNos: ['acme-1', 'acme-2'] });
    await runPrepare(core, withOutputs(opts(true)));

    await runPrepare(core, withOutputs(opts(true)));

    expect(readFileSync(join(dir, 'shipments.csv'), 'utf8')).toContain('acme-1 / acme-2');
    expect(readFileSync(join(dir, 'pick-list.html'), 'utf8')).toContain('acme-1 / acme-2');
  });

  it('reports boxes without a tracking number as problems', async () => {
    const { opts, lines } = setup();
    const core = new FakeCore();
    core.addShipment({ id: 'sx', status: 'planned' });
    core.addBatch({ id: 'bx', startedAt: '2026-11-19T00:00:00Z', status: 'picking' }, [
      { shipmentId: 'sx', status: 'picking' },
    ]);

    const report = await runPrepare(core, withOutputs(opts(true)));

    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('sx');
    expect(lines.some((l) => l.includes('오류') && l.includes('sx'))).toBe(true);
    expect(core.prints).toEqual([]);
  });

  it('writes labels in picking order and confirms each print', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    located(core, 's1', 'B-01');
    located(core, 's2', 'A-01');

    const report = await runPrepare(core, withOutputs(opts(true)));

    const zpl = readFileSync(join(dir, 'labels.zpl'), 'utf8');
    const tracking = report.state?.boxes.map((b) => b.trackingNo) ?? [];
    expect(tracking).toHaveLength(2);
    // s2(A-01) 가 먼저 — s1 이 먼저 발급돼 TRK 번호가 더 작다
    expect(zpl).toBe(`^XA^FD${tracking[1]}^FS^XZ\n^XA^FD${tracking[0]}^FS^XZ\n`);
    expect(core.prints.map((p) => p.shipmentId)).toEqual(['s2', 's1']);
    expect(readRun(dir)?.boxes.every((b) => b.printed)).toBe(true);
    const csv = readFileSync(join(dir, 'shipments.csv'), 'utf8');
    expect(
      csv
        .split('\r\n')
        .slice(1, 3)
        .map((l) => l.split(',')[0]),
    ).toEqual(['s2', 's1']);
    expect(readFileSync(join(dir, 'pick-list.html'), 'utf8')).toContain('A-01 · 상품-s2 × 1');
  });

  it('retries a changed label once and rewrites the file', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    core.failNext('confirmLabelPrint', realConflict('LABEL_CONTENT_CHANGED', 'changed'));

    await runPrepare(core, withOutputs(opts(true)));

    expect(core.callsOf('label')).toHaveLength(2);
    expect(core.prints).toHaveLength(1);
    expect(readRun(dir)?.boxes[0].printed).toBe(true);
  });

  it('keeps a worker-edited shipments.csv on a same-run rerun and writes the new list beside it', async () => {
    const { dir, opts, lines } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    located(core, 's2', 'B-01');
    await runPrepare(core, withOutputs(opts(true)));
    const csvPath = join(dir, 'shipments.csv');
    // 작업자가 저녁에 못 나간 줄을 지웠다
    const edited = readFileSync(csvPath, 'utf8')
      .split('\r\n')
      .filter((l) => !l.startsWith('s1,'))
      .join('\r\n');
    writeFileSync(csvPath, edited, 'utf8');
    lines.length = 0;

    await runPrepare(core, { ...withOutputs(opts(true)), now: () => new Date('2026-11-19T01:02:03Z') });

    expect(readFileSync(csvPath, 'utf8')).toBe(edited);
    const fresh = join(dir, 'shipments.20261119-100203.csv');
    expect(readFileSync(fresh, 'utf8')).toContain('s1,');
    expect(
      lines.some(
        (l) => l.includes('shipments.csv') && l.includes('그대로') && l.includes('shipments.20261119-100203.csv'),
      ),
    ).toBe(true);
  });

  it('does not write a second csv when the regenerated list is the same', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    await runPrepare(core, withOutputs(opts(true)));

    await runPrepare(core, withOutputs(opts(true)));

    expect(readdirSync(dir).filter((f) => f.startsWith('shipments'))).toEqual(['shipments.csv']);
  });

  it('regenerates files on resume but confirms only unprinted boxes', async () => {
    const { dir, opts } = setup();
    const core = new FakeCore();
    located(core, 's1', 'A-01');
    await runPrepare(core, withOutputs(opts(true)));
    expect(core.prints).toHaveLength(1);

    await runPrepare(core, withOutputs(opts(true)));

    expect(core.prints).toHaveLength(1);
    expect(readFileSync(join(dir, 'labels.zpl'), 'utf8')).toContain('^XA');
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
