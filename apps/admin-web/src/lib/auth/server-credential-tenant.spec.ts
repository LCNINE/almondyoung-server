import { decideServerCredentialTenant, readServerCredentialTenantConfig } from './server-credential-tenant';

const T = '1';
const warn = { tenantId: T, gateMode: 'warn' as const };
const reject = { tenantId: T, gateMode: 'reject' as const };

describe('서버 자격증명 라우트의 테넌트 판정', () => {
  it.each([warn, reject])('토큰 테넌트가 T 면 통과하고, 업스트림에 T 를 싣는다 (%o)', (config) => {
    expect(decideServerCredentialTenant('1', config)).toEqual({ admit: true, tenantId: '1', untenanted: false });
  });

  it.each([warn, reject])('남의 테넌트 토큰은 두 모드 모두 403 이다 (%o)', (config) => {
    expect(decideServerCredentialTenant('2', config)).toEqual({ admit: false, status: 403, reason: 'other-tenant' });
  });

  it('테넌트 없는 토큰(클레임 전에 나간 토큰)은 warn 에서 통과하되 셈 대상이고, 업스트림에는 T 를 싣는다', () => {
    expect(decideServerCredentialTenant(undefined, warn)).toEqual({ admit: true, tenantId: '1', untenanted: true });
  });

  it('테넌트 없는 토큰은 reject 에서 403 이다', () => {
    expect(decideServerCredentialTenant(undefined, reject)).toEqual({ admit: false, status: 403, reason: 'untenanted' });
  });

  it('설정이 없으면 판정하지 않고 닫는다(503)', () => {
    expect(decideServerCredentialTenant('1', null)).toEqual({ admit: false, status: 503, reason: 'not-configured' });
  });
});

describe('판정 설정 읽기', () => {
  it('T 와 전환 모드를 읽는다', () => {
    expect(readServerCredentialTenantConfig({ SERVER_CREDENTIAL_TENANT_ID: ' 1 ', TENANT_GATE_MODE: 'reject' })).toEqual(
      reject,
    );
  });

  it.each([
    [{ TENANT_GATE_MODE: 'warn' }],
    [{ SERVER_CREDENTIAL_TENANT_ID: '', TENANT_GATE_MODE: 'warn' }],
    [{ SERVER_CREDENTIAL_TENANT_ID: '1' }],
    [{ SERVER_CREDENTIAL_TENANT_ID: '1', TENANT_GATE_MODE: 'off' }],
  ])('기본값이 없다 — 빠지거나 모르는 값이면 null (%o)', (env) => {
    expect(readServerCredentialTenantConfig(env)).toBeNull();
  });
});
