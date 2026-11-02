import { noNewDeadLetters, onlyOwnRows, refusedByTenantGate, tokenTenantOf } from './judge';
import type { ConsumerMetrics } from './target';

describe('refusedByTenantGate — 403 이 «테넌트 문»의 거절인가', () => {
  const GATE = '이 테넌트에서는 쓸 수 없는 기능입니다.';

  it('403 + 문의 문구면 통과', () => {
    expect(refusedByTenantGate({ status: 403, body: { message: GATE } }, GATE)).toEqual({ ok: true });
  });

  it('문구가 error 칸에 있어도 읽는다(admin-web 서버 자격증명 라우트의 모양)', () => {
    const r = refusedByTenantGate(
      { status: 403, body: { error: 'Not available for this tenant' } },
      'Not available for this tenant',
    );
    expect(r).toEqual({ ok: true });
  });

  it('문구가 한 겹 안쪽에 있어도 읽는다(notification 필터의 모양)', () => {
    const body = { statusCode: 403, message: { message: GATE, error: 'Forbidden', statusCode: 403 } };
    expect(refusedByTenantGate({ status: 403, body }, GATE)).toEqual({ ok: true });
  });

  it('200 이면 남의 테넌트 데이터가 나온 것이다', () => {
    const r = refusedByTenantGate({ status: 200, body: { items: [] } }, GATE);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain('200');
  });

  it('403 이어도 권한 거절이면 실패 — 문이 판정하지 않았다(권한만 있으면 열린다)', () => {
    const r = refusedByTenantGate({ status: 403, body: { message: 'Permission required' } }, GATE);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain('Permission required');
  });

  it('본문이 JSON 이 아니어도 죽지 않는다', () => {
    const r = refusedByTenantGate({ status: 502, body: '<html>Bad Gateway</html>' }, GATE);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain('502');
  });
});

describe('onlyOwnRows — 테넌트 2 목록에 테넌트 1 행이 없는가', () => {
  it('겹치지 않으면 통과', () => {
    expect(onlyOwnRows({ tenantOne: ['a', 'b'], tenantTwo: ['c'] })).toEqual({ ok: true });
  });

  it('겹치면 겹친 id 를 적는다 — 같은 DB 를 본 것이다', () => {
    const r = onlyOwnRows({ tenantOne: ['a', 'b'], tenantTwo: ['b', 'c'] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain('b');
  });

  it('테넌트 1 이 비어 있으면 겹침 판정이 무의미하다 — 실패로 본다', () => {
    const r = onlyOwnRows({ tenantOne: [], tenantTwo: [] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toContain('테넌트 1');
  });
});

describe('tokenTenantOf', () => {
  const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

  it('tenant 클레임을 읽는다(서명은 보지 않는다 — 판정은 서버들이 한다)', () => {
    expect(tokenTenantOf(jwt({ sub: 'u', tenant: '2' }))).toBe('2');
  });

  it('클레임이 없거나 JWT 가 아니면 undefined', () => {
    expect(tokenTenantOf(jwt({ sub: 'u' }))).toBeUndefined();
    expect(tokenTenantOf('not-a-jwt')).toBeUndefined();
  });
});

describe('noNewDeadLetters — DLQ 0 은 쓰기 뒤의 수집으로만 믿는다', () => {
  const SINCE = 1_000_000;
  const metrics = (over: Partial<ConsumerMetrics>): ConsumerMetrics => ({
    skippedOtherTenant: {},
    deadLettered: {},
    scrapedAt: {},
    unreachable: [],
    ...over,
  });
  const before = metrics({ deadLettered: { core: 2, wallet: 0 }, scrapedAt: { core: 1, wallet: 1 } });

  it('모든 앱이 기준 뒤에 수집됐고 오르지 않았으면 통과', () => {
    const after = metrics({ deadLettered: { core: 2, wallet: 0 }, scrapedAt: { core: SINCE, wallet: SINCE + 5 } });
    expect(noNewDeadLetters(before, after, SINCE)).toEqual({ ok: true });
  });

  it('수집이 기준보다 옛것인 앱이 있으면 «0» 이어도 초록이 아니다 — 아직 안 들어왔다', () => {
    const after = metrics({ deadLettered: { core: 2, wallet: 0 }, scrapedAt: { core: SINCE, wallet: SINCE - 1 } });
    const v = noNewDeadLetters(before, after, SINCE);
    expect(v.ok).toBe('skipped');
    expect(v.ok === 'skipped' && v.reason).toMatch(/wallet/);
  });

  it('오른 앱이 있으면 다른 앱이 덜 들어왔어도 실패다', () => {
    const after = metrics({ deadLettered: { core: 3, wallet: 0 }, scrapedAt: { core: SINCE, wallet: SINCE - 1 } });
    const v = noNewDeadLetters(before, after, SINCE);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.detail).toMatch(/core/);
  });

  it('기준값 뒤에 못 읽게 된 앱은 «안 들어옴»이다', () => {
    const after = metrics({ deadLettered: { core: 2 }, scrapedAt: { core: SINCE } });
    const v = noNewDeadLetters(before, after, SINCE);
    expect(v.ok === 'skipped' && v.reason).toMatch(/wallet/);
  });

  it('기준값을 못 읽은 소비 앱은 잴 수 없다', () => {
    const after = metrics({
      deadLettered: { core: 2, wallet: 0, search: 0 },
      scrapedAt: { core: SINCE, wallet: SINCE, search: SINCE },
    });
    const v = noNewDeadLetters({ ...before, unreachable: ['search'] }, after, SINCE);
    expect(v.ok === 'skipped' && v.reason).toMatch(/search/);
  });
});
