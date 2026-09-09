import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import { OutboxMetricsCollector } from './outbox-metrics.collector';

type AggregateRow = {
  topic: string;
  pending: string;
  failed: string;
  retryPending: string;
  oldestPendingAgeSeconds: string | null;
};

/**
 * drizzle 체인을 흉내 낸다. 이 스펙이 붙드는 계약은 "**집계 왕복 1회**" 이므로 체인의 끝이
 * 곧 결과다 — 토픽마다 쿼리를 도는 구현으로 바뀌면 여기가 깨진다.
 */
function makeDb(aggregateRows: AggregateRow[], distinctTopics: string[] = []) {
  const groupBy = jest.fn().mockResolvedValue(aggregateRows);
  const select = jest.fn(() => ({ from: () => ({ where: () => ({ groupBy }) }) }));
  const selectDistinct = jest.fn(() => ({ from: () => Promise.resolve(distinctTopics.map((topic) => ({ topic }))) }));
  return { dbService: { db: { select, selectDistinct } } as never, select, selectDistinct, groupBy };
}

async function seriesValue(name: string, labels: Record<string, string> = {}): Promise<number | undefined> {
  const metric = register.getSingleMetric(name);
  if (!metric) return undefined;
  const collected = await metric.get();
  return collected.values.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === val))?.value;
}

const row = (topic: string, over: Partial<AggregateRow> = {}): AggregateRow => ({
  topic,
  pending: '0',
  failed: '0',
  retryPending: '0',
  oldestPendingAgeSeconds: null,
  ...over,
});

describe('OutboxMetricsCollector', () => {
  it('앱이 선언한 토픽은 첫 수집 전부터 0 시리즈를 갖는다', async () => {
    const { dbService } = makeDb([]);

    new OutboxMetricsCollector(dbService, ['declared.topic']);

    expect(await seriesValue('events_outbox_pending', { topic: 'declared.topic' })).toBe(0);
  });

  it('선언되지 않았지만 테이블에 적재 이력이 있는 토픽도 첫 tick 에 씨를 뿌린다', async () => {
    // core 가 이 모양이다 — outbox 를 켠 것은 catalog 하나인데 적재는 더 많은 토픽이 한다.
    const { dbService } = makeDb([], ['undeclared.topic']);
    const collector = new OutboxMetricsCollector(dbService, []);

    await collector.refresh();

    expect(await seriesValue('events_outbox_pending', { topic: 'undeclared.topic' })).toBe(0);
  });

  it('적재 이력 조회는 첫 tick 에만 돈다', async () => {
    const { dbService, selectDistinct } = makeDb([]);
    const collector = new OutboxMetricsCollector(dbService, []);

    await collector.refresh();
    await collector.refresh();

    expect(selectDistinct).toHaveBeenCalledTimes(1);
  });

  it('집계 결과에서 사라진 토픽에 0 을 명시적으로 쓴다', async () => {
    const db = makeDb([row('drains.topic', { pending: '5' })]);
    const collector = new OutboxMetricsCollector(db.dbService, []);

    await collector.refresh();
    expect(await seriesValue('events_outbox_pending', { topic: 'drains.topic' })).toBe(5);

    db.groupBy.mockResolvedValue([]);
    await collector.refresh();

    expect(await seriesValue('events_outbox_pending', { topic: 'drains.topic' })).toBe(0);
  });

  it('적체·실패 행 수와 재시도 대기 수를 옮긴다', async () => {
    const { dbService } = makeDb([
      row('a.topic', { pending: '3', failed: '2', retryPending: '1' }),
      row('b.topic', { pending: '7', failed: '0', retryPending: '4' }),
    ]);
    const collector = new OutboxMetricsCollector(dbService, []);

    await collector.refresh();

    expect(await seriesValue('events_outbox_pending', { topic: 'a.topic' })).toBe(3);
    expect(await seriesValue('events_outbox_failed_rows', { topic: 'a.topic' })).toBe(2);
    expect(await seriesValue('events_outbox_pending', { topic: 'b.topic' })).toBe(7);
    expect(await seriesValue('events_outbox_retry_pending', { topic: 'a.topic' })).toBe(1);
    expect(await seriesValue('events_outbox_retry_pending', { topic: 'b.topic' })).toBe(4);
  });

  it('나이를 토픽별로 옮긴다', async () => {
    const { dbService } = makeDb([
      row('young.topic', { pending: '1', oldestPendingAgeSeconds: '12.5' }),
      row('old.topic', { pending: '1', oldestPendingAgeSeconds: '3600' }),
    ]);
    const collector = new OutboxMetricsCollector(dbService, []);

    await collector.refresh();

    expect(await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: 'young.topic' })).toBe(12.5);
    expect(await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: 'old.topic' })).toBe(3600);
  });

  it('적체가 없으면 나이는 0 이다', async () => {
    const { dbService } = makeDb([row('empty.topic', { failed: '3' })]);
    const collector = new OutboxMetricsCollector(dbService, []);

    await collector.refresh();

    expect(await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: 'empty.topic' })).toBe(0);
  });

  it('집계가 실패해도 던지지 않는다', async () => {
    const db = makeDb([]);
    db.groupBy.mockRejectedValue(new Error('connection terminated'));
    const collector = new OutboxMetricsCollector(db.dbService, []);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    // cron 핸들러가 던지면 스케줄러 로그만 더럽히고 다음 tick 을 못 지킨다.
    await expect(collector.refresh()).resolves.toBeUndefined();

    jest.restoreAllMocks();
  });
});
