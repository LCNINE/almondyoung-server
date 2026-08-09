/**
 * 디스패처의 두 seam — **publisher 파생 조회**와 **발행 보류 게이트** (ADR-0029 §5-1, Task 6-C-2)
 *
 * 둘 다 6-C-2 가 core 회수를 위해 열었고, 둘 다 없으면 조용히 잘못된다:
 *
 *  - 파생 조회가 없으면, 아웃박스를 켠 `forRoot` 의 `streams` 에 없는 토픽의 행이
 *    `No publisher found for topic` 으로 재시도를 소진한다. core 가 정확히 그 상태였다 —
 *    아웃박스를 켠 것은 catalog(`PRODUCT_STREAM`) 하나인데 적재는 6개 토픽이 한다.
 *  - 보류 게이트가 없으면, 정비 중에도 fulfillment·shipment 이벤트가 나간다(옛 core 디스패처는
 *    멈췄다).
 *
 * **대조군을 함께 둔다** — 게이트를 주지 않았을 때 조건이 아예 붙지 않는 것, 그리고 파생 조회를
 * 주지 않았을 때 옛 동작(맵에 없으면 실패)이 그대로인 것.
 */

import { PgDialect } from 'drizzle-orm/pg-core';
import { DbService } from '@app/db';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import type { OutboxDispatchGate } from './outbox-dispatch-gate.port';

const FROZEN_NOW = new Date('2026-08-09T00:00:00.000Z');

function renderWhere(where: unknown): string {
  return new PgDialect().sqlToQuery(where as never).sql;
}

type Captured = { acquireWhere?: unknown; updates: Array<Record<string, unknown>> };

function makeDb(pendingRows: unknown[]) {
  const captured: Captured = { updates: [] };
  const thenable = () => {
    const p = Promise.resolve<unknown[]>([]) as Promise<unknown[]> & { returning: jest.Mock };
    p.returning = jest.fn().mockResolvedValue([]);
    return p;
  };
  const tx = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          captured.acquireWhere = w;
          return { orderBy: () => ({ limit: () => ({ for: jest.fn().mockResolvedValue(pendingRows) }) }) };
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  const db = {
    transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        captured.updates.push(s);
        return { where: () => thenable() };
      },
    }),
    delete: () => ({ where: () => thenable() }),
  };
  return { dbService: { db } as unknown as DbService, captured };
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  topic: 'inventory.events.v1',
  aggregateType: 'Stock',
  aggregateId: 'agg-1',
  eventType: 'StockShipped',
  partitionKey: 'SKU-1',
  payload: { messageType: 'StockShipped', payload: {} },
  retryCount: 0,
  createdAt: FROZEN_NOW,
  ...overrides,
});

const gateOf = (paused: ReturnType<OutboxDispatchGate['pausedRows']>): OutboxDispatchGate => ({
  pausedRows: () => paused,
});

describe('OutboxDispatcher — publisher 파생 조회', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(FROZEN_NOW));
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('맵에 없는 토픽은 resolver 로 찾아 발행한다', async () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const resolve = jest.fn().mockReturnValue({ publishStoredEnvelope: publish } as unknown as StreamPublisher);
    const { dbService } = makeDb([row()]);

    await new OutboxDispatcher(dbService, new Map(), undefined, resolve).dispatchPendingEvents();

    expect(resolve).toHaveBeenCalledWith('inventory.events.v1');
    // 행의 partitionKey 가 그대로 전송 키가 된다 — 재고 이벤트가 skuId 로 파티션되는 근거.
    expect(publish).toHaveBeenCalledWith(expect.anything(), 'SKU-1');
  });

  it('한 번 찾은 publisher 는 다음 폴링에서 다시 찾지 않는다', async () => {
    const resolve = jest.fn().mockReturnValue({
      publishStoredEnvelope: jest.fn().mockResolvedValue(undefined),
    } as unknown as StreamPublisher);
    const { dbService } = makeDb([row()]);
    const dispatcher = new OutboxDispatcher(dbService, new Map(), undefined, resolve);

    await dispatcher.dispatchPendingEvents();
    await dispatcher.dispatchPendingEvents();

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('대조군 — resolver 가 없으면 옛 동작 그대로 실패로 기록된다', async () => {
    const { dbService, captured } = makeDb([row()]);

    await new OutboxDispatcher(dbService, new Map()).dispatchPendingEvents();

    const failure = captured.updates.at(-1)!;
    expect(failure.status).toBe('PENDING');
    expect(failure.retryCount).toBe(1);
    expect(String(failure.errorMessage)).toContain('No publisher found for topic');
  });

  it('resolver 가 못 찾아도 같은 실패로 떨어진다 (조용히 넘어가지 않는다)', async () => {
    const { dbService, captured } = makeDb([row()]);

    await new OutboxDispatcher(dbService, new Map(), undefined, () => undefined).dispatchPendingEvents();

    expect(String(captured.updates.at(-1)!.errorMessage)).toContain('No publisher found for topic');
  });
});

