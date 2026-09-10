import { register } from 'prom-client';
import { dropConsumerLagSeries, initConsumerLagSeries, setConsumerLag } from './consumer-lag.metrics';

/**
 * 시리즈의 **존재 여부**가 요점이라 `undefined`(없음)와 `0`(0 으로 존재)을 가른다 —
 * `outbox.metrics.spec.ts` 와 같은 이유다(#712 가 진단한 DLQ 카운터의 병).
 */
async function seriesValue(name: string, labels: Record<string, string>): Promise<number | undefined> {
  const metric = register.getSingleMetric(name);
  if (!metric) return undefined;
  const collected = await metric.get();
  return collected.values.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === val))?.value;
}

const METRIC = 'events_consumer_lag';

describe('consumer lag 메트릭 파사드', () => {
  it('선언된 파티션 수만큼 0 시리즈를 세운다 — 한 번도 폴링하지 못해도 시리즈는 있어야 한다', async () => {
    expect(await seriesValue(METRIC, { group: 'g1', topic: 'quiet.topic', partition: '0' })).toBeUndefined();

    initConsumerLagSeries('g1', 'quiet.topic', 3);

    expect(await seriesValue(METRIC, { group: 'g1', topic: 'quiet.topic', partition: '0' })).toBe(0);
    expect(await seriesValue(METRIC, { group: 'g1', topic: 'quiet.topic', partition: '2' })).toBe(0);
    expect(await seriesValue(METRIC, { group: 'g1', topic: 'quiet.topic', partition: '3' })).toBeUndefined();
  });

  it('이미 값이 실린 시리즈를 재초기화로 0 으로 되돌리지 않는다', async () => {
    initConsumerLagSeries('g1', 'busy.topic', 1);
    setConsumerLag('g1', 'busy.topic', 0, 42);

    initConsumerLagSeries('g1', 'busy.topic', 1);

    expect(await seriesValue(METRIC, { group: 'g1', topic: 'busy.topic', partition: '0' })).toBe(42);
  });

  it('커밋 오프셋이 없는 파티션은 -1 로 남긴다 — 0 이면 「한 번도 커밋 못 함」이 정상으로 보인다', async () => {
    setConsumerLag('g1', 'fresh.topic', 0, -1);

    expect(await seriesValue(METRIC, { group: 'g1', topic: 'fresh.topic', partition: '0' })).toBe(-1);
  });

  it('선언보다 실제 파티션이 적으면 초과 시리즈를 지운다 — 거짓 0 을 남기지 않기 위해', async () => {
    initConsumerLagSeries('g1', 'shrunk.topic', 3);

    dropConsumerLagSeries('g1', 'shrunk.topic', 2);

    expect(await seriesValue(METRIC, { group: 'g1', topic: 'shrunk.topic', partition: '1' })).toBe(0);
    expect(await seriesValue(METRIC, { group: 'g1', topic: 'shrunk.topic', partition: '2' })).toBeUndefined();
  });
});
