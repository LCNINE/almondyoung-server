import { register } from 'prom-client';
import { DeadLetterMetricsCollector } from './dead-letter-metrics.collector';

async function gauge(topic: string, status: string): Promise<number | undefined> {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === 'events_dead_letters');
  return (metric?.values as Array<{ labels: Record<string, string>; value: number }> | undefined)?.find(
    (v) => v.labels.topic === topic && v.labels.status === status,
  )?.value;
}

describe('events_dead_letters 게이지 (#1016 8번)', () => {
  it('토픽·상태별 안 푼 건수를 쓰고, 사라진 조합은 0 으로 되돌린다', async () => {
    let rows = [
      { topic: 'orders.events.v1', status: 'failed', count: 2 },
      { topic: 'orders.events.v1', status: 'held', count: 5 },
    ];
    const collector = new DeadLetterMetricsCollector({
      db: { select: () => ({ from: () => ({ where: () => ({ groupBy: () => Promise.resolve(rows) }) }) }) },
    } as never);

    await collector.refresh();
    expect(await gauge('orders.events.v1', 'failed')).toBe(2);
    expect(await gauge('orders.events.v1', 'held')).toBe(5);

    rows = [];
    await collector.refresh();
    expect(await gauge('orders.events.v1', 'failed')).toBe(0);
    expect(await gauge('orders.events.v1', 'held')).toBe(0);
  });

  it('조회가 실패해도 던지지 않는다 — 스크레이프를 죽이지 않는다', async () => {
    const collector = new DeadLetterMetricsCollector({
      db: {
        select: () => ({
          from: () => ({ where: () => ({ groupBy: async () => Promise.reject(new Error('db down')) }) }),
        }),
      },
    } as never);
    await expect(collector.refresh()).resolves.toBeUndefined();
  });
});