describe('OutboxDispatcher — 발행 보류 게이트', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(FROZEN_NOW));
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('대조군 — 게이트가 없으면 보류 조건이 아예 붙지 않는다', async () => {
    const { dbService, captured } = makeDb([]);

    await new OutboxDispatcher(dbService, new Map()).dispatchPendingEvents();

    const sql = renderWhere(captured.acquireWhere);
    expect(sql).not.toContain('not ');
    expect(sql).not.toContain('ilike');
  });

  it('대조군 — 게이트가 null 을 주면(정상 운영) 조건이 붙지 않는다', async () => {
    const { dbService, captured } = makeDb([]);

    await new OutboxDispatcher(dbService, new Map(), undefined, undefined, gateOf(null)).dispatchPendingEvents();

    expect(renderWhere(captured.acquireWhere)).not.toContain('ilike');
  });

  it('보류는 **선택 단계**에 걸린다 — 고른 뒤 버리면 행이 PROCESSING 에 갇힌다', async () => {
    const { dbService, captured } = makeDb([]);

    await new OutboxDispatcher(
      dbService,
      new Map(),
      undefined,
      undefined,
      gateOf({ topics: ['shipments.events.v1'], eventTypePrefixes: ['Fulfillment'] }),
    ).dispatchPendingEvents();

    const sql = renderWhere(captured.acquireWhere);
    expect(sql).toContain('not ');
    expect(sql).toContain('"topic" in');
    expect(sql).toContain('ilike');
    // 옛 조건이 사라지지 않아야 한다 — 보류는 추가지 대체가 아니다.
    expect(sql).toContain('"status" =');
    expect(sql).toContain('"next_attempt_at" <=');
  });

  it('토픽만 / 접두사만 준 경우에도 각각 조건이 선다', async () => {
    const onlyTopics = makeDb([]);
    await new OutboxDispatcher(
      onlyTopics.dbService,
      new Map(),
      undefined,
      undefined,
      gateOf({ topics: ['shipments.events.v1'] }),
    ).dispatchPendingEvents();
    expect(renderWhere(onlyTopics.captured.acquireWhere)).toContain('"topic" in');
    expect(renderWhere(onlyTopics.captured.acquireWhere)).not.toContain('ilike');

    const onlyPrefixes = makeDb([]);
    await new OutboxDispatcher(
      onlyPrefixes.dbService,
      new Map(),
      undefined,
      undefined,
      gateOf({ eventTypePrefixes: ['Shipment'] }),
    ).dispatchPendingEvents();
    expect(renderWhere(onlyPrefixes.captured.acquireWhere)).toContain('ilike');
    expect(renderWhere(onlyPrefixes.captured.acquireWhere)).not.toContain('"topic" in');
  });

  it('빈 서술은 조건을 만들지 않는다 (전부 보류로 뒤집히지 않는다)', async () => {
    // `not(or())` 같은 것이 만들어지면 아무 행도 안 고르는 상태가 된다 — 발행이 통째로 멈춘다.
    const { dbService, captured } = makeDb([]);

    await new OutboxDispatcher(dbService, new Map(), undefined, undefined, gateOf({})).dispatchPendingEvents();

    const sql = renderWhere(captured.acquireWhere);
    expect(sql).not.toContain('not ');
  });

  it('게이트는 폴링마다 다시 묻는다 — 모드가 런타임에 바뀔 수 있다', async () => {
    const pausedRows = jest.fn().mockReturnValue(null);
    const { dbService } = makeDb([]);
    const dispatcher = new OutboxDispatcher(dbService, new Map(), undefined, undefined, { pausedRows });

    await dispatcher.dispatchPendingEvents();
    await dispatcher.dispatchPendingEvents();

    expect(pausedRows).toHaveBeenCalledTimes(2);
  });
});
