import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import { PermissionCache } from './permission-cache';
import { PermissionCheckpoints } from './permission-checkpoints';
import { recordPermissionDecisions } from './permission-decision';
import { PermissionDecider } from './permission-decider';
import { PermissionRuntimeOptions } from './permission-runtime.options';
import { systemPrincipal } from './system-principal';

const options: PermissionRuntimeOptions = {
  service: 'core',
  enforce: false,
  refreshIntervalMs: 30_000,
  retryBaseMs: 1_000,
  summaryIntervalMs: 300_000,
};

const cache = (byRole: Record<string, string[]> | null): Pick<PermissionCache, 'permissionsFor' | 'status'> => ({
  permissionsFor: (roles) => (byRole === null ? null : new Set(roles.flatMap((role) => byRole[role] ?? []))),
  status: () => ({
    state: byRole ? 'ready' : 'cold',
    version: byRole ? 'v1' : null,
    ageMs: byRole ? 1_000 : null,
    consecutiveFailures: 0,
  }),
});

const count = async (checkpoint: string, outcome: string) => {
  const metric = await register.getSingleMetric('authz_checkpoint_evaluations_total')?.get();
  return metric?.values.find((v) => v.labels.checkpoint === checkpoint && v.labels.outcome === outcome)?.value ?? 0;
};

describe('PermissionCheckpoints', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  const build = (byRole: Record<string, string[]> | null) => {
    const c = cache(byRole);
    return new PermissionCheckpoints(new PermissionDecider(c), c, options);
  };

  beforeEach(() => {
    register.resetMetrics();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns the legacy answer even when the new one differs', async () => {
    const checkpoints = build({ logistics_worker: [] });
    expect(
      checkpoints.compare('fulfillment.work_supervise', true, { roles: ['logistics_worker'] }, [
        'fulfillment.work.supervise',
      ]),
    ).toBe(true);
    expect(await count('fulfillment.work_supervise', 'would_deny')).toBe(1);
    expect(JSON.parse(warn.mock.calls[0][0])).toEqual({
      event: 'authz_checkpoint_mismatch',
      service: 'core',
      checkpoint: 'fulfillment.work_supervise',
      subject: ['logistics_worker'],
      legacy: 'allow',
      next: 'deny',
      reason: 'missing_permission',
      required: ['fulfillment.work.supervise'],
    });
  });

  it('counts a match without logging', async () => {
    const checkpoints = build({ logistics_manager: ['fulfillment.work.supervise'] });
    expect(
      checkpoints.compare('fulfillment.work_supervise', true, { roles: ['logistics_manager'] }, [
        'fulfillment.work.supervise',
      ]),
    ).toBe(true);
    expect(await count('fulfillment.work_supervise', 'match')).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('records a wider new answer as would_allow', async () => {
    const checkpoints = build({ intern: ['catalog.product.read'] });
    expect(checkpoints.compare('file.staff_context_read', false, { roles: ['intern'] }, ['catalog.product.read'])).toBe(
      false,
    );
    expect(await count('file.staff_context_read', 'would_allow')).toBe(1);
  });

  it('counts unavailable separately', async () => {
    const checkpoints = build(null);
    expect(
      checkpoints.compare('fulfillment.dispatch_recall', true, { roles: ['logistics_manager'] }, [
        'fulfillment.dispatch.recall',
      ]),
    ).toBe(true);
    expect(await count('fulfillment.dispatch_recall', 'unavailable')).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('allows a system principal without a snapshot', async () => {
    const checkpoints = build(null);
    expect(
      checkpoints.compare('fulfillment.planning_scope', true, systemPrincipal('core.fulfillment-system'), [
        'fulfillment.shipment.reopen',
      ]),
    ).toBe(true);
    expect(await count('fulfillment.planning_scope', 'match')).toBe(1);
  });

  it('denies a missing subject', async () => {
    const checkpoints = build({});
    expect(
      checkpoints.compare('membership.refund_override', false, undefined, ['membership.billing.refund_override']),
    ).toBe(false);
    expect(await count('membership.refund_override', 'match')).toBe(1);
  });

  it('compares a route decision stamp', async () => {
    const checkpoints = build({ admin: ['ai.assistant.use'] });
    const request = {};
    recordPermissionDecisions(request, ['ai.assistant.use']);
    expect(checkpoints.compareDecision('ai.assistant_tools', true, request, ['ai.assistant.use'])).toBe(true);
    expect(checkpoints.compareDecision('ai.assistant_tools', true, {}, ['ai.assistant.use'])).toBe(true);
    expect(await count('ai.assistant_tools', 'match')).toBe(1);
    expect(await count('ai.assistant_tools', 'would_deny')).toBe(1);
  });

  it('treats a missing stamp as unavailable while the snapshot is cold', async () => {
    const checkpoints = build(null);
    expect(
      checkpoints.compareDecision('fulfillment.force_dispatch_decision', true, {}, ['fulfillment.dispatch.force']),
    ).toBe(true);
    expect(await count('fulfillment.force_dispatch_decision', 'unavailable')).toBe(1);
  });

  it('logs the same mismatch once per window and sums it in the summary', () => {
    const checkpoints = build({ logistics_worker: [] });
    for (let i = 0; i < 3; i += 1) {
      checkpoints.compare('fulfillment.work_supervise', true, { roles: ['logistics_worker'] }, [
        'fulfillment.work.supervise',
      ]);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    checkpoints.flush();
    expect(JSON.parse(log.mock.calls.at(-1)[0])).toMatchObject({
      event: 'authz_checkpoint_summary',
      service: 'core',
      evaluated: 3,
      match: 0,
      wouldDeny: 3,
      wouldAllow: 0,
      unavailable: 0,
      mismatches: [
        { checkpoint: 'fulfillment.work_supervise', subject: ['logistics_worker'], outcome: 'would_deny', count: 3 },
      ],
    });
  });

  it('names a system principal in the log instead of roles', () => {
    const checkpoints = build({});
    checkpoints.compare('fulfillment.planning_scope', false, systemPrincipal('core.fulfillment-system'), [
      'fulfillment.shipment.reopen',
    ]);
    expect(JSON.parse(warn.mock.calls[0][0]).subject).toBe('system:core.fulfillment-system');
  });

  it('stays quiet in a window without evaluations', () => {
    build({}).flush();
    expect(log).not.toHaveBeenCalled();
  });
});
