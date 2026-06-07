import { OutboxDispatcher } from './outbox-dispatcher.service';

function makeSelectReturning(rows: unknown[]) {
  return {
    from: jest.fn(() => ({
      where: jest.fn(() => ({
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({
            for: jest.fn().mockResolvedValue(rows),
          })),
        })),
      })),
    })),
  };
}

describe('OutboxDispatcher stale processing recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-08T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requeues stale PROCESSING events before acquiring new pending work', async () => {
    const requeuedRows = [{ id: 1 }];
    const returning = jest.fn().mockResolvedValue(requeuedRows);
    const rootUpdateWhere = jest.fn(() => ({ returning }));
    const rootUpdateSet = jest.fn(() => ({ where: rootUpdateWhere }));
    const rootUpdate = jest.fn(() => ({ set: rootUpdateSet }));

    const tx = {
      select: jest.fn(() => makeSelectReturning([])),
    };
    const transaction = jest.fn(async (callback: (tx: typeof tx) => Promise<unknown>) => callback(tx));

    const dispatcher = new OutboxDispatcher({ db: { update: rootUpdate, transaction } } as any, new Map(), {
      processingTimeoutMs: 60_000,
    });

    await dispatcher.dispatchPendingEvents();

    expect(rootUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PENDING',
        processingStartedAt: null,
        errorMessage: 'Requeued after 60s processing timeout',
      }),
    );
    expect(returning).toHaveBeenCalledWith({ id: expect.anything() });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
