import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, lt } from 'drizzle-orm';
import { DbService } from '@app/db';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { OutboxDispatcher, OUTBOX_RETRY_DELAYS_SECONDS } from './outbox-dispatcher.service';
import { outbox_events } from './outbox.schema';

/**
 * ADR-0029 §5-1 (Task 6-C-1) 로 공용 디스패처에 승격된 두 성질을 고정한다.
 *
 *  1. **예약 백오프** — 실패한 행은 `next_attempt_at` 이 지나기 전에는 선택되지 않는다.
 *  2. **lease** — 발행 중인 행은 재선택되지 않고, 크래시 회수는 `retry_count` 를 소모하지 않는다.
 *
 * 승격 전 공용 판본은 `status='PENDING' AND retry_count < max` 만 보고 5초마다 즉시 재시도했다.
 * **아래 `대조군` describe 가 그 옛 조건을 같은 단언에 넣어 빨간불이 나는 것을 보인다** — 그러지
 * 않으면 초록불이 "백오프가 있다"는 뜻인지 "단언이 아무거나 통과시킨다"는 뜻인지 알 수 없다.
 */

const FROZEN_NOW = new Date('2026-08-09T00:00:00.000Z');

/** 캡처된 drizzle `where` 객체를 실제 SQL 텍스트로 렌더링한다 (구조가 아니라 결과를 본다). */
function renderWhere(where: unknown): { sql: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(where as never);
  return { sql: q.sql, params: q.params };
}

type Captured = {
  acquireWhere?: unknown;
  acquireSet?: Record<string, unknown>;
  rootUpdates: Array<{ set: Record<string, unknown>; where?: unknown }>;
};

function makeDb(pendingRows: unknown[]) {
  const captured: Captured = { rootUpdates: [] };

  type Thenable = Promise<unknown[]> & { returning: jest.Mock };
  const thenableWithReturning = (): Thenable => {
    const p = Promise.resolve<unknown[]>([]) as Thenable;
    p.returning = jest.fn().mockResolvedValue([]);
    return p;
  };

  const tx = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          captured.acquireWhere = w;
          return {
            orderBy: () => ({
              limit: () => ({ for: jest.fn().mockResolvedValue(pendingRows) }),
            }),
          };
        },
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        captured.acquireSet = s;
        return { where: () => Promise.resolve([]) };
      },
    }),
  };

  const db = {
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        const rec: { set: Record<string, unknown>; where?: unknown } = { set: s };
        captured.rootUpdates.push(rec);
        return {
          where: (w: unknown) => {
            rec.where = w;
            return thenableWithReturning();
          },
        };
      },
    }),
    delete: () => ({ where: () => thenableWithReturning() }),
  };

  return { dbService: { db } as unknown as DbService, captured };
}

/** 항상 실패하는 publisher — 실패 경로(백오프 예약)를 돌리기 위한 것. */
function fakePublisher(publishStoredEnvelope: jest.Mock): StreamPublisher {
  return { publishStoredEnvelope } as unknown as StreamPublisher;
}

function failingPublisherMap(topic: string, message = 'boom'): Map<string, StreamPublisher> {
  return new Map([[topic, fakePublisher(jest.fn().mockRejectedValue(new Error(message)))]]);
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    topic: 'orders.events.v1',
    aggregateType: 'Order',
    aggregateId: 'agg-1',
    eventType: 'OrderCreated',
    partitionKey: null,
    payload: { messageType: 'OrderCreated', payload: {} },
    retryCount: 0,
    createdAt: FROZEN_NOW,
    ...overrides,
  };
}

