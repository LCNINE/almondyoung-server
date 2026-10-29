import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import { PermissionCheckpoints } from './permission-checkpoints';
import { recordPermissionDecisions } from './permission-decision';
import { PermissionDecider } from './permission-decider';
import { systemPrincipal } from './system-principal';
import { checkpointEvaluations, createCheckpointsForTesting } from '../testing/checkpoints';

describe('PermissionCheckpoints', () => {
  const supervise = ['fulfillment.work.supervise'] as const;
  const held = { logistics_manager: ['fulfillment.work.supervise'], logistics_worker: [] };

  beforeEach(() => {
    register.resetMetrics();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('check allows a held permission and denies a missing one', async () => {
    const checkpoints = createCheckpointsForTesting(held);
    expect(checkpoints.check('fulfillment.work_supervise', { roles: ['logistics_manager'] }, supervise)).toBe(true);
    expect(checkpoints.check('fulfillment.work_supervise', { roles: ['logistics_worker'] }, supervise)).toBe(false);
    expect(await checkpointEvaluations('fulfillment.work_supervise', 'allow')).toBe(1);
    expect(await checkpointEvaluations('fulfillment.work_supervise', 'deny')).toBe(1);
  });

  it('check denies when the snapshot is cold and counts it unavailable', async () => {
    const checkpoints = createCheckpointsForTesting(null);
    expect(checkpoints.check('fulfillment.work_supervise', { roles: ['admin'] }, supervise)).toBe(false);
    expect(await checkpointEvaluations('fulfillment.work_supervise', 'unavailable')).toBe(1);
  });

  it('check allows a system principal even when the snapshot is cold', async () => {
    const checkpoints = createCheckpointsForTesting(null);
    expect(checkpoints.check('fulfillment.work_supervise', systemPrincipal('x'), supervise)).toBe(true);
    expect(await checkpointEvaluations('fulfillment.work_supervise', 'allow')).toBe(1);
  });

  it('check denies a missing subject', () => {
    expect(createCheckpointsForTesting(held).check('fulfillment.work_supervise', undefined, supervise)).toBe(false);
  });

  it('checkRoute allows a stamped request and denies an unstamped one', async () => {
    const checkpoints = createCheckpointsForTesting(held);
    const stamped = {};
    recordPermissionDecisions(stamped, ['fulfillment.work.supervise']);
    expect(checkpoints.checkRoute('fulfillment.force_dispatch_decision', stamped, supervise)).toBe(true);
    expect(checkpoints.checkRoute('fulfillment.force_dispatch_decision', {}, supervise)).toBe(false);
    expect(await checkpointEvaluations('fulfillment.force_dispatch_decision', 'allow')).toBe(1);
    expect(await checkpointEvaluations('fulfillment.force_dispatch_decision', 'deny')).toBe(1);
  });

  it('checkRoute denies when the snapshot is cold even if stamped', async () => {
    const checkpoints = createCheckpointsForTesting(null);
    const stamped = {};
    recordPermissionDecisions(stamped, ['fulfillment.work.supervise']);
    expect(checkpoints.checkRoute('fulfillment.force_dispatch_decision', stamped, supervise)).toBe(false);
    expect(await checkpointEvaluations('fulfillment.force_dispatch_decision', 'unavailable')).toBe(1);
  });

  it('records each decision in the shared decision log with the subject label', () => {
    const record = jest.fn();
    const cache = { status: () => ({ state: 'ready' as const, version: 'v', ageMs: 0, consecutiveFailures: 0 }) };
    const decider = new PermissionDecider({ permissionsFor: () => new Set<string>() });
    const checkpoints = new PermissionCheckpoints(decider, cache, { record });

    checkpoints.check('fulfillment.work_supervise', systemPrincipal('core.fulfillment-system'), supervise);
    checkpoints.check('fulfillment.work_supervise', { roles: ['logistics_worker'] }, supervise);

    expect(record).toHaveBeenNthCalledWith(
      1,
      'checkpoint',
      'fulfillment.work_supervise',
      { allowed: true },
      supervise,
      ['system:core.fulfillment-system'],
    );
    expect(record).toHaveBeenNthCalledWith(
      2,
      'checkpoint',
      'fulfillment.work_supervise',
      { allowed: false, reason: 'missing_permission' },
      supervise,
      ['logistics_worker'],
    );
  });
});
