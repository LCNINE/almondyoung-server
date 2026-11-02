// 계정은 한 테넌트의 것이라(ADR 0056) 다른 테넌트의 같은 이메일 계정이 이 Medusa(T)의 고객에 이어지면 안 된다.
// 콜백은 access_token 의 tenant 가 T 일 때만 auth identity 를 만들거나 고친다.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => ({})),
  jwtVerify: jest.fn(),
}));

import { jwtVerify } from 'jose';
import { UserServiceSsoProviderService } from '../service';

const baseOptions = {
  issuerUrl: 'https://idp.example.com',
  clientId: 'medusa-storefront',
  clientSecret: 'secret-123',
  authWebUrl: 'https://auth.example.com',
  defaultCallbackUrl: 'https://shop.example.com/kr/callback/oidc',
};

const fakeLogger: any = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const mockedVerify = jwtVerify as jest.Mock;

// 토큰 문자열마다 검증 결과(payload)를 정한다.
const givenTokens = (claims: { id: Record<string, unknown>; access: Record<string, unknown> }) => {
  mockedVerify.mockImplementation(async (token: string) => {
    if (token === 'id-token') return { payload: claims.id };
    if (token === 'access-token') return { payload: claims.access };
    throw new Error(`unexpected token ${token}`);
  });
};

const setup = () => {
  const svc = new UserServiceSsoProviderService({ logger: fakeLogger }, baseOptions as any);
  jest.spyOn(svc as any, 'exchangeCode').mockResolvedValue({
    access_token: 'access-token',
    id_token: 'id-token',
    refresh_token: 'refresh-token',
    token_type: 'Bearer',
    expires_in: 900,
  });
  const notFound = Object.assign(new Error('not found'), { type: 'not_found' });
  const idSvc: any = {
    getState: jest.fn(async () => ({
      code_verifier: 'v',
      callback_url: baseOptions.defaultCallbackUrl,
      created_at: 0,
    })),
    retrieve: jest.fn(async () => {
      throw notFound;
    }),
    create: jest.fn(async (input: Record<string, unknown>) => ({ id: 'ai-1', ...input })),
    update: jest.fn(),
  };
  return { svc, idSvc };
};

const callback = { query: { code: 'c', state: 's' } } as any;
const idClaims = { sub: 'u-1', email: 'a@example.com', email_verified: true, name: '홍길동' };

describe('UserServiceSsoProviderService.validateCallback — 토큰 테넌트', () => {
  const original = process.env.SERVED_TENANT_ID;
  beforeEach(() => {
    process.env.SERVED_TENANT_ID = '1';
    mockedVerify.mockReset();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SERVED_TENANT_ID;
    else process.env.SERVED_TENANT_ID = original;
  });

  it('access_token 의 tenant 가 T 면 auth identity 를 만든다', async () => {
    givenTokens({ id: idClaims, access: { sub: 'u-1', tenant: '1' } });
    const { svc, idSvc } = setup();

    const res = await svc.validateCallback(callback, idSvc);

    expect(res.success).toBe(true);
    expect(idSvc.create).toHaveBeenCalled();
    // access_token 도 이 클라이언트를 audience 로 검증한다.
    expect(mockedVerify).toHaveBeenCalledWith(
      'access-token',
      expect.anything(),
      expect.objectContaining({ issuer: baseOptions.issuerUrl, audience: baseOptions.clientId }),
    );
  });

  it('다른 테넌트의 토큰이면 거절하고 auth identity 를 건드리지 않는다', async () => {
    givenTokens({ id: idClaims, access: { sub: 'u-1', tenant: '2' } });
    const { svc, idSvc } = setup();

    const res = await svc.validateCallback(callback, idSvc);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/tenant/);
    expect(idSvc.retrieve).not.toHaveBeenCalled();
    expect(idSvc.create).not.toHaveBeenCalled();
    expect(idSvc.update).not.toHaveBeenCalled();
  });

  it('access_token 에 tenant 가 없으면 거절한다', async () => {
    givenTokens({ id: idClaims, access: { sub: 'u-1' } });
    const { svc, idSvc } = setup();

    const res = await svc.validateCallback(callback, idSvc);

    expect(res.success).toBe(false);
    expect(idSvc.create).not.toHaveBeenCalled();
  });

  it('access_token 과 id_token 의 sub 가 다르면 거절한다', async () => {
    givenTokens({ id: idClaims, access: { sub: 'u-2', tenant: '1' } });
    const { svc, idSvc } = setup();

    const res = await svc.validateCallback(callback, idSvc);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/sub/);
    expect(idSvc.create).not.toHaveBeenCalled();
  });

  it('access_token 검증이 실패하면 거절한다', async () => {
    mockedVerify.mockImplementation(async (token: string) => {
      if (token === 'id-token') return { payload: idClaims };
      throw new Error('signature verification failed');
    });
    const { svc, idSvc } = setup();

    const res = await svc.validateCallback(callback, idSvc);

    expect(res.success).toBe(false);
    expect(idSvc.create).not.toHaveBeenCalled();
  });

  it('T 가 없으면 거절한다', async () => {
    delete process.env.SERVED_TENANT_ID;
    givenTokens({ id: idClaims, access: { sub: 'u-1', tenant: '1' } });
    const { svc, idSvc } = setup();

    const res = await svc.validateCallback(callback, idSvc);

    expect(res.success).toBe(false);
    expect(idSvc.create).not.toHaveBeenCalled();
  });
});