describe('OutboxDispatcher — 예약 백오프와 lease (ADR-0029 §5-1 승격)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FROZEN_NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('acquire 는 next_attempt_at 이 지난 행만 고른다 (예약 백오프의 근거)', async () => {
    const { dbService, captured } = makeDb([]);
    const dispatcher = new OutboxDispatcher(dbService, new Map());

    await dispatcher.dispatchPendingEvents();

    const { sql, params } = renderWhere(captured.acquireWhere);
    expect(sql).toContain('"next_attempt_at" <=');
    // 비교 대상이 "지금" 이어야 한다 — 상수나 null 을 넣고도 위 문자열은 통과하므로 함께 본다.
    // 바인딩 값은 drizzle 이 timestamptz 로 직렬화한 **UTC ISO 문자열**이다. 이 모양 자체가
    // 컬럼이 `withTimezone` 이라는 증거이기도 하다 — timestamp(without tz) 였다면 세션 TZ 에
    // 의존하는 'YYYY-MM-DD HH:MM:SS' 로 나가고, DB 가 쓴 `DEFAULT now()` 와 어긋날 수 있었다.
    expect(params).toContain(FROZEN_NOW.toISOString());
    // 옛 조건도 그대로 남아 있어야 한다 (백오프는 추가지 대체가 아니다).
    expect(sql).toContain('"status" =');
    expect(sql).toContain('"retry_count" <');
  });

  it('acquire 는 lease 만 잡고 retry_count 를 올리지 않는다', async () => {
    const { dbService, captured } = makeDb([pendingRow()]);
    const dispatcher = new OutboxDispatcher(dbService, failingPublisherMap('orders.events.v1'));

    await dispatcher.dispatchPendingEvents();

    expect(captured.acquireSet).toEqual({ status: 'PROCESSING', processingStartedAt: FROZEN_NOW });
    expect(captured.acquireSet).not.toHaveProperty('retryCount');
  });

  it.each(OUTBOX_RETRY_DELAYS_SECONDS.map((delay, i) => [i, delay] as const))(
    '실패 %i회차 뒤 next_attempt_at 을 %i초 뒤로 예약한다',
    async (priorRetries, expectedDelaySec) => {
      const { dbService, captured } = makeDb([pendingRow({ retryCount: priorRetries })]);
      const dispatcher = new OutboxDispatcher(dbService, failingPublisherMap('orders.events.v1'), {
        maxRetries: 99, // 최종 실패로 빠지지 않게 해 백오프만 본다
      });

      await dispatcher.dispatchPendingEvents();

      const failure = captured.rootUpdates.at(-1)!;
      expect(failure.set.status).toBe('PENDING');
      expect(failure.set.retryCount).toBe(priorRetries + 1);
      expect(failure.set.nextAttemptAt).toEqual(new Date(FROZEN_NOW.getTime() + expectedDelaySec * 1000));
    },
  );

  it('백오프 상한을 넘어도 마지막 지연값을 유지한다 (증가하지도, 0 이 되지도 않는다)', async () => {
    const beyond = OUTBOX_RETRY_DELAYS_SECONDS.length + 3;
    const { dbService, captured } = makeDb([pendingRow({ retryCount: beyond })]);
    const dispatcher = new OutboxDispatcher(dbService, failingPublisherMap('orders.events.v1'), { maxRetries: 99 });

    await dispatcher.dispatchPendingEvents();

    const last = OUTBOX_RETRY_DELAYS_SECONDS[OUTBOX_RETRY_DELAYS_SECONDS.length - 1];
    expect(captured.rootUpdates.at(-1)!.set.nextAttemptAt).toEqual(new Date(FROZEN_NOW.getTime() + last * 1000));
  });

  it('최종 실패의 nextAttemptAt: undefined 는 SET 절에서 아예 빠진다 (NOT NULL 컬럼이라 중요)', () => {
    // `next_attempt_at` 은 NOT NULL 이다. drizzle 이 undefined 를 NULL 로 바꿔 쓴다면 최종 실패
    // 행마다 제약 위반으로 터진다 — 그 경로는 재시도가 소진돼야 도달하므로 스펙 없이는
    // 프로덕션에서만 드러난다. 여기서 실제 SQL 을 렌더링해 SET 절에 없음을 고정한다.
    const db = drizzle({} as never);
    const { sql } = db
      .update(outbox_events)
      .set({ status: 'FAILED', retryCount: 5, failedAt: FROZEN_NOW, nextAttemptAt: undefined })
      .where(eq(outbox_events.id, 1))
      .toSQL();

    expect(sql).toContain('"status" =');
    expect(sql).toContain('"failed_at" =');
    expect(sql).not.toContain('next_attempt_at');
  });

  it('최종 실패는 FAILED 로 굳고 다음 시도를 예약하지 않는다', async () => {
    const { dbService, captured } = makeDb([pendingRow({ retryCount: 4 })]);
    const dispatcher = new OutboxDispatcher(dbService, failingPublisherMap('orders.events.v1'), { maxRetries: 5 });

    await dispatcher.dispatchPendingEvents();

    const failure = captured.rootUpdates.at(-1)!;
    expect(failure.set.status).toBe('FAILED');
    expect(failure.set.retryCount).toBe(5);
    expect(failure.set.failedAt).toEqual(FROZEN_NOW);
    expect(failure.set.nextAttemptAt).toBeUndefined();
  });

  it('lease 만료 회수는 retry_count 를 소모하지 않고 즉시 자격을 돌려준다', async () => {
    const { dbService, captured } = makeDb([]);
    const dispatcher = new OutboxDispatcher(dbService, new Map(), { processingTimeoutMs: 60_000 });

    await dispatcher.dispatchPendingEvents();

    const requeue = captured.rootUpdates[0];
    expect(requeue.set).toMatchObject({
      status: 'PENDING',
      processingStartedAt: null,
      nextAttemptAt: FROZEN_NOW, // 백오프로 미루지 않는다 — 크래시는 payload 잘못이 아니다
    });
    // 크래시가 재시도 예산을 깎으면 poison 행과 구분되지 않는다.
    expect(requeue.set).not.toHaveProperty('retryCount');
  });

  it('partitionKey 가 있으면 그것을, 없으면 aggregateId 를 파티션 키로 쓴다', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const map = new Map([['orders.events.v1', fakePublisher(publish)]]);

    const a = makeDb([pendingRow({ partitionKey: 'pk-9' })]);
    await new OutboxDispatcher(a.dbService, map).dispatchPendingEvents();
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), 'pk-9');

    const b = makeDb([pendingRow({ partitionKey: null })]);
    await new OutboxDispatcher(b.dbService, map).dispatchPendingEvents();
    expect(publish).toHaveBeenLastCalledWith(expect.anything(), 'agg-1');
  });

  /**
   * 대조군. 위 첫 테스트의 단언이 **무엇을 걸러내는지** 보인다 — 승격 전 공용 판본의 acquire
   * 조건을 같은 단언에 통과시키려 하면 실패해야 한다. 이게 실패하지 않는다면 첫 테스트의
   * 초록불은 백오프의 존재가 아니라 단언의 무력함을 뜻한다.
   */
  describe('대조군 — 승격 전(백오프 없음) 조건은 같은 단언을 통과하지 못한다', () => {
    const legacyWhere = and(eq(outbox_events.status, 'PENDING'), lt(outbox_events.retryCount, 5));

    it('옛 조건에는 next_attempt_at 술어가 없다', () => {
      const { sql } = renderWhere(legacyWhere);
      expect(sql).toContain('"status" =');
      expect(sql).toContain('"retry_count" <');
      expect(sql).not.toContain('next_attempt_at');
    });

    it('옛 조건을 승격 후 단언에 넣으면 빨간불이 난다', () => {
      const { sql } = renderWhere(legacyWhere);
      expect(() => expect(sql).toContain('"next_attempt_at" <=')).toThrow();
    });
  });
});
