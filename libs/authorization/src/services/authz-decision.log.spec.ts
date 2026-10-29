import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import { AuthzDecisionLog } from './authz-decision.log';
import type { PermissionCacheStatus } from './permission-cache';
import type { PermissionRuntimeOptions } from './permission-runtime.options';

const options: PermissionRuntimeOptions = {
  service: 'core',
  refreshIntervalMs: 30_000,
  retryBaseMs: 1_000,
  summaryIntervalMs: 300_000,
};
const ready: PermissionCacheStatus = { state: 'ready', version: 'v1', ageMs: 4_000, consecutiveFailures: 0 };

function decisionLog(): AuthzDecisionLog {
  return new AuthzDecisionLog({ status: () => ready }, options);
}

function logged(spy: jest.SpyInstance, event: string): unknown[] {
  return spy.mock.calls
    .map(([line]: unknown[]): unknown => (typeof line === 'string' ? JSON.parse(line) : null))
    .filter(
      (entry: unknown) => typeof entry === 'object' && entry !== null && 'event' in entry && entry.event === event,
    );
}

async function counted(kind: string, outcome: string, checkpoint = ''): Promise<number> {
  const metric = await register.getSingleMetric('authz_decisions_total')?.get();
  return (
    metric?.values.find(
      (v) => v.labels.kind === kind && v.labels.outcome === outcome && v.labels.checkpoint === checkpoint,
    )?.value ?? 0
  );
}

describe('AuthzDecisionLog', () => {
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    register.resetMetrics();
    info = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('counts allow, deny and unavailable separately', async () => {
    const log = decisionLog();
    log.record('route', 'GET /orders', { allowed: true }, ['order.order.read'], ['admin']);
    log.record(
      'route',
      'GET /orders',
      { allowed: false, reason: 'missing_permission' },
      ['order.order.read'],
      ['intern'],
    );
    log.record('route', 'GET /orders', { allowed: false, reason: 'unavailable' }, ['order.order.read'], ['admin']);
    log.record(
      'checkpoint',
      'fulfillment.planning_scope',
      { allowed: true },
      ['fulfillment.shipment.reopen'],
      ['system:x'],
    );
    log.flush(Date.now());

    expect(logged(info, 'authz_decision_summary')).toEqual([
      expect.objectContaining({
        service: 'core',
        allowed: 2,
        denied: 1,
        unavailable: 1,
        overflow: 0,
        snapshotVersion: 'v1',
        snapshotAgeSeconds: 4,
      }),
    ]);
    expect(await counted('route', 'allow')).toBe(1);
    expect(await counted('route', 'deny')).toBe(1);
    expect(await counted('route', 'unavailable')).toBe(1);
    expect(await counted('checkpoint', 'allow', 'fulfillment.planning_scope')).toBe(1);
  });

  it('logs the first denial per name and reason in a window', () => {
    const log = decisionLog();
    const deny = { allowed: false, reason: 'missing_permission' } as const;
    log.record('route', 'GET /orders', deny, ['order.order.read'], ['intern', 'admin']);
    log.record('route', 'GET /orders', deny, ['order.order.read'], ['intern']);
    log.record('route', 'GET /orders', { allowed: false, reason: 'unavailable' }, ['order.order.read'], ['intern']);

    expect(logged(warn, 'authz_decision_denied')).toEqual([
      {
        event: 'authz_decision_denied',
        service: 'core',
        kind: 'route',
        name: 'GET /orders',
        reason: 'missing_permission',
        required: ['order.order.read'],
        roles: ['admin', 'intern'],
      },
      expect.objectContaining({ name: 'GET /orders', reason: 'unavailable' }),
    ]);

    log.flush(Date.now());
    log.record('route', 'GET /orders', deny, ['order.order.read'], ['intern']);
    expect(logged(warn, 'authz_decision_denied')).toHaveLength(3);
  });

  it('keeps the ten most denied names in the summary', () => {
    const log = decisionLog();
    const deny = { allowed: false, reason: 'missing_permission' } as const;
    for (let i = 0; i < 12; i += 1) {
      for (let n = 0; n <= i; n += 1) log.record('route', `GET /r${i}`, deny, ['order.order.read'], ['intern']);
    }
    log.flush(Date.now());

    const [summary] = logged(info, 'authz_decision_summary');
    expect(summary).toMatchObject({ denied: 78 });
    const top = typeof summary === 'object' && summary !== null && 'topDenied' in summary ? summary.topDenied : [];
    expect(top).toHaveLength(10);
    expect(top).toEqual(
      expect.arrayContaining([{ kind: 'route', name: 'GET /r11', reason: 'missing_permission', count: 12 }]),
    );
    expect(top).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: 'GET /r0' })]));
  });

  it('stays silent for a window without decisions', () => {
    decisionLog().flush(Date.now());
    expect(logged(info, 'authz_decision_summary')).toEqual([]);
  });

  it('caps the remembered denial kinds and counts the rest as overflow', () => {
    const log = decisionLog();
    const deny = { allowed: false, reason: 'missing_permission' } as const;
    for (let i = 0; i < 205; i += 1) log.record('route', `GET /r${i}`, deny, ['order.order.read'], ['intern']);
    log.flush(Date.now());

    expect(logged(warn, 'authz_decision_denied')).toHaveLength(200);
    expect(logged(info, 'authz_decision_summary')).toEqual([expect.objectContaining({ denied: 205, overflow: 5 })]);
  });
});
