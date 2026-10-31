import { DbRouter, DbService } from './db.service';

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

describe('DbService.forEachDatabase', () => {
  // 풀은 첫 쿼리 때 접속하므로 만들기만 해서는 연결이 열리지 않는다 — 실제 생성자로 만든다.
  const URL = 'postgres://u:p@127.0.0.1:1/unused';

  function routerOver(keys: string[]) {
    let current: string | undefined;
    const router: DbRouter = {
      databases: new Map(keys.map((k) => [k, `db_${k}`])),
      current: () => {
        if (!current) throw new Error('맥락 없음');
        return current;
      },
      within: async (key, fn) => {
        const previous = current;
        current = key;
        try {
          return await fn();
        } finally {
          current = previous;
        }
      },
    };
    return router;
  }

  it('라우터가 없으면 맥락 없이 한 번 돈다', async () => {
    const service = new DbService({ connectionString: URL }, {});
    const seen: (string | undefined)[] = [];

    const runs = await service.forEachDatabase(async (key) => {
      seen.push(key);
      return 'done';
    });

    expect(seen).toEqual([undefined]);
    expect(runs).toEqual([{ key: undefined, ok: true, value: 'done' }]);
    await service.onApplicationShutdown();
  });

  it('라우터가 있으면 DB 마다 그 키의 맥락에서 돈다', async () => {
    const router = routerOver(['1', '2']);
    const service = new DbService({ connectionString: URL }, {}, router);
    const seen: string[] = [];

    await service.forEachDatabase(async (key) => {
      seen.push(`${key}:${router.current()}`);
    });

    expect(seen.sort()).toEqual(['1:1', '2:2']);
    await service.onApplicationShutdown();
  });

  it('한 DB 의 실패는 그 DB 에 갇힌다 — 다른 DB 는 돌고, 실패는 결과로 돌아온다(던지지 않는다)', async () => {
    const service = new DbService({ connectionString: URL }, {}, routerOver(['1', '2']));
    const boom = new Error('DB 2 깨짐');

    const runs = await service.forEachDatabase(async (key) => {
      if (key === '2') throw boom;
      return `ok-${key}`;
    });

    expect(runs).toEqual([
      { key: '1', ok: true, value: 'ok-1' },
      { key: '2', ok: false, error: boom },
    ]);
    await service.onApplicationShutdown();
  });

  // 크론 본문 다수가 인스턴스의 «도는 중» 깃발로 겹침을 막는다. DB 를 동시에 돌리면 둘째 테넌트가 그 깃발을 보고 건너뛴다.
  it('DB 를 차례로 돈다 — 다음 DB 는 앞 DB 의 작업이 끝난 뒤에 시작한다', async () => {
    const service = new DbService({ connectionString: URL }, {}, routerOver(['1', '2']));
    let running = false;
    const ran: string[] = [];

    await service.forEachDatabase(async (key) => {
      if (running) return;
      running = true;
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        ran.push(String(key));
      } finally {
        running = false;
      }
    });

    expect(ran).toEqual(['1', '2']);
    await service.onApplicationShutdown();
  });
});

