import { register } from 'prom-client';
import {
  initOutboxTopicSeries,
  recordOutboxFailed,
  recordOutboxPublished,
  setOutboxOldestPendingAge,
  setOutboxPending,
} from './outbox.metrics';

/**
 * prom-client 의 값을 라벨 조합 단위로 꺼낸다. 이 스펙의 요점은 **시리즈의 존재 여부**라
 * `undefined`(시리즈 없음)와 `0`(시리즈가 0)을 구별해야 한다 — 이슈 #712 가 진단한
 * DLQ 카운터의 병이 정확히 그 구별에서 갈린다.
 */
async function seriesValue(name: string, labels: Record<string, string> = {}): Promise<number | undefined> {
  const metric = register.getSingleMetric(name);
  if (!metric) return undefined;
  const collected = await metric.get();
  const match = collected.values.find((v) =>
    Object.entries(labels).every(([key, value]) => String(v.labels[key]) === value),
  );
  return match?.value;
}

describe('outbox 메트릭 파사드', () => {
  describe('initOutboxTopicSeries', () => {
    it('한 번도 발행되지 않은 토픽에도 0 시리즈를 만든다', async () => {
      expect(await seriesValue('events_outbox_pending', { topic: 'quiet.topic' })).toBeUndefined();

      initOutboxTopicSeries('quiet.topic');

      expect(await seriesValue('events_outbox_pending', { topic: 'quiet.topic' })).toBe(0);
      expect(await seriesValue('events_outbox_failed_rows', { topic: 'quiet.topic' })).toBe(0);
      expect(await seriesValue('events_outbox_published_total', { topic: 'quiet.topic' })).toBe(0);
      expect(await seriesValue('events_outbox_failed_total', { topic: 'quiet.topic', final: 'true' })).toBe(0);
      expect(await seriesValue('events_outbox_failed_total', { topic: 'quiet.topic', final: 'false' })).toBe(0);
      expect(await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: 'quiet.topic' })).toBe(0);
      expect(await seriesValue('events_outbox_retry_pending', { topic: 'quiet.topic' })).toBe(0);
    });

    it('이미 값이 실린 게이지를 0 으로 되돌리지 않는다', async () => {
      initOutboxTopicSeries('busy.topic');
      setOutboxPending('busy.topic', 42);

      initOutboxTopicSeries('busy.topic');

      expect(await seriesValue('events_outbox_pending', { topic: 'busy.topic' })).toBe(42);
    });
  });

  it('나이는 토픽별로 기록한다 — 전역 최댓값이면 어느 토픽이 막혔는지 못 짚는다', async () => {
    setOutboxOldestPendingAge('stuck.topic', 3600);
    setOutboxOldestPendingAge('healthy.topic', 0);

    expect(await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: 'stuck.topic' })).toBe(3600);
    expect(await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: 'healthy.topic' })).toBe(0);
  });

  it('최종 실패와 재시도 예정 실패를 final 라벨로 가른다', async () => {
    recordOutboxFailed('retry.topic', false);
    recordOutboxFailed('retry.topic', false);
    recordOutboxFailed('retry.topic', true);

    expect(await seriesValue('events_outbox_failed_total', { topic: 'retry.topic', final: 'false' })).toBe(2);
    expect(await seriesValue('events_outbox_failed_total', { topic: 'retry.topic', final: 'true' })).toBe(1);
  });

  it('발행 성공을 토픽별로 센다', async () => {
    recordOutboxPublished('ok.topic');
    recordOutboxPublished('ok.topic');

    expect(await seriesValue('events_outbox_published_total', { topic: 'ok.topic' })).toBe(2);
  });
});
