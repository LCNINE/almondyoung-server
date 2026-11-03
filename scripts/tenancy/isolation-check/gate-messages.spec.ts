import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GATE_MESSAGES, INVALID_CREDENTIALS, NOT_IN_TOKEN_TENANT, TENANT_NOT_ISSUABLE } from './checks';

/**
 * 실측은 403 을 «문의 문구»로 구별한다(`judge.refusedByTenantGate`). 문구가 바뀌면 실측이 «문이 판정하지 않았다»로
 * 빨개지는데, 그건 거짓 경보다 — 여기서 먼저 잡는다. 문구를 바꿨으면 checks.ts 의 GATE_MESSAGES 도 함께 바꾼다.
 */
const ROOT = join(__dirname, '../../..');
const SOURCES: Record<keyof typeof GATE_MESSAGES, string> = {
  servedTenant: 'libs/authorization/src/services/served-tenant-gate.ts',
  serverCredential: 'apps/admin-web/src/lib/auth/server-credential-tenant.server.ts',
  fileAccess: 'apps/file-service/src/access/file-access.ts',
  coreSuspended: 'apps/core/src/platform/tenancy/core-request-tenant.interceptor.ts',
};

describe('격리 실측이 기다리는 문의 문구', () => {
  it.each(Object.entries(SOURCES))('%s 의 문구가 그 문의 소스에 있다', (key, file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(GATE_MESSAGES[key as keyof typeof GATE_MESSAGES]);
  });

  it('로그인 거절 문구가 user-service 로그인에 있다', () => {
    expect(readFileSync(join(ROOT, 'apps/user-service/src/api/auth/auth.service.ts'), 'utf8')).toContain(
      INVALID_CREDENTIALS,
    );
  });

  it('다른 테넌트 계정의 코드 발급 거절 문구가 user-service 에 있다', () => {
    expect(readFileSync(join(ROOT, 'apps/user-service/src/api/oauth/oauth.manager.ts'), 'utf8')).toContain(
      `BadRequestError('${NOT_IN_TOKEN_TENANT}')`,
    );
  });

  it('정지·준비 테넌트의 발급 거절 문구가 user-service 에 있다', () => {
    expect(readFileSync(join(ROOT, 'apps/user-service/src/api/oauth/oauth.manager.ts'), 'utf8')).toContain(
      TENANT_NOT_ISSUABLE,
    );
  });
});
