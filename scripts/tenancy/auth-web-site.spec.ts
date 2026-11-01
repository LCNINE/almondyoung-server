import { allowedRedirect, cachedLookup, codeRedirectAllowed, resolveSite, type Site, type TenantSite } from '../../web/auth-web/lib/site/site-rules';

/**
 * auth-web 은 들어온 주소로 «어느 화면»인지 정한다 — 기본 주소(AUTH_WEB_ORIGIN)는 지금 그대로, 테넌트 도메인은 그 테넌트
 * 브랜드, 그 밖(모르는 주소·준비/정지 테넌트)은 브랜드 없는 중립 오류.
 */
const DEFAULT_ORIGIN = 'http://localhost:8001';

const rehearsal: TenantSite = {
  tenantId: '2',
  displayName: '리허설 상사',
  logoUrl: 'https://rehearsal-public.example/logo.png',
  active: true,
  hosts: ['rehearsal.localhost:8002', 'rehearsal.localhost:8001'],
};

const lookupOf = (table: Record<string, TenantSite>) => async (host: string) => table[host] ?? null;

describe('auth-web 주소 → 화면', () => {
  it('기본 주소는 조회 없이 기본 화면이다', async () => {
    const lookup = jest.fn(lookupOf({}));
    const site = await resolveSite('localhost:8001', DEFAULT_ORIGIN, lookup);
    expect(site).toEqual({ kind: 'default', origin: DEFAULT_ORIGIN });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('활성 테넌트의 도메인은 그 테넌트 화면이고, 기원은 들어온 주소다(기본 주소의 scheme)', async () => {
    const site = await resolveSite('Rehearsal.localhost:8001', DEFAULT_ORIGIN, lookupOf({ 'rehearsal.localhost:8001': rehearsal }));
    expect(site).toEqual({
      kind: 'tenant',
      origin: 'http://rehearsal.localhost:8001',
      displayName: '리허설 상사',
      logoUrl: 'https://rehearsal-public.example/logo.png',
      hosts: ['rehearsal.localhost:8002', 'rehearsal.localhost:8001'],
    });
  });

  it.each([
    ['모르는 주소', 'unknown.localhost:8001', lookupOf({})],
    ['준비·정지 테넌트', 'rehearsal.localhost:8001', lookupOf({ 'rehearsal.localhost:8001': { ...rehearsal, active: false } })],
    ['Host 없음', null, lookupOf({})],
    [
      '조회 실패(user-service 도달 불가) — 기본 화면으로 떨어지지 않는다',
      'rehearsal.localhost:8001',
      async () => {
        throw new Error('ECONNREFUSED');
      },
    ],
  ])('%s → 브랜드 없는 중립 오류', async (_label, host, lookup) => {
    expect(await resolveSite(host, DEFAULT_ORIGIN, lookup)).toEqual({ kind: 'unavailable' });
  });
});

describe('리디렉트 허용', () => {
  const tenantSite: Site = {
    kind: 'tenant',
    origin: 'http://rehearsal.localhost:8001',
    displayName: '리허설 상사',
    logoUrl: null,
    hosts: ['rehearsal.localhost:8002', 'rehearsal.localhost:8001'],
  };
  const defaultSite: Site = { kind: 'default', origin: DEFAULT_ORIGIN };
  const DEFAULT_ALLOWED = ['.almondyoung.com', 'localhost:8002'];

  it('테넌트 화면은 그 테넌트 도메인으로만 돌려보낸다', () => {
    expect(allowedRedirect('http://rehearsal.localhost:8002/auth/callback?x=1', tenantSite, DEFAULT_ALLOWED)).toBe(
      'http://rehearsal.localhost:8002/auth/callback?x=1',
    );
    expect(allowedRedirect('http://REHEARSAL.localhost:8001/', tenantSite, DEFAULT_ALLOWED)).toBe('http://rehearsal.localhost:8001/');
  });

  it.each([
    ['아몬드영 관리자', 'https://admin.almondyoung.com/auth/callback'],
    ['기본 허용 목록의 로컬 주소', 'http://localhost:8002/auth/callback'],
    ['테넌트 도메인의 하위 주소(정확히 같아야 한다)', 'http://evil.rehearsal.localhost:8002/'],
    ['같은 host 다른 포트', 'http://rehearsal.localhost:9999/'],
    ['http(s) 아닌 scheme', 'javascript://rehearsal.localhost:8002/%0aalert(1)'],
    ['URL 아님', 'not a url'],
  ])('테넌트 화면은 %s 로 보내지 않는다', (_label, raw) => {
    expect(allowedRedirect(raw, tenantSite, DEFAULT_ALLOWED)).toBeNull();
  });

  it('기본 화면은 지금 규칙 그대로(정확히 같거나 «.접미사»)', () => {
    expect(allowedRedirect('https://admin.almondyoung.com/x', defaultSite, DEFAULT_ALLOWED)).toBe('https://admin.almondyoung.com/x');
    expect(allowedRedirect('https://almondyoung.com/', defaultSite, DEFAULT_ALLOWED)).toBe('https://almondyoung.com/');
    expect(allowedRedirect('http://localhost:8002/', defaultSite, DEFAULT_ALLOWED)).toBe('http://localhost:8002/');
    expect(allowedRedirect('http://rehearsal.localhost:8002/', defaultSite, DEFAULT_ALLOWED)).toBeNull();
  });

  it('중립 오류 화면은 어디로도 보내지 않는다', () => {
    expect(allowedRedirect('http://rehearsal.localhost:8002/', { kind: 'unavailable' }, DEFAULT_ALLOWED)).toBeNull();
  });

  it('빈 값은 null', () => {
    expect(allowedRedirect(undefined, tenantSite, DEFAULT_ALLOWED)).toBeNull();
    expect(allowedRedirect('', defaultSite, DEFAULT_ALLOWED)).toBeNull();
  });
});

describe('브랜드 조회 캐시', () => {
  it('TTL 안에서는 다시 부르지 않고(모르는 주소도), 지나면 다시 부른다', async () => {
    let now = 0;
    const lookup = jest.fn(lookupOf({ 'rehearsal.localhost:8001': rehearsal }));
    const cached = cachedLookup(lookup, { ttlMs: 60_000, now: () => now });

    expect(await cached('rehearsal.localhost:8001')).toBe(rehearsal);
    expect(await cached('unknown.localhost:8001')).toBeNull();
    now = 59_999;
    await cached('rehearsal.localhost:8001');
    await cached('unknown.localhost:8001');
    expect(lookup).toHaveBeenCalledTimes(2);

    now = 60_000;
    await cached('rehearsal.localhost:8001');
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it('조회 실패는 담지 않는다 — user-service 가 잠깐 죽은 동안의 실패가 TTL 내내 남지 않게', async () => {
    const lookup = jest
      .fn<Promise<TenantSite | null>, [string]>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(rehearsal);
    const cached = cachedLookup(lookup, { ttlMs: 60_000, now: () => 0 });

    await expect(cached('rehearsal.localhost:8001')).rejects.toThrow('ECONNREFUSED');
    expect(await cached('rehearsal.localhost:8001')).toBe(rehearsal);
  });
});

describe('인가 코드를 보낼 redirect_uri', () => {
  const tenantSite: Site = {
    kind: 'tenant',
    origin: 'http://rehearsal.localhost:8001',
    displayName: '리허설 상사',
    logoUrl: null,
    hosts: ['rehearsal.localhost:8002', 'rehearsal.localhost:8001'],
  };
  const defaultSite: Site = { kind: 'default', origin: DEFAULT_ORIGIN };
  const tenantOne: TenantSite = { ...rehearsal, tenantId: '1', displayName: '아몬드영', hosts: ['localhost:8002'] };
  const lookup = lookupOf({ 'rehearsal.localhost:8002': rehearsal, 'localhost:8002': tenantOne });

  it('테넌트 화면은 그 테넌트 도메인만', async () => {
    expect(await codeRedirectAllowed('http://rehearsal.localhost:8002/auth/callback', tenantSite, lookup)).toBe(true);
    expect(await codeRedirectAllowed('http://localhost:8002/auth/callback', tenantSite, lookup)).toBe(false);
  });

  it('기본 화면은 다른 테넌트의 도메인으로 보내지 않는다 — 같은 admin-web 클라이언트에 테넌트 주소도 등록돼 있다', async () => {
    expect(await codeRedirectAllowed('http://rehearsal.localhost:8002/auth/callback', defaultSite, lookup)).toBe(false);
  });

  it('기본 화면은 테넌트 1 도메인·테넌트 도메인이 아닌 주소(쇼핑몰·앱)로는 지금처럼 보낸다', async () => {
    expect(await codeRedirectAllowed('http://localhost:8002/auth/callback', defaultSite, lookup)).toBe(true);
    expect(await codeRedirectAllowed('http://localhost:8000/callback', defaultSite, lookup)).toBe(true);
    expect(await codeRedirectAllowed('tauri://localhost/callback', defaultSite, lookup)).toBe(true);
  });

  it('기본 화면에서 조회가 실패하면 보내지 않는다(어느 테넌트 주소인지 모른다)', async () => {
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await codeRedirectAllowed('http://localhost:8000/callback', defaultSite, down)).toBe(false);
  });

  it('중립 오류 화면은 어디로도', async () => {
    expect(await codeRedirectAllowed('http://rehearsal.localhost:8002/auth/callback', { kind: 'unavailable' }, lookup)).toBe(false);
  });
});

describe('브랜드 조회 캐시 크기', () => {
  it('항목 수에 상한이 있다 — Host 헤더는 아무 값이나 올 수 있다', async () => {
    const lookup = jest.fn(lookupOf({}));
    const cached = cachedLookup(lookup, { ttlMs: 60_000, maxEntries: 2, now: () => 0 });
    await cached('a');
    await cached('b');
    await cached('c'); // a 가 밀려난다
    await cached('c');
    await cached('a');
    expect(lookup.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c', 'a']);
  });
});
