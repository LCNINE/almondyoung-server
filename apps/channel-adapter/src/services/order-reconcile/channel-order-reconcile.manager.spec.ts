import { ChannelOrderReconcileManager } from './channel-order-reconcile.manager';
import { RECONCILE_RULES } from './channel-order-reconcile.classifier';

const NOW = new Date('2026-10-16T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const snapshot = (id: string, over: Record<string, unknown> = {}) => ({
  externalOrderId: id,
  displayOrderNo: `D-${id}`,
  paymentState: 'accepted',
  sourceUpdatedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
  createdAt: new Date(NOW.getTime() - 3 * HOUR).toISOString(),
  lifecycle: [],
  ...over,
});

interface SetupOptions {
  core?: 'down' | Record<string, string | null>;
  open?: unknown[];
  redeliverThrows?: boolean;
  snapshots?: ReturnType<typeof snapshot>[];
  mappings?: Record<string, string>;
  quarantined?: string[];
  inFlight?: string[];
  closedAt?: Record<string, Date>;
}

function setup(opts: SetupOptions = {}) {
  const source = { channel: 'medusa', fetchOrders: jest.fn(async () => opts.snapshots ?? [snapshot('a'), snapshot('b')]) };
  const repo = {
    mappingsByExternalOrderId: jest.fn(async () => new Map(Object.entries(opts.mappings ?? {}))),
    openQuarantineExternalOrderIds: jest.fn(async () => new Set(opts.quarantined ?? [])),
    outboxStateByWmsOrderId: jest.fn(async () => ({ failed: new Set<string>(), inFlight: new Set(opts.inFlight ?? []) })),
    latestClosedAt: jest.fn(async () => new Map(Object.entries(opts.closedAt ?? {}))),
    findOpenByOrders: jest.fn(async () => []),
    upsertOpen: jest.fn(async (input: { externalOrderId: string; kind: string }) => ({
      id: `f-${input.externalOrderId}`,
      ...input,
    })),
    recordAttempt: jest.fn(async () => undefined),
    listOpen: jest.fn(async () => opts.open ?? []),
    markResolved: jest.fn(async (ids: string[]) => ids.length),
  };
  const statuses = opts.core === 'down' ? null : (opts.core ?? { a: null, b: 'confirmed' });
  const lookup = {
    lookup: jest.fn(async (_c: string, orders: { externalOrderId: string }[]) => {
      if (!statuses) throw new Error('core 502');
      return new Map(
        orders.map((o) => {
          const status = statuses[o.externalOrderId];
          return [o.externalOrderId, { externalOrderId: o.externalOrderId, salesOrder: status ? { status } : null, openEventFailure: false }];
        }),
      );
    }),
  };
  const redelivery = {
    redeliver: jest.fn(async () => {
      if (opts.redeliverThrows) throw new Error('outbox down');
      return 'enqueued';
    }),
  };
  const syncStatus = { getSyncStatus: jest.fn(async () => ({ lastSyncAt: new Date(NOW.getTime() - 60_000) })) };
  const manager = new ChannelOrderReconcileManager(
    [source] as never,
    repo as never,
    lookup as never,
    redelivery as never,
    syncStatus as never,
  );
  return { manager, repo, lookup, redelivery, source };
}
const run = (manager: ChannelOrderReconcileManager, observeOnly = false) =>
  manager.runCycle('medusa', { updatedAfter: new Date(NOW.getTime() - 72 * HOUR), now: NOW, observeOnly });

