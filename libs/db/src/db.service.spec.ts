import { DbService } from './db.service';

describe('DbService.run', () => {
  function makeService(transaction: jest.Mock) {
    // Bypass the constructor (which opens a postgres client) — unit test the runner only.
    const service = Object.create(DbService.prototype) as DbService;
    (service as unknown as { _db: { transaction: jest.Mock } })._db = { transaction };
    return service;
  }

  it('runs fn with the provided tx and does NOT open a new transaction', async () => {
    const transaction = jest.fn();
    const service = makeService(transaction);
    const fn = jest.fn(async (tx: string) => `ran:${tx}`);

    const result = await service.run(fn as never, 'EXISTING_TX' as never);

    expect(result).toBe('ran:EXISTING_TX');
    expect(fn).toHaveBeenCalledWith('EXISTING_TX');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('opens a new transaction when no tx is provided', async () => {
    const transaction = jest.fn(async (fn: (tx: string) => Promise<unknown>) => fn('NEW_TX'));
    const service = makeService(transaction);
    const fn = jest.fn(async (tx: string) => `ran:${tx}`);

    const result = await service.run(fn as never);

    expect(result).toBe('ran:NEW_TX');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('NEW_TX');
  });
});
