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

function setup(opts: { core?: 'down' | Record<string, string | null>; open?: unknown[]; redeliverThrows?: boolean } = {}) {
  const source = { channel: 'medusa', fetchOrders: jest.fn(async () => [snapshot('a'), snapshot('b')]) };
  const repo = {
    mappingsByExternalOrderId: jest.fn(async () => new Map()),
    openQuarantineExternalOrderIds: jest.fn(async () => new Set()),
    wmsOrderIdsWithFailedOutbox: jest.fn(async () => new Set()),
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
});
