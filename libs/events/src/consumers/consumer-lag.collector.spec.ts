import { register } from 'prom-client';
import { ConsumerLagCollector, type ConsumerLagAdmin } from './consumer-lag.collector';

type Committed = Record<string, Record<number, string>>; // topic → partition → committed offset
type High = Record<string, Record<number, string>>; // topic → partition → high watermark

/**
 * kafkajs admin 의 두 호출만 흉내 낸다. 이 스펙이 붙드는 계약은 **tick 당 OffsetFetch 1회** 라
 * `fetchOffsets` 호출 횟수가 곧 검증 대상이다 — 토픽마다 그룹 오프셋을 따로 묻는 구현으로
 * 바뀌면 여기가 깨진다.
 */
function makeAdmin(committed: Committed, high: High) {
  const fetchOffsets = jest.fn(({ topics }: { groupId: string; topics: string[] }) =>
    Promise.resolve(
      topics.map((topic) => ({
        topic,
        partitions: Object.entries(committed[topic] ?? {}).map(([partition, offset]) => ({
          partition: Number(partition),
          offset,
          metadata: null,
        })),
      })),
    ),
  );
  const fetchTopicOffsets = jest.fn((topic: string) =>
    Promise.resolve(
      Object.entries(high[topic] ?? {}).map(([partition, offset]) => ({
        partition: Number(partition),
        offset,
        high: offset,
        low: '0',
      })),
    ),
  );
  const connect = jest.fn(() => Promise.resolve());
  const disconnect = jest.fn(() => Promise.resolve());
  const admin: ConsumerLagAdmin = { connect, disconnect, fetchOffsets, fetchTopicOffsets };
  return { admin, connect, disconnect, fetchOffsets, fetchTopicOffsets };
}

async function lag(group: string, topic: string, partition: number): Promise<number | undefined> {
  const metric = register.getSingleMetric('events_consumer_lag');
  if (!metric) return undefined;
  const { values } = await metric.get();
  return values.find(
    (v) => v.labels.group === group && v.labels.topic === topic && String(v.labels.partition) === String(partition),
  )?.value;
}

