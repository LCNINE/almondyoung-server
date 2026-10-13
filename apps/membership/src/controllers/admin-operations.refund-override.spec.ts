import { checkpointEvaluations, createCheckpointsForTesting } from '@app/authorization';
import { register } from 'prom-client';
import { AdminOperationsController } from './admin-operations.controller';

describe('AdminOperationsController refund override permission comparison', () => {
  const forceCancelSubscription = jest.fn(async () => ({ refundAmount: 0, refundStatus: 'NONE' }));
  const hasScope = jest.fn(async () => false);

  function controller(): AdminOperationsController {
    return new AdminOperationsController(
      {} as never,
      {} as never,
      { forceCancelSubscription } as never,
      {} as never,
      {} as never,
      { hasScope } as never,
      {} as never,
      {} as never,
      createCheckpointsForTesting({ master: ['membership.billing.refund_override'], admin: [] }),
    );
  }

  beforeEach(() => {
    register.resetMetrics();
    jest.clearAllMocks();
  });

  it('keeps the legacy override decision and compares it with the permission', async () => {
    const operations = controller();
    const dto = { reason: 'cs', refundType: 'NONE' as const };
    await operations.forceCancelSubscription('admin-1', ['admin'], 'contract-1', dto);
    await operations.forceCancelSubscription('master-1', ['master'], 'contract-1', dto);
    const overrides = forceCancelSubscription.mock.calls.map((call: unknown[]) => call[7]);
    expect(overrides).toEqual([false, true]);
    expect(await checkpointEvaluations('membership.refund_override', 'match')).toBe(2);
  });
});
