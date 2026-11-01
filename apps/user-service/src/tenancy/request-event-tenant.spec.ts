import { parseTenantList } from '@app/tenancy';
import { requestEventTenant } from './request-event-tenant';

const tenants = parseTenantList(
  JSON.stringify([
    { id: '1', slug: 'one', coreDb: 'core', publicBucket: 'bucket-one', privateBucket: 'bucket-one' },
    { id: '2', slug: 'two', coreDb: 'core_two', publicBucket: 'bucket-two-pub', privateBucket: 'bucket-two-priv' },
  ]),
);

const internalToken = { id: 'u1', aud: 'user-service-internal', tenant: '1' };
const tenantTwoAdminToken = { id: 'u1', aud: 'admin-web', tenant: '2' };

/**
 * user-service 가 내는 테넌트 이벤트의 테넌트 = «그 일이 일어난 화면의 테넌트». 정하지 못하면 undefined 이고,
 * 봉투 찍기가 앱 설정 T 로 떨어진다. 이 판정은 맥락만 세운다 — 거절은 기존 가드(인증·ServedTenantGuard)의 몫이다.
 */
describe('requestEventTenant — user-service 요청의 이벤트 테넌트', () => {
  it('쇼핑몰(내부 토큰, 헤더 없음)의 비밀번호 변경은 토큰 테넌트 1 이다', () => {
    expect(requestEventTenant({ entry: 'token', user: internalToken, header: undefined, vouched: false }, tenants)).toBe(
      '1',
    );
  });

  it('테넌트 2 셸의 관리자 토큰은 2 다', () => {
    expect(
      requestEventTenant({ entry: 'token', user: tenantTwoAdminToken, header: undefined, vouched: false }, tenants),
    ).toBe('2');
  });

  it('테넌트 auth-web 이 내부 비밀과 함께 실은 헤더가 내부 토큰(1)을 이긴다 — 첫 로그인 비밀번호 변경이 2 로 찍힌다', () => {
    expect(requestEventTenant({ entry: 'token', user: internalToken, header: '2', vouched: true }, tenants)).toBe('2');
  });

  it('비밀 없이 토큰과 다른 헤더가 오면 헤더를 무시하고 토큰을 따른다 — 아무나 테넌트 1 고객의 보안 메일을 끄지 못한다', () => {
    expect(requestEventTenant({ entry: 'token', user: internalToken, header: '2', vouched: false }, tenants)).toBe('1');
  });

  it('내부 키 라우트는 호출자의 테넌트 헤더다', () => {
    expect(requestEventTenant({ entry: 'service', user: undefined, header: '2', vouched: false }, tenants)).toBe('2');
  });

  it('@Public(가입 콜백 등)은 맥락이 없다 — 헤더를 실어도, 비밀이 맞아도 T 로 떨어진다', () => {
    expect(requestEventTenant({ entry: 'public', user: undefined, header: '2', vouched: false }, tenants)).toBeUndefined();
    expect(requestEventTenant({ entry: 'public', user: undefined, header: '2', vouched: true }, tenants)).toBeUndefined();
  });

  it('클레임 없는 토큰은 맥락이 없다', () => {
    expect(
      requestEventTenant({ entry: 'token', user: { id: 'u1' }, header: undefined, vouched: false }, tenants),
    ).toBeUndefined();
  });

  it('목록에 없는 값은 맥락으로 쓰지 않는다 — 비밀이 맞아도', () => {
    expect(requestEventTenant({ entry: 'token', user: internalToken, header: '9', vouched: true }, tenants)).toBe('1');
    expect(requestEventTenant({ entry: 'service', user: undefined, header: '9', vouched: false }, tenants)).toBeUndefined();
    expect(
      requestEventTenant({ entry: 'token', user: { tenant: '9' }, header: undefined, vouched: false }, tenants),
    ).toBeUndefined();
  });
});
