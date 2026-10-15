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

describe('DbService 종료', () => {
  function makeService(end: jest.Mock) {
    const service = Object.create(DbService.prototype) as DbService;
    (service as unknown as { _client: { end: jest.Mock } })._client = { end };
    return service;
  }

  // 풀은 onApplicationShutdown 에서만 닫는다. 컨슈머·HTTP 는 destroy 훅 뒤 dispose() 에서 멈추므로
  // onModuleDestroy 에서 풀을 닫으면 아직 처리 중인 컨슈머 메시지가 "connection ended" 로 실패한다 (#1073).
  it('onModuleDestroy 로는 풀을 닫지 않는다', async () => {
    const end = jest.fn(async () => undefined);
    const service = makeService(end);

    const hook = (service as unknown as { onModuleDestroy?: () => Promise<void> }).onModuleDestroy;
    await hook?.call(service);

    expect(end).not.toHaveBeenCalled();
  });

  it('onApplicationShutdown 에서 풀을 닫는다', async () => {
    const end = jest.fn(async () => undefined);
    const service = makeService(end);

    await service.onApplicationShutdown();

    expect(end).toHaveBeenCalledTimes(1);
  });
});
