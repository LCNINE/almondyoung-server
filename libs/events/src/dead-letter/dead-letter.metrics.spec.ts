import { Logger } from '@nestjs/common';
import { register } from 'prom-client';
import type { DatabaseRun } from '@app/db';
import { singleDatabase } from '@app/db/testing/single-database';
import { DeadLetterMetricsCollector } from './dead-letter-metrics.collector';
import type { DeadLetterRuntime } from './dead-letter.runtime';

async function gauge(topic: string, status: string): Promise<number | undefined> {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === 'events_dead_letters');
  return (metric?.values as Array<{ labels: Record<string, string>; value: number }> | undefined)?.find(
    (v) => v.labels.topic === topic && v.labels.status === status,
  )?.value;
}

const attached = { isAttached: true } as DeadLetterRuntime;

describe('events_dead_letters 게이지 (#1016 8번)', () => {
  it('토픽·상태별 안 푼 건수를 쓰고, 사라진 조합은 0 으로 되돌린다', async () => {
    let rows = [
      { topic: 'orders.events.v1', status: 'failed', count: 2 },
      { topic: 'orders.events.v1', status: 'held', count: 5 },
    ];
    const collector = new DeadLetterMetricsCollector(
      singleDatabase({
        db: { select: () => ({ from: () => ({ where: () => ({ groupBy: () => Promise.resolve(rows) }) }) }) },
      }) as never,
      attached,
    );

    await collector.refresh();
    expect(await gauge('orders.events.v1', 'failed')).toBe(2);
    expect(await gauge('orders.events.v1', 'held')).toBe(5);

    rows = [];
    await collector.refresh();
    expect(await gauge('orders.events.v1', 'failed')).toBe(0);
    expect(await gauge('orders.events.v1', 'held')).toBe(0);
  });

  it('조회가 실패해도 던지지 않는다 — 스크레이프를 죽이지 않는다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const collector = new DeadLetterMetricsCollector(
      singleDatabase({
        db: {
          select: () => ({
            from: () => ({ where: () => ({ groupBy: async () => Promise.reject(new Error('db down')) }) }),
          }),
        },
      }) as never,
      attached,
    );
    await expect(collector.refresh()).resolves.toBeUndefined();
  });

  it('실패 테이블 모드가 꺼져 있으면 DB 를 읽지 않고 조용히 건너뛴다 — 경고는 한 번', async () => {
    const select = jest.fn();
    const collector = new DeadLetterMetricsCollector(
      singleDatabase({ db: { select } }) as never,
      {
        isAttached: false,
      } as DeadLetterRuntime,
    );
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      await collector.refresh();
      await collector.refresh();
      expect(select).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('테넌트 DB 가 여럿이면 건수를 더한다 — 한 DB 의 실패는 그 DB 몫만 빠진다', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const byKey: Record<string, Array<{ topic: string; status: string; count: number }> | Error> = {
      '1': [{ topic: 'multi.dl.v1', status: 'failed', count: 2 }],
      '2': [{ topic: 'multi.dl.v1', status: 'failed', count: 3 }],
      '3': new Error('tenant 3 DB 깨짐'),
    };
    let current = '';
    const dbService = {
      get db() {
        const rows = byKey[current];
        return {
          select: () => ({
            from: () => ({
              where: () => ({ groupBy: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)) }),
            }),
          }),
        };
      },
      forEachDatabase: async <R>(fn: (key: string) => Promise<R>): Promise<DatabaseRun<R>[]> => {
        const runs: DatabaseRun<R>[] = [];
        for (const key of Object.keys(byKey)) {
          current = key;
          try {
            runs.push({ key, ok: true, value: await fn(key) });
          } catch (error) {
            runs.push({ key, ok: false, error });
          }
        }
        return runs;
      },
    };

    await new DeadLetterMetricsCollector(dbService as never, attached).refresh();

    expect(await gauge('multi.dl.v1', 'failed')).toBe(5);
  });
});
