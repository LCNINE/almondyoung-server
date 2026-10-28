import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import { recordPermissionDecisions } from './permission-decision';
import { systemPrincipal } from './system-principal';
import { checkpointEvaluations, createCheckpointsForTesting } from '../testing/checkpoints';

describe('PermissionCheckpoints', () => {
  const supervise = ['fulfillment.work.supervise'] as const;
  const held = { logistics_manager: ['fulfillment.work.supervise'], logistics_worker: [] };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    register.resetMetrics();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const neverDiverged = async (point: string) => {
    expect(await checkpointEvaluations(point, 'would_deny')).toBe(0);
    expect(await checkpointEvaluations(point, 'would_allow')).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  };

  it('check allows a held permission and denies a missing one', async () => {
    const checkpoints = createCheckpointsForTesting(held);
    expect(checkpoints.check('fulfillment.work_supervise', { roles: ['logistics_manager'] }, supervise)).toBe(true);
    expect(checkpoints.check('fulfillment.work_supervise', { roles: ['logistics_worker'] }, supervise)).toBe(false);
    expect(await checkpointEvaluations('fulfillment.work_supervise', 'match')).toBe(2);
    await neverDiverged('fulfillment.work_supervise');
  });

  it('check denies when the snapshot is cold and counts it unavailable', async () => {
    const checkpoints = createCheckpointsForTesting(null);
    expect(checkpoints.check('fulfillment.work_supervise', { roles: ['admin'] }, supervise)).toBe(false);
    expect(await checkpointEvaluations('fulfillment.work_supervise', 'unavailable')).toBe(1);
    await neverDiverged('fulfillment.work_supervise');
  });

  it('check allows a system principal even when the snapshot is cold', async () => {
    const checkpoints = createCheckpointsForTesting(null);
    expect(checkpoints.check('fulfillment.work_supervise', systemPrincipal('x'), supervise)).toBe(true);
    expect(await checkpointEvaluations('fulfillment.work_supervise', 'match')).toBe(1);
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
    expect(await checkpointEvaluations('fulfillment.force_dispatch_decision', 'match')).toBe(2);
    await neverDiverged('fulfillment.force_dispatch_decision');
  });

  it('checkRoute denies when the snapshot is cold even if stamped', async () => {
    const checkpoints = createCheckpointsForTesting(null);
    const stamped = {};
    recordPermissionDecisions(stamped, ['fulfillment.work.supervise']);
    expect(checkpoints.checkRoute('fulfillment.force_dispatch_decision', stamped, supervise)).toBe(false);
    expect(await checkpointEvaluations('fulfillment.force_dispatch_decision', 'unavailable')).toBe(1);
    await neverDiverged('fulfillment.force_dispatch_decision');
  });

  it('stays quiet in a window without evaluations', () => {
    const log: jest.SpyInstance = jest.spyOn(Logger.prototype, 'log');
    createCheckpointsForTesting(held).flush();
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps the summary shape without mismatches', () => {
    const log: jest.SpyInstance = jest.spyOn(Logger.prototype, 'log');
    const checkpoints = createCheckpointsForTesting(held);
    checkpoints.check('fulfillment.work_supervise', { roles: ['logistics_worker'] }, supervise);
    checkpoints.flush();
    expect(JSON.parse(log.mock.calls.at(-1)[0])).toMatchObject({
      event: 'authz_checkpoint_summary',
      mode: 'enforce',
      evaluated: 1,
      match: 1,
      wouldDeny: 0,
      wouldAllow: 0,
      unavailable: 0,
      mismatches: [],
    });
  });
});
