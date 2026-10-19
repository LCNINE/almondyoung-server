import { ForwardWorkItemCommand, runForwardWorkItemCommand, WorkItemCommandDeps } from './work-item-command';
import { assertActiveBatchSession, lockAndAssertPickerClaim } from './allocation/allocation.queries';

jest.mock('./allocation/allocation.queries', () => ({
  lockAndAssertPickerClaim: jest.fn(),
  assertActiveBatchSession: jest.fn(),
}));

describe('runForwardWorkItemCommand', () => {
  const calls: string[] = [];
  const fakeTrx = { execute: jest.fn() };
  const execute = jest.fn();
  const assertV2MutationAllowed = jest.fn();
  const assertCurrent = jest.fn();

  const deps = {
    commands: { execute },
    workflowGate: { assertV2MutationAllowed },
    labels: { assertCurrent },
  } as unknown as WorkItemCommandDeps;

  const command: ForwardWorkItemCommand = {
    strategy: 'discrete',
    commandType: 'picking.x.y',
    canonicalRequest: { a: 1 },
    target: {
      batchId: 'b1',
      sessionId: 's1',
      workItemId: 'w1',
      shipmentId: 'sh1',
      actor: { id: 'u1' } as ForwardWorkItemCommand['target']['actor'],
      expectedLeaseVersion: 3,
      idempotencyKey: ' k1 ',
    },
  };

  beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
    assertV2MutationAllowed.mockImplementation((name: string) => calls.push(`workflowGate:${name}`));
    execute.mockImplementation(async (_input, handler) => {
      calls.push('execute');
      return (await handler(fakeTrx, 'cmd-1', 'hash')).response;
    });
    fakeTrx.execute.mockImplementation(async () => calls.push('lock'));
    (lockAndAssertPickerClaim as jest.Mock).mockImplementation(async () => calls.push('claim'));
    assertCurrent.mockImplementation(async () => calls.push('label'));
    (assertActiveBatchSession as jest.Mock).mockImplementation(async () => calls.push('session'));
  });

  const body = async () => {
    calls.push('body');
    return { response: 'ok', resourceType: 'r', resourceId: 'i' };
  };

  it('runs gate → execute → locksBefore → claim → label gate → session → body in that order', async () => {
    const result = await runForwardWorkItemCommand(deps, { ...command, locksBefore: ['k'] }, body);
    expect(result).toBe('ok');
    expect(calls).toEqual(['workflowGate:picking.x.y', 'execute', 'lock', 'claim', 'label', 'session', 'body']);
  });

  it('passes commandType, trimmed-as-given idempotencyKey and canonicalRequest to commands.execute unchanged', async () => {
    await runForwardWorkItemCommand(deps, command, body);
    expect(execute.mock.calls[0][0]).toEqual({
      commandType: 'picking.x.y',
      idempotencyKey: ' k1 ',
      canonicalRequest: { a: 1 },
    });
  });

  it('calls claim, session and label guards with the target fields', async () => {
    const tx = {} as never;
    await runForwardWorkItemCommand(deps, command, body, tx);
    expect(execute.mock.calls[0][2]).toBe(tx);
    expect(lockAndAssertPickerClaim).toHaveBeenCalledWith(fakeTrx, 'w1', 'b1', 'sh1', 'u1', 3);
    expect(assertActiveBatchSession).toHaveBeenCalledWith(fakeTrx, 's1', 'b1', 'discrete');
    expect(assertCurrent).toHaveBeenCalledWith('w1', fakeTrx);
  });

  it('takes no advisory lock when locksBefore is omitted', async () => {
    await runForwardWorkItemCommand(deps, command, body);
    expect(fakeTrx.execute).not.toHaveBeenCalled();
  });

  it('takes one advisory lock per key', async () => {
    await runForwardWorkItemCommand(deps, { ...command, locksBefore: ['a', 'b'] }, body);
    expect(fakeTrx.execute).toHaveBeenCalledTimes(2);
  });
});
