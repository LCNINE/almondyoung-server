import { InboxWorkerService, INBOX_HANDLER_TIMEOUT_MS } from './inbox-worker.service';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';
import { PgDialect } from 'drizzle-orm/pg-core';
import { SlowRetryInboxError } from './slow-retry.error';

function collectValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || value === undefined) return [];
  if (value instanceof Date) return [value.toISOString()];
  if (typeof value !== 'object') return [value];
  if (seen.has(value)) return [];

  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectValues(item, seen));
  }

  return Object.values(value as Record<string, unknown>).flatMap((item) => collectValues(item, seen));
}

/**
 * drizzle 조건식을 SQL 문자열로 렌더한다.
 * supersede 비교는 전부 SQL 안에서 일어나므로(바인딩되는 값은 eventId 뿐),
 * "발생시각 기준으로 정렬한다" 는 요구사항은 렌더된 SQL 로만 단정할 수 있다.
 */
function renderSql(condition: unknown): string {
  return new PgDialect().sqlToQuery(condition as never).sql;
}

function createDbMock(newerEvents: unknown[] | ((condition: unknown) => unknown[]) = []) {
  const updates: any[] = [];
  const execute = jest.fn().mockResolvedValue([]);
  const where = jest.fn((condition: unknown) => ({
    limit: jest.fn().mockResolvedValue(typeof newerEvents === 'function' ? newerEvents(condition) : newerEvents),
  }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const update = jest.fn(() => ({
    set: jest.fn((values: any) => {
      updates.push(values);
      // handleFailure 의 CAS 가드(WHERE id = ? AND attempts = ?)가 `.returning()` 으로 적용 여부를
      // 확인하므로 여기서도 지원한다. 이 mock 은 항상 "적용됨" 을 흉내낸다 — 스테일 무시 자체를
      // 검증하는 시나리오는 이 공용 mock 을 쓰지 않고 별도로 상태를 추적하는 mock 을 쓴다
      // (아래 'handleFailure race' describe 블록 참고).
      return {
        where: jest.fn(() => ({
          returning: jest.fn().mockResolvedValue([{ id: 'stub-applied' }]),
        })),
      };
    }),
  }));

  return {
    db: { execute, select, update },
    updates,
    execute,
  };
}

describe('InboxWorkerService ProductSellableQuantityChanged handling', () => {
  const payload: ProductSellableQuantityChangedPayload = {
    variantId: 'pim-var-1',
    masterId: 'master-1',
    versionId: 'version-1',
    matchingId: 'matching-1',
    sellableQuantity: 7,
    stockBoundQuantity: 7,
    isSellable: true,
    reason: 'SELLABLE',
    calculatedAt: '2026-05-27T00:00:00.000Z',
  };

  function createService(params?: {
    syncError?: Error;
    maxRetries?: number;
    newerEvents?: unknown[] | ((condition: unknown) => unknown[]);
    config?: Record<string, string | number | undefined>;
    // env is an alias for config — same configService.get seam, named to match
    // how operators actually set these (process env vars), used by the handler
    // timeout tests below.
    env?: Record<string, string | number | undefined>;
    syncPromise?: Promise<void>;
  }) {
    const dbMock = createDbMock(params?.newerEvents);
    const syncService = {
      handleActiveVersionChanged: jest.fn().mockResolvedValue(undefined),
      handleProductMasterDeleted: jest.fn().mockResolvedValue(undefined),
      handleProductSellableQuantityChanged: jest.fn(() => {
        if (params?.syncError) return Promise.reject(params.syncError);
        if (params?.syncPromise) return params.syncPromise;
        return Promise.resolve();
      }),
    };
    const configValues = { ...params?.config, ...params?.env };
    const configService = {
      get: jest.fn((key: string) => {
        if (Object.prototype.hasOwnProperty.call(configValues, key)) return configValues[key];
        if (key === 'INBOX_MAX_RETRIES') return params?.maxRetries ?? 5;
        return undefined;
      }),
    };

    const service = new InboxWorkerService(
      { db: dbMock.db } as any,
      syncService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      configService as any,
      { runWithChain: jest.fn((_chainId: string, _eventId: string, fn: () => Promise<void>) => fn()) } as any,
    );

    return { service, dbMock, syncService };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-27T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks a successful sellable quantity sync as published', async () => {
    const { service, dbMock, syncService } = createService();
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 0,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleProductSellableQuantityChanged).toHaveBeenCalledWith(payload);
    expect(dbMock.updates).toEqual([{ status: 'published', publishedAt: new Date('2026-05-27T00:00:00.000Z') }]);
  });

  it('keeps a Medusa API failure pending with exponential backoff so it can be retried', async () => {
    const { service, dbMock, syncService } = createService({
      syncError: new Error('Medusa API down'),
    });
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 1,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleProductSellableQuantityChanged).toHaveBeenCalledWith(payload);
    expect(dbMock.updates[0]).toEqual({
      status: 'pending',
      attempts: 1,
      errorMessage: 'Medusa API down',
      nextAttemptAt: new Date('2026-05-27T00:00:02.000Z'),
    });
  });

  it('does not increment attempts again when a claimed event fails', async () => {
    const { service, dbMock, syncService } = createService({
      syncError: new Error('Medusa API down'),
      maxRetries: 5,
    });
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 2,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleProductSellableQuantityChanged).toHaveBeenCalledWith(payload);
    expect(dbMock.updates[0]).toEqual({
      status: 'pending',
      attempts: 2,
      errorMessage: 'Medusa API down',
      nextAttemptAt: new Date('2026-05-27T00:00:04.000Z'),
    });
  });

  it('marks a claimed event failed when attempts already reached max retries', async () => {
    const { service, dbMock } = createService({
      syncError: new Error('Medusa API down'),
      maxRetries: 2,
    });
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 2,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(dbMock.updates[0]).toEqual({
      status: 'failed',
      attempts: 2,
      errorMessage: 'Medusa API down',
      failedAt: new Date('2026-05-27T00:00:00.000Z'),
    });
  });

  it('keeps unsupported event types retryable instead of publishing them', async () => {
    const { service, dbMock } = createService();
    const event = {
      id: 'inbox_unknown',
      eventType: 'SomeUnexpectedEvent',
      aggregateId: 'aggregate-1',
      payload: {},
      attempts: 1,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(dbMock.updates[0]).toEqual({
      status: 'pending',
      attempts: 1,
      errorMessage: 'Unsupported inbox event type: SomeUnexpectedEvent',
      nextAttemptAt: new Date('2026-05-27T00:00:02.000Z'),
    });
  });

  it('coerces string worker env config to numbers', () => {
    const { service } = createService({
      config: {
        INBOX_MAX_CONCURRENT_HANDLERS: '3',
        INBOX_HANDLER_START_INTERVAL_MS: '10000',
        INBOX_PROCESSING_LEASE_MS: '900000',
        INBOX_SHUTDOWN_DRAIN_MS: '25000',
        INBOX_MAX_RETRIES: '7',
      },
    });

    expect((service as any).maxConcurrentHandlers).toBe(3);
    expect((service as any).handlerStartIntervalMs).toBe(10000);
    expect((service as any).processingLeaseMs).toBe(900000);
    expect((service as any).shutdownDrainMs).toBe(25000);
    expect((service as any).maxRetries).toBe(7);
  });

  it('핸들러 타임아웃 기본값은 60초다', () => {
    expect(INBOX_HANDLER_TIMEOUT_MS).toBe(60_000);
  });

  it('핸들러가 타임아웃을 넘기면 실패 처리로 넘겨 슬롯을 놓아준다', async () => {
    jest.useFakeTimers();
    try {
      const { service } = createService({ env: { INBOX_HANDLER_TIMEOUT_MS: '1000' } });
      // 절대 resolve 되지 않는 핸들러
      jest.spyOn(service as any, 'doProcessInboxEvent').mockImplementation(() => new Promise(() => {}));
      const handleFailure = jest.spyOn(service as any, 'handleFailure').mockResolvedValue(undefined);

      const pending = (service as any).processInboxEvent({
        id: 'stuck-1',
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateId: 'master-1',
        payload: {},
        attempts: 1,
        metadata: {},
      });

      await jest.advanceTimersByTimeAsync(1100);
      await pending;

      expect(handleFailure).toHaveBeenCalledTimes(1);
      expect(String(handleFailure.mock.calls[0][1])).toMatch(/timed out/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it('starts at most one handler per tick and skips claims while at local concurrency limit', async () => {
    const neverResolves = new Promise<void>(() => undefined);
    const { service, dbMock } = createService({
      config: {
        INBOX_MAX_CONCURRENT_HANDLERS: '1',
        INBOX_HANDLER_START_INTERVAL_MS: '10000',
      },
      syncPromise: neverResolves,
    });
    dbMock.execute.mockResolvedValueOnce([
      {
        id: '01930000-0000-7000-8000-000000000001',
        eventType: 'ProductSellableQuantityChanged',
        aggregateType: 'ProductVariant',
        aggregateId: 'pim-var-1',
        partitionKey: 'pim-var-1',
        payload,
        metadata: { messageId: 'msg-1', chainId: 'chain-1' },
        status: 'processing',
        attempts: 1,
        nextAttemptAt: new Date('2026-05-27T00:15:00.000Z'),
        errorMessage: null,
        eventOccurredAt: null,
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
        publishedAt: null,
        failedAt: null,
      },
    ]);

    (service as any).isRunning = true;
    await (service as any).tryStartNextHandler();
    await (service as any).tryStartNextHandler();

    expect(dbMock.execute).toHaveBeenCalledTimes(1);
    expect((service as any).inFlightHandlers).toBe(1);
  });

  it('renders the atomic claim query with an IN list instead of an invalid ANY row cast', async () => {
    const { service, dbMock } = createService();

    await (service as any).claimNextInboxEvent();

    const claimSql = new PgDialect().sqlToQuery(dbMock.execute.mock.calls[0][0]);
    expect(claimSql.sql).toContain('WHERE event_type IN (');
    expect(claimSql.sql).not.toContain('ANY((');
    expect(claimSql.sql).not.toContain('::text[]');
    expect(claimSql.params[0]).toBe(900000);
    expect(claimSql.params).toContain('ProductMasterActiveVersionChanged');
    expect(claimSql.params).toContain('CoreOrderCancelled');
  });

  it('renders the demotion order with a COALESCE guard so unmarked rows keep the priority lane', async () => {
    const { service, dbMock } = createService();

    await (service as any).claimNextInboxEvent();

    const claimSql = new PgDialect().sqlToQuery(dbMock.execute.mock.calls[0][0]);
    // COALESCE 가 빠지면 마커 없는 행이 `false OR NULL` = NULL 이 되고,
    // NULL 은 ASC 정렬에서 맨 뒤로 가 우선 레인이 통째로 뒤집힌다.
    expect(claimSql.sql).toContain(`COALESCE(metadata->>'origin', '')`);
    expect(claimSql.params).toContain('bulk_import');
    // 괄호는 정확성 요건은 아니다(OR 가 쉼표보다 먼저 묶여 파싱은 같다) — 렌더링된
    // 모양이 ORDER BY 항 구분 쉼표와 안 섞여 보이는 가독성 형태를 유지하는지 고정한다.
    expect(claimSql.sql).toMatch(/ORDER BY \(/);
  });

  it('does not publish an older active-version retry after a newer product delete is present', async () => {
    const { service, dbMock, syncService } = createService({
      newerEvents: (condition) =>
        collectValues(condition).includes('ProductMasterDeleted') ? [{ id: 'delete-event-1' }] : [],
    });
    const event = {
      id: 'active-event-1',
      eventType: 'ProductMasterActiveVersionChanged',
      aggregateId: 'master-1',
      payload: {
        masterId: 'master-1',
        versionId: 'version-1',
        changeReason: 'published',
        changedAt: '2026-05-26T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      },
      attempts: 1,
      createdAt: new Date('2026-05-26T00:00:00.000Z'),
      metadata: { messageId: 'active-msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleActiveVersionChanged).not.toHaveBeenCalled();
    expect(dbMock.updates).toEqual([
      {
        status: 'published',
        publishedAt: new Date('2026-05-27T00:00:00.000Z'),
        errorMessage: 'Superseded by newer event (aggregateId: master-1)',
      },
    ]);
  });

  it('treats a failed newer lifecycle event as superseding older lifecycle retries', async () => {
    const { service, dbMock, syncService } = createService({
      newerEvents: (condition) => (collectValues(condition).includes('failed') ? [{ id: 'delete-event-1' }] : []),
    });
    const event = {
      id: 'active-event-1',
      eventType: 'ProductMasterActiveVersionChanged',
      aggregateId: 'master-1',
      payload: {
        masterId: 'master-1',
        versionId: 'version-1',
        changeReason: 'published',
        changedAt: '2026-05-26T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      },
      attempts: 1,
      eventOccurredAt: new Date('2026-05-26T00:00:00.000Z'),
      createdAt: new Date('2026-05-26T00:00:00.000Z'),
      metadata: { messageId: 'active-msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleActiveVersionChanged).not.toHaveBeenCalled();
    expect(dbMock.updates).toEqual([
      {
        status: 'published',
        publishedAt: new Date('2026-05-27T00:00:00.000Z'),
        errorMessage: 'Superseded by newer event (aggregateId: master-1)',
      },
    ]);
  });

  // ⚠️ 단위테스트의 한계: DB 를 mock 하므로 비교의 실제 결과는 검증할 수 없고
  // "어떤 컬럼으로 비교하는가" 까지만 단정한다. 발생시각 기준 supersede 가
  // 실제로 동작하는지는 실제 DB 통합테스트가 필요하다 (#550).
  it('supersede 비교는 삽입시각(created_at)이 아니라 발생시각(event_occurred_at)을 기준으로 한다', async () => {
    let captured = '';
    const { service, dbMock, syncService } = createService({
      newerEvents: (condition) => {
        captured = renderSql(condition);
        return [{ id: 'delete-event-1' }];
      },
    });
    const event = {
      id: 'active-event-1',
      eventType: 'ProductMasterActiveVersionChanged',
      aggregateId: 'master-1',
      payload: {
        masterId: 'master-1',
        versionId: 'version-1',
        changeReason: 'published',
        changedAt: '2026-05-26T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      },
      attempts: 1,
      eventOccurredAt: new Date('2026-05-26T00:00:00.000Z'),
      createdAt: new Date('2026-05-28T00:00:00.000Z'),
      metadata: { messageId: 'active-msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    // 양변 모두 coalesce(event_occurred_at, created_at) 여야 한다.
    // created_at 단독 비교로 회귀하면 이 단정이 깨진다.
    expect(captured).toContain('event_occurred_at');
    expect(captured.match(/coalesce/gi)?.length).toBeGreaterThanOrEqual(2);
    expect(captured).toMatch(/from\s+inbox_events\s+e\s+where\s+e\.\s*id/i);

    // #550 회귀 가드: 위 세 단정은 "어떤 컬럼이 등장하는가/coalesce 가 몇 번 쓰였는가/서브쿼리
    // 형태가 맞는가" 만 확인할 뿐, coalesce 의 인자 "순서"는 강제하지 않는다. 그래서
    // coalesce(created_at, event_occurred_at) 로 좌우를 바꿔치기해도(= event_occurred_at 이
    // notNull 이 아닌 창을 가려버리는 회귀) 셋 다 그대로 통과한다. 좌변(컬럼 비교식)과
    // 우변(상관 서브쿼리) 양쪽 모두에서 event_occurred_at 이 created_at 보다 먼저 오는지
    // 별도로 단정해야 실제로 가드가 된다.
    const subqueryStart = captured.search(/\(select/i);
    expect(subqueryStart).toBeGreaterThan(-1);
    const columnComparison = captured.slice(0, subqueryStart);
    const correlatedSubquery = captured.slice(subqueryStart);
    const argOrderPattern = /coalesce\([^)]*event_occurred_at[^)]*,[^)]*created_at[^)]*\)/i;
    expect(columnComparison).toMatch(argOrderPattern);
    expect(correlatedSubquery).toMatch(argOrderPattern);

    expect(syncService.handleActiveVersionChanged).not.toHaveBeenCalled();
    expect(dbMock.updates).toEqual([
      {
        status: 'published',
        publishedAt: new Date('2026-05-27T00:00:00.000Z'),
        errorMessage: 'Superseded by newer event (aggregateId: master-1)',
      },
    ]);
  });
});

describe('InboxWorkerService handleFailure race with an abandoned timed-out handler', () => {
  /**
   * `inbox_events.attempts` 는 `claimNextInboxEvent` 가 매 (재)클레임마다 원자적으로 올리는 값이라,
   * 이 이벤트에 대한 "세대(generation) 번호" 처럼 동작한다. 이 mock 은 그 세대를 흉내낸다:
   * `.returning()` 이 실제로 행을 돌려주는지(=적용됨) 여부는 WHERE 조건에 걸린 attempts 값이
   * 지금 "행"의 attempts 와 같은지로 판정한다 — 프로덕션의 CAS 가드와 동일한 판정 기준이다.
   */
  function createGenerationAwareDbMock(initialAttempts: number) {
    let currentAttempts = initialAttempts;
    const appliedStatuses: string[] = [];

    const update = jest.fn(() => ({
      set: jest.fn((values: { attempts: number; status: string }) => ({
        where: jest.fn((condition: unknown) => ({
          returning: jest.fn(async () => {
            const matchesCurrentGeneration = collectValues(condition).includes(currentAttempts);
            if (!matchesCurrentGeneration) return [];

            currentAttempts = values.attempts;
            appliedStatuses.push(values.status);
            return [{ id: 'race-event-1' }];
          }),
        })),
      })),
    }));

    return {
      db: { update },
      appliedStatuses,
      advanceGeneration: (n: number) => {
        currentAttempts = n;
      },
      getCurrentAttempts: () => currentAttempts,
    };
  }

  it('does not let a stale handleFailure from an abandoned timed-out call clobber a row reclaimed and reprocessed since', async () => {
    jest.useFakeTimers();
    try {
      const dbMock = createGenerationAwareDbMock(1);
      const configService = {
        get: jest.fn((key: string) => (key === 'INBOX_HANDLER_TIMEOUT_MS' ? '1000' : undefined)),
      };
      const service = new (InboxWorkerService as any)({ db: dbMock.db }, {}, {}, {}, {}, {}, {}, configService, {
        runWithChain: jest.fn((_chainId: string, _eventId: string, fn: () => Promise<void>) => fn()),
      });

      // 클레임 시점 스냅샷 — attempts=1, DB 행의 현재 attempts(1)와 일치한다.
      const staleEvent = {
        id: 'race-event-1',
        eventType: 'UserEmailVerified',
        aggregateId: 'agg-1',
        payload: {},
        attempts: 1,
        metadata: {},
      };

      // 1) 핸들러가 hang → 아웃터 타임아웃이 첫 번째 handleFailure 를 부른다 (processInboxEvent 경유,
      //    실제 코드 경로). 아직 아무 재클레임도 없었으므로 이 갱신은 적용돼야 한다.
      jest.spyOn(service, 'doProcessInboxEvent').mockImplementation(() => new Promise(() => {}));
      const pending = service.processInboxEvent(staleEvent);
      await jest.advanceTimersByTimeAsync(1100);
      await pending;

      expect(dbMock.appliedStatuses).toEqual(['pending']);
      expect(dbMock.getCurrentAttempts()).toBe(1);

      // 2) 그 사이 이벤트가 재클레임되어(attempts → 2) 성공적으로 재처리됐다고 가정한다.
      dbMock.advanceGeneration(2);

      // 3) 방치됐던 원래 핸들러가 undici 기본 타임아웃 등으로 뒤늦게 자체 에러를 내고,
      //    doProcessInboxEvent 의 내부 catch 가 같은 스테일 스냅샷(attempts=1)으로
      //    handleFailure 를 "두 번째" 로 부른다.
      await service.handleFailure(staleEvent, 'stale: undici timeout after abandonment');

      // 재클레임 이후 상태를 덮어쓰지 않는다 — attempts 는 2에 머물고 새 상태 갱신도 없다.
      expect(dbMock.getCurrentAttempts()).toBe(2);
      expect(dbMock.appliedStatuses).toEqual(['pending']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('InboxWorkerService V1 Medusa compatibility projection', () => {
  it('uses the verified Medusa mapping instead of trusting an arbitrary payload channelOrderId', async () => {
    const queryResults = [[], [{ channelOrderId: 'order_medusa_verified' }]];
    const select = jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ limit: jest.fn(async () => queryResults.shift() ?? []) })),
      })),
    }));
    const updates: Array<Record<string, unknown>> = [];
    const update = jest.fn(() => ({
      set: jest.fn((values: Record<string, unknown>) => ({
        where: jest.fn(async () => {
          updates.push(values);
        }),
      })),
    }));
    const lockExecute = jest.fn().mockResolvedValue([]);
    const transaction = jest.fn(async (callback: (tx: { execute: typeof lockExecute }) => Promise<unknown>) =>
      callback({ execute: lockExecute }),
    );
    const medusaClient = { updateOrderShippingProjection: jest.fn().mockResolvedValue(undefined) };
    const service = new (InboxWorkerService as any)(
      { db: { select, update, transaction } },
      {},
      {},
      {},
      medusaClient,
      {},
      {},
      { get: jest.fn() },
      { runWithChain: jest.fn() },
    );

    await service.doProcessInboxEvent({
      id: 'inbox-v1-shipped',
      eventType: 'CoreFulfillmentShipped',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: {
        fulfillmentId: '22222222-2222-4222-8222-222222222222',
        orderId: '11111111-1111-4111-8111-111111111111',
        channelOrderId: 'naver-order-that-must-not-be-used',
        trackingInfo: { carrier: 'HANJIN', trackingNumber: 'TRACK-1' },
      },
      attempts: 1,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      metadata: {},
    });

    expect(medusaClient.updateOrderShippingProjection).toHaveBeenCalledWith(
      'order_medusa_verified',
      expect.objectContaining({ status: 'shipped' }),
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lockExecute).toHaveBeenCalledTimes(1);
    expect(updates).toContainEqual(expect.objectContaining({ status: 'published' }));
  });

  it('takes the shared PostgreSQL order lock before the V1 delivered metadata projection', async () => {
    const queryResults = [[], [{ channelOrderId: 'order_medusa_verified' }]];
    const select = jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ limit: jest.fn(async () => queryResults.shift() ?? []) })),
      })),
    }));
    const update = jest.fn(() => ({
      set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
    }));
    const callOrder: string[] = [];
    const transaction = jest.fn(async (callback: (tx: { execute: () => Promise<never[]> }) => Promise<unknown>) =>
      callback({
        execute: jest.fn(async () => {
          callOrder.push('lock');
          return [] as never[];
        }),
      }),
    );
    const medusaClient = {
      updateOrderShippingProjection: jest.fn(async () => {
        callOrder.push('projection');
      }),
    };
    const service = new (InboxWorkerService as any)(
      { db: { select, update, transaction } },
      {},
      {},
      {},
      medusaClient,
      {},
      {},
      { get: jest.fn() },
      { runWithChain: jest.fn() },
    );

    await service.doProcessInboxEvent({
      id: 'inbox-v1-delivered',
      eventType: 'CoreFulfillmentDelivered',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: {
        fulfillmentId: '22222222-2222-4222-8222-222222222222',
        orderId: '11111111-1111-4111-8111-111111111111',
        deliveredAt: '2026-07-15T01:00:00.000Z',
      },
      attempts: 1,
      createdAt: new Date('2026-07-15T01:00:00.000Z'),
      metadata: {},
    });

    expect(callOrder).toEqual(['lock', 'projection']);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  // 회귀: wmsOrderId 로 조회하면 Core 의 salesOrder.id 와 안 맞아 매핑이 항상 빈손이었고,
  // Medusa 주문이 조용히 pending 으로 남았다. channelOrderId 를 키로 쓰는지 확인한다.
  it('looks up the mapping by channelOrderId, not wmsOrderId', async () => {
    const whereArgs: unknown[] = [];
    const queryResults = [[], [{ salesChannel: 'medusa', channelOrderId: 'order_01ABC' }]];
    const select = jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn((condition: unknown) => {
          whereArgs.push(condition);
          return { limit: jest.fn(async () => queryResults.shift() ?? []) };
        }),
      })),
    }));
    const update = jest.fn(() => ({
      set: jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) })),
    }));
    const medusaClient = { cancelOrder: jest.fn(async () => undefined) };
    const service = new (InboxWorkerService as any)(
      { db: { select, update } },
      {},
      {},
      {},
      medusaClient,
      {},
      {},
      { get: jest.fn() },
      { runWithChain: jest.fn() },
    );

    await service.doProcessInboxEvent({
      id: 'inbox-cancel-by-channel-order-id',
      eventType: 'CoreOrderCancelled',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: {
        orderId: '11111111-1111-4111-8111-111111111111',
        channelOrderId: 'order_01ABC',
      },
      attempts: 1,
      createdAt: new Date('2026-07-22T00:00:00.000Z'),
      metadata: {},
    });

    expect(medusaClient.cancelOrder).toHaveBeenCalledWith('order_01ABC');
    // mock 은 어떤 조건이든 매핑을 돌려주므로, eq() 가 실제로 어느 컬럼을 짚었는지까지 본다.
    const mappingWhere = whereArgs[1] as { queryChunks?: Array<{ name?: string }> };
    const columns = (mappingWhere.queryChunks ?? []).map((chunk) => chunk?.name).filter(Boolean);
    expect(columns).toContain('channel_order_id');
    expect(columns).not.toContain('wms_order_id');
  });

  it('persists non-Medusa cancellation as a durable manual channel operation', async () => {
    const queryResults = [[], [{ salesChannel: 'naver', channelOrderId: '1000000001' }]];
    const select = jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ limit: jest.fn(async () => queryResults.shift() ?? []) })),
      })),
    }));
    const updates: Array<Record<string, unknown>> = [];
    const update = jest.fn(() => ({
      set: jest.fn((values: Record<string, unknown>) => ({
        where: jest.fn(async () => {
          updates.push(values);
        }),
      })),
    }));
    const insertedOperations: Array<Record<string, unknown>> = [];
    const insert = jest.fn(() => ({
      values: jest.fn((values: Record<string, unknown>) => ({
        onConflictDoNothing: jest.fn(async () => {
          insertedOperations.push(values);
        }),
      })),
    }));
    const medusaClient = { cancelOrder: jest.fn() };
    const service = new (InboxWorkerService as any)(
      { db: { select, update, insert } },
      {},
      {},
      {},
      medusaClient,
      {},
      {},
      { get: jest.fn() },
      { runWithChain: jest.fn() },
    );

    await service.doProcessInboxEvent({
      id: 'inbox-cancel',
      eventType: 'CoreOrderCancelled',
      aggregateId: '11111111-1111-4111-8111-111111111111',
      payload: { orderId: '11111111-1111-4111-8111-111111111111' },
      attempts: 1,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      metadata: {},
    });

    expect(medusaClient.cancelOrder).not.toHaveBeenCalled();
    expect(insertedOperations).toContainEqual(
      expect.objectContaining({
        operation: 'cancel',
        channel: 'naver',
        externalOrderId: '1000000001',
        status: 'manual_adjustment_required',
      }),
    );
    expect(updates).toContainEqual(expect.objectContaining({ status: 'published' }));
    expect(updates).not.toContainEqual(expect.objectContaining({ status: 'pending' }));
  });
});

