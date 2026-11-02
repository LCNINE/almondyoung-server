// my-auth 는 user-service 내부 세션 토큰으로 Medusa 에 들어오는 입구다(`master`/`admin` 이면 관리자 actor).
// 계정은 한 테넌트의 것이라(ADR 0056) 토큰 테넌트가 이 Medusa 의 T 가 아니면 들이지 않는다.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({})),
  jwtVerify: jest.fn(),
}));

import { jwtVerify } from 'jose';
import { AuthProviderService } from '../service';

const mockedVerify = jwtVerify as jest.Mock;

const input = { headers: { authorization: 'Bearer internal-token' } } as any;
const makeIdSvc = () =>
  ({
    retrieve: jest.fn(async () => ({ id: 'ai-1', app_metadata: {} })),
  }) as any;

describe('AuthProviderService.authenticate — 토큰 테넌트', () => {
  const original = { tenant: process.env.SERVED_TENANT_ID, issuer: process.env.OIDC_ISSUER_URL };
  beforeEach(() => {
    process.env.SERVED_TENANT_ID = '1';
    process.env.OIDC_ISSUER_URL = 'https://idp.example.com';
    mockedVerify.mockReset();
  });
  afterEach(() => {
    for (const [key, value] of [
      ['SERVED_TENANT_ID', original.tenant],
      ['OIDC_ISSUER_URL', original.issuer],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('토큰 테넌트가 T 면 들인다', async () => {
    mockedVerify.mockResolvedValue({ payload: { sub: 'u-1', email: 'a@example.com', roles: ['admin'], tenant: '1' } });
    const idSvc = makeIdSvc();

    const res = await new AuthProviderService({}).authenticate(input, idSvc);

    expect(res.success).toBe(true);
    expect(res.authIdentity?.app_metadata?.actor_type).toBe('user');
  });

  it('다른 테넌트의 토큰은 관리자 역할이 있어도 들이지 않는다', async () => {
    mockedVerify.mockResolvedValue({ payload: { sub: 'u-1', email: 'a@example.com', roles: ['master'], tenant: '2' } });
    const idSvc = makeIdSvc();

    const res = await new AuthProviderService({}).authenticate(input, idSvc);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/tenant/);
    expect(idSvc.retrieve).not.toHaveBeenCalled();
  });

  it('tenant 클레임이 없는 토큰은 들이지 않는다', async () => {
    mockedVerify.mockResolvedValue({ payload: { sub: 'u-1', email: 'a@example.com', roles: ['admin'] } });
    const idSvc = makeIdSvc();

    const res = await new AuthProviderService({}).authenticate(input, idSvc);

    expect(res.success).toBe(false);
    expect(idSvc.retrieve).not.toHaveBeenCalled();
  });
});
