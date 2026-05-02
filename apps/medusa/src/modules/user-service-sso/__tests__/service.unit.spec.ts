import { UserServiceSsoProviderService } from '../service';

const baseOptions = {
  issuerUrl: 'https://idp.example.com',
  clientId: 'medusa-storefront',
  clientSecret: 'secret-123',
  authWebUrl: 'https://auth.example.com',
  defaultCallbackUrl: 'https://shop.example.com/kr/callback/oidc',
};

const fakeLogger: any = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

const makeAuthIdentitySvc = () => {
  const states = new Map<string, Record<string, unknown>>();
  return {
    setState: jest.fn(async (k: string, v: Record<string, unknown>) => {
      states.set(k, v);
    }),
    getState: jest.fn(async (k: string) => states.get(k) ?? null),
    retrieve: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    states,
  } as any;
};

describe('UserServiceSsoProviderService.validateOptions', () => {
  it('requires issuerUrl, clientId, clientSecret, authWebUrl', () => {
    expect(() => UserServiceSsoProviderService.validateOptions({} as any)).toThrow();
    expect(() =>
      UserServiceSsoProviderService.validateOptions({ issuerUrl: 'x', clientId: 'y' } as any),
    ).toThrow();
    expect(() => UserServiceSsoProviderService.validateOptions(baseOptions as any)).not.toThrow();
  });
});

describe('UserServiceSsoProviderService.authenticate', () => {
  it('returns authorize URL with PKCE params and stores code_verifier in state', async () => {
    const svc = new UserServiceSsoProviderService({ logger: fakeLogger }, baseOptions as any);
    const idSvc = makeAuthIdentitySvc();

    const res = await svc.authenticate({ body: {}, query: {} } as any, idSvc);

    expect(res.success).toBe(true);
    expect(typeof res.location).toBe('string');

    const url = new URL(res.location!);
    expect(url.origin + url.pathname).toBe('https://auth.example.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('medusa-storefront');
    expect(url.searchParams.get('redirect_uri')).toBe(baseOptions.defaultCallbackUrl);
    expect(url.searchParams.get('scope')).toContain('openid');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')?.length).toBeGreaterThan(20);

    const stateKey = url.searchParams.get('state')!;
    expect(stateKey).toBeTruthy();
    expect(idSvc.setState).toHaveBeenCalled();
    const stored = idSvc.states.get(stateKey)!;
    expect(stored.code_verifier).toBeTruthy();
    expect(stored.callback_url).toBe(baseOptions.defaultCallbackUrl);
  });

  it('fails when no callback_url is provided and no default', async () => {
    const svc = new UserServiceSsoProviderService(
      { logger: fakeLogger },
      { ...baseOptions, defaultCallbackUrl: undefined } as any,
    );
    const idSvc = makeAuthIdentitySvc();
    const res = await svc.authenticate({ body: {}, query: {} } as any, idSvc);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/callback_url/);
  });
});

describe('UserServiceSsoProviderService.validateCallback', () => {
  it('rejects when state is missing', async () => {
    const svc = new UserServiceSsoProviderService({ logger: fakeLogger }, baseOptions as any);
    const idSvc = makeAuthIdentitySvc();
    const res = await svc.validateCallback({ query: { code: 'abc' } } as any, idSvc);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/state/);
  });

  it('rejects when state is unknown (expired or forged)', async () => {
    const svc = new UserServiceSsoProviderService({ logger: fakeLogger }, baseOptions as any);
    const idSvc = makeAuthIdentitySvc();
    const res = await svc.validateCallback({ query: { code: 'abc', state: 'unknown' } } as any, idSvc);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/state|session/i);
  });

  it('returns provider error when query.error is present', async () => {
    const svc = new UserServiceSsoProviderService({ logger: fakeLogger }, baseOptions as any);
    const idSvc = makeAuthIdentitySvc();
    const res = await svc.validateCallback(
      { query: { error: 'access_denied', error_description: 'user cancelled' } } as any,
      idSvc,
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cancelled|access_denied/);
  });
});