describe('InboxWorkerService — 실제 sync 서비스 경유 SlowRetryInboxError 전파', () => {
  // 유닛에서 직접 던지는 게 아니라, 실제 MembershipMedusaSyncService 의 catch/rethrow 와
  // 워커의 runWithChain·타임아웃 래퍼를 모두 지나서도 instanceof 판정이 참인지 확인한다.
  it('고객 미존재가 실제 처리 경로를 지나 기본 한도(5회) 너머에서도 pending 으로 남는다', async () => {
    const { MembershipMedusaSyncService } = require('./membership-medusa-sync.service');
    const prevGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = 'group-1';
    try {
      const dbMock = createDbMock([]);
      const medusaClient = {
        findCustomerByAlmondUserId: jest.fn().mockResolvedValue(null),
        findCustomerByEmail: jest.fn().mockResolvedValue(null),
      };
      const realSyncService = new MembershipMedusaSyncService(
        medusaClient as any,
        { trackEffect: jest.fn().mockResolvedValue(undefined) } as any,
        { getActiveUserIds: jest.fn().mockResolvedValue([]) } as any,
      );
      const configService = { get: jest.fn(() => undefined) };
      const service = new InboxWorkerService(
        { db: dbMock.db } as any,
        {} as any,
        realSyncService,
        {} as any,
        medusaClient as any,
        {} as any,
        {} as any,
        configService as any,
        { runWithChain: jest.fn((_c: string, _e: string, fn: () => Promise<void>) => fn()) } as any,
      );

      await (service as any).processInboxEvent({
        id: 'ev-slow-1',
        eventType: 'MembershipStatusChanged',
        aggregateId: 'user-1',
        payload: { userId: 'user-1', email: 'user-1@example.com', status: 'ACTIVE' },
        attempts: 10,
        metadata: {},
      });

      expect(medusaClient.findCustomerByAlmondUserId).toHaveBeenCalledWith('user-1');
      expect(dbMock.updates).toContainEqual(expect.objectContaining({ status: 'pending' }));
      expect(dbMock.updates).not.toContainEqual(expect.objectContaining({ status: 'failed' }));
    } finally {
      if (prevGroupId === undefined) delete process.env.MEDUSA_MEMBERSHIP_GROUP_ID;
      else process.env.MEDUSA_MEMBERSHIP_GROUP_ID = prevGroupId;
    }
  });
});

