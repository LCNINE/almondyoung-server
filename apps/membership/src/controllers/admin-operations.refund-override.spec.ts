import { createCheckpointsForTesting } from '@app/authorization';
import { AdminOperationsController } from './admin-operations.controller';

describe('AdminOperationsController refund override permission', () => {
  const forceCancelSubscription = jest
    .fn<Promise<{ refundAmount: number; refundStatus: string }>, unknown[]>()
    .mockResolvedValue({ refundAmount: 0, refundStatus: 'NONE' });
  const dto = { reason: 'cs', refundType: 'NONE' as const };

  function controller(byRole?: Readonly<Record<string, readonly string[]>> | null): AdminOperationsController {
    return new AdminOperationsController(
      {} as never,
      {} as never,
      { forceCancelSubscription } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      createCheckpointsForTesting(byRole),
    );
  }

  async function overrideFor(operations: AdminOperationsController, roles: string[]): Promise<unknown> {
    await operations.forceCancelSubscription('actor-1', roles, 'contract-1', dto);
    return forceCancelSubscription.mock.calls.at(-1)?.[7];
  }

  beforeEach(() => jest.clearAllMocks());

  it('passes the override only to a role that holds the override permission', async () => {
    const operations = controller({ cs_lead: ['membership.billing.refund_override'], admin: [] });
    expect(await overrideFor(operations, ['admin'])).toBe(false);
    expect(await overrideFor(operations, ['cs_lead'])).toBe(true);
  });

  it('does not grant the override by an old role name alone', async () => {
    const operations = controller({ master: [] });
    expect(await overrideFor(operations, ['master'])).toBe(false);
  });

  it('follows the real first-grant map: master overrides, admin does not', async () => {
    const operations = controller();
    expect(await overrideFor(operations, ['admin'])).toBe(false);
    expect(await overrideFor(operations, ['master'])).toBe(true);
  });

  it('withholds the override before the permission copy arrives', async () => {
    const operations = controller(null);
    expect(await overrideFor(operations, ['master'])).toBe(false);
  });
});
