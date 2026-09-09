import { register } from 'prom-client';
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
    // 콜백 파라미터를 tx 로 두면 그 이름이 typeof tx 를 가려 자기참조가 된다.
    const transaction = jest.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

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

/**
 * 발행/실패가 카운터를 움직이는지 (#712). 여기서 붙드는 계약은 "**한 번의 발행이 한 번 센다**"
 * 와 "최종 실패가 `final` 라벨로 갈린다" 두 가지다.
 */
describe('OutboxDispatcher 발행 카운터', () => {
  async function seriesValue(name: string, labels: Record<string, string>): Promise<number | undefined> {
    const metric = register.getSingleMetric(name);
    if (!metric) return undefined;
    const collected = await metric.get();
    return collected.values.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === val))?.value;
  }

  function makeDispatcher(row: Record<string, unknown>, publish: jest.Mock, maxRetries = 5) {
    // `where` 는 그대로 await 되기도 하고(`processEvent`), `.returning()` 이 붙기도 한다(requeue).
    const where = jest.fn(() =>
      Object.assign(Promise.resolve(undefined), { returning: jest.fn().mockResolvedValue([]) }),
    );
    const update = jest.fn(() => ({ set: jest.fn(() => ({ where })) }));
    const tx = { select: jest.fn(() => makeSelectReturning([row])), update };
    const transaction = jest.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const publisherMap = new Map([[row.topic as string, { publishStoredEnvelope: publish } as never]]);
    return new OutboxDispatcher({ db: { update, transaction } } as never, publisherMap, { maxRetries });
  }

  const rowFor = (topic: string, retryCount = 0) => ({
    id: 1,
    topic,
    aggregateType: 'Order',
    aggregateId: 'order-1',
    eventType: 'order.created',
    partitionKey: null,
    payload: {},
    retryCount,
    createdAt: new Date('2026-06-08T00:00:00.000Z'),
  });

  it('발행에 성공하면 토픽별 발행 수가 는다', async () => {
    const dispatcher = makeDispatcher(rowFor('counted.topic'), jest.fn().mockResolvedValue(undefined));

    await dispatcher.dispatchPendingEvents();

    expect(await seriesValue('events_outbox_published_total', { topic: 'counted.topic' })).toBe(1);
  });

  it('재시도가 남은 실패는 final=false 로 센다', async () => {
    const dispatcher = makeDispatcher(rowFor('retried.topic'), jest.fn().mockRejectedValue(new Error('broker down')));

    await dispatcher.dispatchPendingEvents();

    // `final='true'` 쪽 0 시리즈를 세우는 것은 collector 의 몫이라 여기서는 보지 않는다.
    expect(await seriesValue('events_outbox_failed_total', { topic: 'retried.topic', final: 'false' })).toBe(1);
  });

  it('재시도를 소진한 실패는 final=true 로 센다', async () => {
    const dispatcher = makeDispatcher(
      rowFor('dead.topic', 1),
      jest.fn().mockRejectedValue(new Error('broker down')),
      2,
    );

    await dispatcher.dispatchPendingEvents();

    expect(await seriesValue('events_outbox_failed_total', { topic: 'dead.topic', final: 'true' })).toBe(1);
  });
});