describe('InboxWorkerService handleFailure — SlowRetryInboxError 장기 재시도', () => {
  function createFailureDbMock() {
    const applied: { attempts: number; status: string; nextAttemptAt?: Date }[] = [];
    const update = jest.fn(() => ({
      set: jest.fn((values: { attempts: number; status: string; nextAttemptAt?: Date }) => ({
        where: jest.fn(() => ({
          returning: jest.fn(async () => {
            applied.push(values);
            return [{ id: 'ev-1' }];
          }),
        })),
      })),
    }));
    return { db: { update }, applied };
  }

  function createService(dbMock: { db: unknown }) {
    const configService = { get: jest.fn(() => undefined) };
    return new (InboxWorkerService as any)(
      { db: dbMock.db },
      {},
      {},
      {},
      {},
      {},
      {},
      configService,
      { runWithChain: jest.fn() },
    );
  }

  const event = (attempts: number) => ({
    id: 'ev-1',
    eventType: 'MembershipStatusChanged',
    aggregateId: 'agg-1',
    payload: {},
    attempts,
    metadata: {},
  });

  it('일반 에러는 기본 한도(5회)에서 failed 로 종료한다', async () => {
    const dbMock = createFailureDbMock();
    const service = createService(dbMock);

    await (service as any).handleFailure(event(5), new Error('boom'));

    expect(dbMock.applied).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('SlowRetryInboxError 는 기본 한도를 넘겨도 재시도를 계속 잡는다', async () => {
    const dbMock = createFailureDbMock();
    const service = createService(dbMock);

    await (service as any).handleFailure(event(5), new SlowRetryInboxError('customer not yet created'));

    expect(dbMock.applied).toEqual([expect.objectContaining({ status: 'pending' })]);
  });

  it('SlowRetryInboxError 백오프는 1시간으로 캡된다', async () => {
    const dbMock = createFailureDbMock();
    const service = createService(dbMock);
    const before = Date.now();

    await (service as any).handleFailure(event(20), new SlowRetryInboxError('customer not yet created'));

    const [{ status, nextAttemptAt }] = dbMock.applied;
    expect(status).toBe('pending');
    const delayMs = (nextAttemptAt as Date).getTime() - before;
    expect(delayMs).toBeGreaterThan(55 * 60 * 1000);
    expect(delayMs).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  it('SlowRetryInboxError 도 확장 한도(30회)에 도달하면 failed 로 종료한다', async () => {
    const dbMock = createFailureDbMock();
    const service = createService(dbMock);

    await (service as any).handleFailure(event(30), new SlowRetryInboxError('customer not yet created'));

    expect(dbMock.applied).toEqual([expect.objectContaining({ status: 'failed' })]);
  });
});
