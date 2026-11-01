import { admitsToken, oidcEndpointsFor, requestHostFrom, resolveAdminSite, type AdminSite, type AdminSiteRecord } from './site-rules';

const DEFAULT = 'https://admin.example.test';
const tenantTwo: AdminSiteRecord = {
  tenantId: '2',
  displayName: '리허설 상사',
  logoUrl: null,
  active: true,
  authHost: 'login.tenant.test',
};
const lookupOf =
  (records: Record<string, AdminSiteRecord>) =>
  async (host: string): Promise<AdminSiteRecord | null> =>
    records[host] ?? null;

describe('resolveAdminSite — the address decides the shell', () => {
  it('serves the existing shell on the default address without asking anyone', async () => {
    const lookup = jest.fn();
    expect(await resolveAdminSite('ADMIN.example.test', DEFAULT, lookup)).toEqual({ kind: 'default' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("serves the tenant shell on an active tenant's admin address, signing in at that tenant's auth address", async () => {
    expect(await resolveAdminSite('wms.tenant.test', DEFAULT, lookupOf({ 'wms.tenant.test': tenantTwo }))).toEqual({
      kind: 'tenant',
      origin: 'https://wms.tenant.test',
      authOrigin: 'https://login.tenant.test',
      tenantId: '2',
      displayName: '리허설 상사',
      logoUrl: null,
    });
  });

  it("serves the existing shell on another address of tenant 1", async () => {
    const tenantOne = { ...tenantTwo, tenantId: '1', authHost: null };
    expect(await resolveAdminSite('old-admin.example.test', DEFAULT, lookupOf({ 'old-admin.example.test': tenantOne }))).toEqual({
      kind: 'default',
    });
  });

  it.each([
    ['an unknown address', null, lookupOf({})],
    ['a tenant that is not active', 'wms.tenant.test', lookupOf({ 'wms.tenant.test': { ...tenantTwo, active: false } })],
    ['a tenant without an auth-web address', 'wms.tenant.test', lookupOf({ 'wms.tenant.test': { ...tenantTwo, authHost: null } })],
    [
      'a failed lookup',
      'wms.tenant.test',
      async () => {
        throw new Error('user-service down');
      },
    ],
  ])('shows a neutral page (no brand) for %s', async (_label, host, lookup) => {
    expect(await resolveAdminSite(host ?? 'nobody.test', DEFAULT, lookup)).toEqual({ kind: 'unavailable' });
  });

  it('shows a neutral page when the request has no host', async () => {
    expect(await resolveAdminSite(null, DEFAULT, lookupOf({}))).toEqual({ kind: 'unavailable' });
    expect(await resolveAdminSite('  ', DEFAULT, lookupOf({}))).toEqual({ kind: 'unavailable' });
  });
});

describe('admitsToken — the token tenant must be the address tenant', () => {
  const tenantShell: AdminSite = {
    kind: 'tenant',
    origin: 'https://wms.tenant.test',
    authOrigin: 'https://login.tenant.test',
    tenantId: '2',
    displayName: '리허설 상사',
    logoUrl: null,
  };

  it("lets the tenant's own token into the tenant shell", () => {
    expect(admitsToken(tenantShell, '2', 'warn')).toBe(true);
  });

  it.each([
    ['an Almondyoung (tenant 1) token', '1'],
    ['another tenant token', '3'],
    ['a token without a tenant, even in warn mode', undefined],
  ])('refuses %s in the tenant shell', (_label, tenant) => {
    expect(admitsToken(tenantShell, tenant, 'warn')).toBe(false);
  });

  it('lets a tenant 1 token into the existing shell', () => {
    expect(admitsToken({ kind: 'default' }, '1', 'reject')).toBe(true);
  });

  it('refuses a tenant 2 token in the existing shell', () => {
    expect(admitsToken({ kind: 'default' }, '2', 'warn')).toBe(false);
  });

  it('lets a token without a tenant into the existing shell only in warn mode', () => {
    expect(admitsToken({ kind: 'default' }, undefined, 'warn')).toBe(true);
    expect(admitsToken({ kind: 'default' }, undefined, 'reject')).toBe(false);
    expect(admitsToken({ kind: 'default' }, undefined, undefined)).toBe(false);
  });

  it('refuses everything on a neutral page', () => {
    expect(admitsToken({ kind: 'unavailable' }, '1', 'warn')).toBe(false);
  });
});

describe('oidcEndpointsFor — sign-in and sign-out go back to the address the person came in on', () => {
  const env = {
    authorizationUrl: 'https://auth.example.test/oauth/authorize',
    redirectUri: 'https://admin.example.test/auth/callback',
    postLogoutRedirectUri: 'https://admin.example.test/login',
  };

  it('keeps the configured addresses on the existing shell', () => {
    expect(oidcEndpointsFor({ kind: 'default' }, env)).toEqual(env);
  });

  it("uses the tenant's auth address and the tenant admin address on the tenant shell", () => {
    const site: AdminSite = {
      kind: 'tenant',
      origin: 'https://wms.tenant.test',
      authOrigin: 'https://login.tenant.test',
      tenantId: '2',
      displayName: '리허설 상사',
      logoUrl: null,
    };
    expect(oidcEndpointsFor(site, env)).toEqual({
      authorizationUrl: 'https://login.tenant.test/oauth/authorize',
      redirectUri: 'https://wms.tenant.test/auth/callback',
      postLogoutRedirectUri: 'https://wms.tenant.test/login',
    });
  });

  it('has no addresses on a neutral page', () => {
    expect(oidcEndpointsFor({ kind: 'unavailable' }, env)).toBeNull();
  });
});

describe('requestHostFrom', () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

  it('prefers the host the tenant distribution forwarded', () => {
    expect(requestHostFrom(headers({ 'x-forwarded-host': 'wms.tenant.test, edge', host: 'fn.lambda-url.test' }))).toBe(
      'wms.tenant.test'
    );
  });

  it('falls back to Host', () => {
    expect(requestHostFrom(headers({ host: 'admin.example.test' }))).toBe('admin.example.test');
    expect(requestHostFrom(headers({}))).toBeNull();
  });
});
