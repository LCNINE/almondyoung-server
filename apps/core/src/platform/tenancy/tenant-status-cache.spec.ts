import { TenantStatusCache, TenantStatusSource, type TenantStatus } from './tenant-status-cache';

class FakeSource extends TenantStatusSource {
  next: Array<Record<string, TenantStatus> | Error> = [];
  constructor(private readonly configured = true) {
    super();
  }
  isConfigured(): boolean {
    return this.configured;
  }
  fetch(): Promise<ReadonlyMap<string, TenantStatus>> {
    const answer = this.next.shift();
    if (answer === undefined) return Promise.reject(new Error('no answer queued'));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(new Map(Object.entries(answer)));
  }
}

const cacheOf = (source: TenantStatusSource) =>
  new TenantStatusCache(source, { refreshIntervalMs: 15_000, retryBaseMs: 1_000 });

describe('TenantStatusCache', () => {
  it('받은 상태로 판정한다 — 정지·준비는 거절, 활성은 통과', async () => {
    const source = new FakeSource();
    source.next.push({ '1': 'active', '2': 'suspended', '3': 'preparing' });
    const cache = cacheOf(source);
    await cache.refresh();

    expect(cache.refusal('1')).toBeNull();
    expect(cache.refusal('2')).toBe('suspended');
    expect(cache.refusal('3')).toBe('preparing');
  });

  it('user-service 가 모르는 테넌트는 막지 않는다 — 빈 응답이 모든 테넌트를 멈추지 않게', async () => {
    const source = new FakeSource();
    source.next.push({});
    const cache = cacheOf(source);
    await cache.refresh();

    expect(cache.refusal('1')).toBeNull();
  });

  it('다시 활성으로 바뀌면 다음 갱신부터 통과한다', async () => {
    const source = new FakeSource();
    source.next.push({ '2': 'suspended' }, { '2': 'active' });
    const cache = cacheOf(source);
    await cache.refresh();
    expect(cache.refusal('2')).toBe('suspended');

    await cache.refresh();
    expect(cache.refusal('2')).toBeNull();
  });

  it('user-service 에 닿지 못하면 마지막으로 받은 값을 그대로 쓴다', async () => {
    const source = new FakeSource();
    source.next.push({ '1': 'active', '2': 'suspended' }, new Error('ECONNREFUSED'));
    const cache = cacheOf(source);
    await cache.refresh();
    await cache.refresh();

    expect(cache.refusal('1')).toBeNull();
    expect(cache.refusal('2')).toBe('suspended');
  });

  it('한 번도 받지 못했으면(부팅 직후 user-service 장애·설정 없음) 막지 않는다', async () => {
    const failing = new FakeSource();
    failing.next.push(new Error('ECONNREFUSED'));
    const cold = cacheOf(failing);
    await cold.refresh();
    expect(cold.refusal('2')).toBeNull();

    const disabled = cacheOf(new FakeSource(false));
    disabled.onApplicationBootstrap();
    expect(disabled.refusal('2')).toBeNull();
  });
});