describe('ChannelOrderReconcileManager', () => {
  const originalMode = RECONCILE_RULES.missing_order.mode;
  afterEach(() => {
    RECONCILE_RULES.missing_order.mode = originalMode;
  });

  it('관찰 모드: 불일치를 would_act 로 기록하고 아무것도 보내지 않는다', async () => {
    RECONCILE_RULES.missing_order.mode = 'observe';
    const { manager, repo, redelivery } = setup();
    const report = await run(manager);
    expect(repo.upsertOpen).toHaveBeenCalledTimes(1);
    expect(repo.upsertOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        externalOrderId: 'a',
        kind: 'missing_order',
        mode: 'observe',
        lastResult: 'would_act',
        displayOrderNo: 'D-a',
      }),
    );
    expect(redelivery.redeliver).not.toHaveBeenCalled();
    expect(report).toMatchObject({ scanned: 2, findings: 1, redelivered: 0 });
  });

  it('실행 모드: auto 불일치를 다시 배달한다', async () => {
    RECONCILE_RULES.missing_order.mode = 'act';
    const { manager, redelivery } = setup();
    const report = await run(manager);
    expect(redelivery.redeliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-a', kind: 'missing_order' }));
    expect(report.redelivered).toBe(1);
  });

  it('observeOnly(처음 한 번 훑기)는 규칙이 act 여도 보내지 않는다', async () => {
    RECONCILE_RULES.missing_order.mode = 'act';
    const { manager, repo, redelivery } = setup();
    await run(manager, true);
    expect(repo.upsertOpen).toHaveBeenCalledWith(expect.objectContaining({ mode: 'observe' }));
    expect(redelivery.redeliver).not.toHaveBeenCalled();
  });

  it('core 조회 실패면 아무것도 기록하지 않는다', async () => {
    const { manager, repo } = setup({ core: 'down' });
    const report = await run(manager);
    expect(report.skipped).toBe('core_unavailable');
    expect(repo.upsertOpen).not.toHaveBeenCalled();
    expect(repo.markResolved).not.toHaveBeenCalled();
  });

  it('다시 배달이 던지면 오류를 last_result 로 남기고 다음 주문으로 간다', async () => {
    RECONCILE_RULES.missing_order.mode = 'act';
    const { manager, repo } = setup({ core: { a: null, b: null }, redeliverThrows: true });
    await run(manager);
    expect(repo.recordAttempt).toHaveBeenCalledWith('f-a', 'error: outbox down');
    expect(repo.recordAttempt).toHaveBeenCalledWith('f-b', 'error: outbox down');
  });

  it('열린 행은 core 조회만으로 해소를 확인한다', async () => {
    const open = [
      { id: 'o1', externalOrderId: 'x', kind: 'missing_order' },
      { id: 'o2', externalOrderId: 'y', kind: 'cancel_not_applied' },
      { id: 'o3', externalOrderId: 'z', kind: 'cancel_not_applied' },
    ];
    const { manager, repo } = setup({
      core: { a: 'confirmed', b: 'confirmed', x: 'confirmed', y: 'cancelled', z: 'confirmed' },
      open,
    });
    const report = await run(manager);
    expect(repo.markResolved).toHaveBeenCalledWith(['o1', 'o2'], NOW);
    expect(report.resolved).toBe(2);
  });

  it('종결 뒤 채널이 바뀌지 않은 주문은 다시 열지 않는다 (리뷰 I-1)', async () => {
    const { manager, repo } = setup({ closedAt: { 'a:missing_order': new Date(NOW.getTime() - HOUR) } });
    await run(manager);
    expect(repo.upsertOpen).not.toHaveBeenCalled();
  });

  it('종결 뒤 채널이 바뀐 주문은 새로 연다 (리뷰 I-1)', async () => {
    const { manager, repo } = setup({ closedAt: { 'a:missing_order': new Date(NOW.getTime() - 5 * HOUR) } });
    await run(manager);
    expect(repo.upsertOpen).toHaveBeenCalledWith(expect.objectContaining({ externalOrderId: 'a' }));
  });

  it('더는 어긋남이 아닌 열린 행은 닫는다 — pending 이 된 주문, 수집 격리된 주문 (리뷰 I-2)', async () => {
    const open = [
      { id: 'o-c', externalOrderId: 'c', kind: 'missing_order' },
      { id: 'o-q', externalOrderId: 'q', kind: 'missing_order' },
    ];
    const { manager, repo } = setup({
      snapshots: [snapshot('c', { paymentState: 'pending' }), snapshot('q')],
      quarantined: ['q'],
      core: { c: null, q: null },
      open,
    });
    await run(manager);
    expect(repo.markResolved).toHaveBeenCalledWith(['o-c', 'o-q'], NOW);
  });

  it('아직 판정할 때가 아니거나 outbox 가 나가는 중이면 열린 행을 닫지 않는다 (리뷰 I-2·I-8)', async () => {
    const open = [
      { id: 'o-r', externalOrderId: 'r', kind: 'missing_order' },
      { id: 'o-f', externalOrderId: 'f', kind: 'missing_order' },
    ];
    const { manager, repo } = setup({
      snapshots: [snapshot('r', { sourceUpdatedAt: new Date(NOW.getTime() - 60_000).toISOString() }), snapshot('f')],
      mappings: { f: 'wms-f' },
      inFlight: ['wms-f'],
      core: { r: null, f: null },
      open,
    });
    await run(manager);
    expect(repo.upsertOpen).not.toHaveBeenCalled();
    expect(repo.markResolved).toHaveBeenCalledWith([], NOW);
  });

  describe('manualRedeliveryBlock (리뷰 I-3·I-5)', () => {
    const finding = (externalOrderId: string, kind: string) => ({ channel: 'medusa', externalOrderId, kind });

    it('막을 이유가 없으면 null', async () => {
      const { manager } = setup({ core: { a: null } });
      await expect(manager.manualRedeliveryBlock(finding('a', 'missing_order'))).resolves.toBeNull();
    });

    it('어댑터 outbox 가 FAILED·나가는 중이면 막는다', async () => {
      const { manager, repo } = setup({ core: { a: null }, mappings: { a: 'wms-a' } });
      repo.outboxStateByWmsOrderId.mockResolvedValueOnce({ failed: new Set(['wms-a']), inFlight: new Set() });
      await expect(manager.manualRedeliveryBlock(finding('a', 'missing_order'))).resolves.toBe('event_failure_open');
      repo.outboxStateByWmsOrderId.mockResolvedValueOnce({ failed: new Set(), inFlight: new Set(['wms-a']) });
      await expect(manager.manualRedeliveryBlock(finding('a', 'missing_order'))).resolves.toBe('in_flight');
    });

    it('core 이벤트 실패가 열려 있으면 막는다(wmsOrderId 로 묻는다)', async () => {
      const { manager, lookup } = setup({ core: { a: null }, mappings: { a: 'wms-a' } });
      lookup.lookup.mockResolvedValueOnce(
        new Map([['a', { externalOrderId: 'a', salesOrder: null, openEventFailure: true }]]),
      );
      await expect(manager.manualRedeliveryBlock(finding('a', 'missing_order'))).resolves.toBe('event_failure_open');
      expect(lookup.lookup).toHaveBeenCalledWith('medusa', [{ externalOrderId: 'a', wmsOrderId: 'wms-a' }]);
    });

    it('이미 core 에 맞게 있으면 막는다', async () => {
      const { manager } = setup({ core: { a: 'confirmed', b: 'cancelled' } });
      await expect(manager.manualRedeliveryBlock(finding('a', 'missing_order'))).resolves.toBe('already_in_core');
      await expect(manager.manualRedeliveryBlock(finding('b', 'cancel_not_applied'))).resolves.toBe('already_in_core');
    });

    it('core 가 취소를 받을 수 없는 상태(셀메이트 shipped)면 막는다', async () => {
      const { manager } = setup({ core: { a: 'shipped' } });
      await expect(manager.manualRedeliveryBlock(finding('a', 'cancel_not_applied'))).resolves.toBe('core_status');
    });
  });
});
