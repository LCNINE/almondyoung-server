import type { PublicClientOriginSource } from './public-client-cors';
import { PublicClientOriginsCache } from './public-client-origins.cache';
import type { PublicClientOriginsRepository } from './public-client-origins.repository';

const ARGUS: PublicClientOriginSource = {
  clientType: 'public',
  isActive: true,
  redirectUris: ['https://argus.pages.dev/callback'],
};

describe('PublicClientOriginsCache', () => {
  let rows: PublicClientOriginSource[];
  let findOriginSources: jest.Mock<Promise<PublicClientOriginSource[]>, []>;
  let cache: PublicClientOriginsCache;
  let now: number;

  beforeEach(() => {
    rows = [ARGUS];
    findOriginSources = jest.fn(async () => rows);
    cache = new PublicClientOriginsCache({ findOriginSources } as unknown as PublicClientOriginsRepository);
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => jest.restoreAllMocks());

  it('60초 안에는 DB 를 다시 읽지 않는다', async () => {
    await cache.isAllowed('https://argus.pages.dev');
    await cache.isAllowed('https://evil.example.com');
    now += 59_999;
    await cache.isAllowed('https://argus.pages.dev');
    expect(findOriginSources).toHaveBeenCalledTimes(1);
  });

  it('TTL 이 지나면 다시 읽어 바뀐 클라이언트를 반영한다', async () => {
    expect(await cache.isAllowed('https://argus.pages.dev')).toBe(true);
    rows = [{ ...ARGUS, isActive: false }];
    now += 60_000;
    expect(await cache.isAllowed('https://argus.pages.dev')).toBe(false);
    expect(findOriginSources).toHaveBeenCalledTimes(2);
  });

  it('invalidate() 하면 TTL 전이라도 다시 읽는다', async () => {
    expect(await cache.isAllowed('https://argus.pages.dev')).toBe(true);
    rows = [];
    cache.invalidate();
    expect(await cache.isAllowed('https://argus.pages.dev')).toBe(false);
  });

  it('동시 요청은 조회 한 번을 나눠 쓴다', async () => {
    await Promise.all([cache.isAllowed('a'), cache.isAllowed('b'), cache.isAllowed('c')]);
    expect(findOriginSources).toHaveBeenCalledTimes(1);
  });

  it('재조회가 실패하면 이전 목록을 유지한다', async () => {
    expect(await cache.isAllowed('https://argus.pages.dev')).toBe(true);
    now += 60_000;
    findOriginSources.mockRejectedValueOnce(new Error('db down'));
    expect(await cache.isAllowed('https://argus.pages.dev')).toBe(true);
  });

  it('첫 조회가 실패하면 throw 한다 — delegator 가 기존 규칙으로 물러난다', async () => {
    findOriginSources.mockRejectedValueOnce(new Error('db down'));
    await expect(cache.isAllowed('https://argus.pages.dev')).rejects.toThrow('db down');
    // 실패를 캐시하지 않는다.
    expect(await cache.isAllowed('https://argus.pages.dev')).toBe(true);
  });
});