describe('ConsumerLagCollector', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('start() 는 브로커 응답을 기다리지 않고 선언 파티션 수만큼 0 시리즈를 세운다', async () => {
    const { admin, fetchOffsets } = makeAdmin({}, {});
    // 브로커가 영원히 답하지 않는다 — 그래도 시리즈는 서 있어야 한다.
    fetchOffsets.mockImplementation(() => new Promise(() => undefined));
    const collector = new ConsumerLagCollector(admin, 'seed-group', [
      { topic: 'seed.declared', partitions: 2 },
      { topic: 'seed.undeclared' },
    ]);

    void collector.start();

    expect(await lag('seed-group', 'seed.declared', 0)).toBe(0);
    expect(await lag('seed-group', 'seed.declared', 1)).toBe(0);
    expect(await lag('seed-group', 'seed.declared', 2)).toBeUndefined();
    // 선언이 없으면 토픽 부트스트랩과 같은 기본값(3)이다 — 그쪽이 그 수로 토픽을 만든다.
    expect(await lag('seed-group', 'seed.undeclared', 2)).toBe(0);
    await collector.stop();
  });

  it('tick 당 그룹 오프셋은 한 번에 묻고(OffsetFetch 1회), high watermark 는 토픽마다 묻는다', async () => {
    const { admin, fetchOffsets, fetchTopicOffsets } = makeAdmin({}, {});
    const collector = new ConsumerLagCollector(admin, 'calls-group', [{ topic: 'calls.a' }, { topic: 'calls.b' }]);

    await collector.refresh();

    expect(fetchOffsets).toHaveBeenCalledTimes(1);
    expect(fetchOffsets).toHaveBeenCalledWith({ groupId: 'calls-group', topics: ['calls.a', 'calls.b'] });
    expect(fetchTopicOffsets).toHaveBeenCalledTimes(2);
  });

  it('lag = high watermark − committed offset, 파티션별로', async () => {
    const { admin } = makeAdmin({ 'math.topic': { 0: '100', 1: '7' } }, { 'math.topic': { 0: '100', 1: '12' } });
    const collector = new ConsumerLagCollector(admin, 'math-group', [{ topic: 'math.topic', partitions: 2 }]);

    await collector.refresh();

    expect(await lag('math-group', 'math.topic', 0)).toBe(0);
    expect(await lag('math-group', 'math.topic', 1)).toBe(5);
  });

  it('커밋 오프셋이 없는 파티션(-1)은 lag 도 -1 이다 — high 를 그대로 쓰면 새 그룹이 거짓 적체로 보인다', async () => {
    const { admin } = makeAdmin({ 'fresh.topic': { 0: '-1' } }, { 'fresh.topic': { 0: '9000' } });
    const collector = new ConsumerLagCollector(admin, 'fresh-group', [{ topic: 'fresh.topic', partitions: 1 }]);

    await collector.refresh();

    expect(await lag('fresh-group', 'fresh.topic', 0)).toBe(-1);
  });

  it('실제 파티션이 선언보다 적으면 초과 시리즈를 지우고, 많으면 새 시리즈가 생긴다', async () => {
    const { admin } = makeAdmin(
      { 'shrunk.topic': { 0: '1' }, 'grown.topic': { 0: '1', 1: '1' } },
      { 'shrunk.topic': { 0: '1' }, 'grown.topic': { 0: '1', 1: '4' } },
    );
    const collector = new ConsumerLagCollector(admin, 'shape-group', [
      { topic: 'shrunk.topic', partitions: 3 },
      { topic: 'grown.topic', partitions: 1 },
    ]);
    await collector.start();

    expect(await lag('shape-group', 'shrunk.topic', 0)).toBe(0);
    expect(await lag('shape-group', 'shrunk.topic', 1)).toBeUndefined();
    expect(await lag('shape-group', 'shrunk.topic', 2)).toBeUndefined();
    expect(await lag('shape-group', 'grown.topic', 1)).toBe(3);
    await collector.stop();
  });

  it('브로커 호출이 실패해도 던지지 않고 마지막 값을 남긴다 — 관측 실패가 가용성 실패로 승격되면 안 된다', async () => {
    const { admin, fetchTopicOffsets } = makeAdmin({ 'flaky.topic': { 0: '10' } }, { 'flaky.topic': { 0: '15' } });
    const collector = new ConsumerLagCollector(admin, 'flaky-group', [{ topic: 'flaky.topic', partitions: 1 }]);
    await collector.refresh();
    expect(await lag('flaky-group', 'flaky.topic', 0)).toBe(5);

    fetchTopicOffsets.mockRejectedValueOnce(new Error('broker down'));

    await expect(collector.refresh()).resolves.toBeUndefined();
    expect(await lag('flaky-group', 'flaky.topic', 0)).toBe(5);
  });

  it('connect 실패는 다음 tick 에 다시 시도한다', async () => {
    const { admin, connect, fetchOffsets } = makeAdmin({ 'conn.topic': { 0: '1' } }, { 'conn.topic': { 0: '1' } });
    connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const collector = new ConsumerLagCollector(admin, 'conn-group', [{ topic: 'conn.topic', partitions: 1 }]);

    await collector.refresh();
    await collector.refresh();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(fetchOffsets).toHaveBeenCalledTimes(1);
  });

  it('앞 tick 이 끝나지 않았으면 다음 tick 을 건너뛴다 — 느린 브로커에 요청이 쌓이면 안 된다', async () => {
    const { admin, fetchOffsets, fetchTopicOffsets } = makeAdmin({}, {});
    let release!: () => void;
    const parked = new Promise<void>((markParked) => {
      fetchTopicOffsets.mockImplementationOnce(() => {
        markParked();
        return new Promise((resolve) => (release = () => resolve([])));
      });
    });
    const collector = new ConsumerLagCollector(admin, 'slow-group', [{ topic: 'slow.topic', partitions: 1 }]);

    const first = collector.refresh();
    await parked;
    await collector.refresh();
    expect(fetchOffsets).toHaveBeenCalledTimes(1);

    release();
    await first;
    await collector.refresh();
    expect(fetchOffsets).toHaveBeenCalledTimes(2);
  });

  it('start() 는 즉시 한 번 돌고 이후 주기마다 돈다; stop() 은 주기를 멈추고 admin 을 끊는다', async () => {
    jest.useFakeTimers();
    const { admin, disconnect, fetchOffsets } = makeAdmin({}, {});
    const collector = new ConsumerLagCollector(admin, 'timer-group', [{ topic: 'timer.topic', partitions: 1 }], 1000);

    await collector.start();
    expect(fetchOffsets).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2000);
    expect(fetchOffsets).toHaveBeenCalledTimes(3);

    await collector.stop();
    await jest.advanceTimersByTimeAsync(2000);
    expect(fetchOffsets).toHaveBeenCalledTimes(3);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
