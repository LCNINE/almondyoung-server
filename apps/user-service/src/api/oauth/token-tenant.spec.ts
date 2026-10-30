import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { OAuthManager } from './oauth.manager';
import { OAuthReader } from './oauth.reader';
import { OAuthClientRow, OAuthRepository } from './oauth.repository';
import type { TokensService } from '../tokens/tokens.service';
import type { UsersService } from '../users/users.service';

/**
 * 토큰 테넌트 계약(멀티테넌트 05). OAuth 로 나가는 사람 토큰에는 `tenant` 가 실리고, 역할은 그 테넌트의 부여만 실린다.
 * - 웹 직원 앱(고정 테넌트 없음): 등록된 리디렉트 주소의 host → 테넌트 도메인 → 테넌트
 * - 고정 테넌트 앱(쇼핑몰 등): 클라이언트에 적힌 테넌트
 * - 준비·정지 테넌트로는 발급·갱신하지 않고, 갱신이 거절된 세션은 끊는다
 */

type Tenant = { id: string; status: 'preparing' | 'active' | 'suspended' };

const ADMIN_ONE = 'https://admin.one.test/auth/callback';
const ADMIN_TWO = 'https://admin.two.test/auth/callback';
const NOT_A_TENANT_DOMAIN = 'https://elsewhere.test/auth/callback';

const VERIFIER = 'verifier-12345678901234567890123456789012345';
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');

function makeClient(overrides: Partial<OAuthClientRow> = {}): OAuthClientRow {
  return {
    clientId: 'admin-web',
    clientType: 'confidential',
    clientSecretHash: 'hash',
    previousSecretHash: null,
    secretRotatedAt: null,
    redirectUris: [ADMIN_ONE, ADMIN_TWO, NOT_A_TENANT_DOMAIN],
    postLogoutRedirectUris: null,
    allowedScopes: ['openid', 'profile'],
    tenantId: null,
    isActive: true,
    deactivatedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function setup() {
  const tenants: Record<string, Tenant> = {
    '1': { id: '1', status: 'active' },
    '2': { id: '2', status: 'active' },
  };
  const domains: Record<string, string> = { 'admin.one.test': '1', 'admin.two.test': '2' };
  // 한 계정이 두 테넌트에서 서로 다른 역할을 받았다.
  const grants: Record<string, string[]> = { '1': ['admin', 'user'], '2': ['catalog_manager'] };

  let client = makeClient();
  const repo = {
    findActiveClientById: jest.fn(() => Promise.resolve(client)),
    insertAuthorizationCode: jest.fn().mockResolvedValue(undefined),
    findUnconsumedCode: jest.fn(),
    markCodeConsumed: jest.fn().mockResolvedValue(undefined),
    insertOAuthToken: jest.fn().mockResolvedValue({}),
    findOAuthTokenByRefresh: jest.fn(),
    findChildToken: jest.fn().mockResolvedValue(null),
    revokeTokenById: jest.fn().mockResolvedValue(undefined),
    revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
    revokeChain: jest.fn().mockResolvedValue(undefined),
    findTenantByHost: jest.fn((host: string) => Promise.resolve(domains[host] ? tenants[domains[host]] : null)),
    findTenantById: jest.fn((id: string) => Promise.resolve(tenants[id] ?? null)),
  };
  const reader = { getClientOrThrow: jest.fn(() => Promise.resolve(client)) } as unknown as OAuthReader;
  const jwtService = {
    signAsync: jest.fn().mockResolvedValue('signed-jwt'),
    verifyAsync: jest.fn(),
  } as unknown as jest.Mocked<JwtService>;
  const usersService = {
    findUserById: jest.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', loginId: 'a', username: 'u' }),
    getTokenRoleNames: jest.fn((_userId: string, tenantId: string) => Promise.resolve(grants[tenantId] ?? [])),
  } as unknown as jest.Mocked<UsersService>;
  const tokensService = { deleteAllTokens: jest.fn() } as unknown as TokensService;
  const dbService = { db: { transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})) } };
  const manager = new OAuthManager(
    dbService as never,
    repo as unknown as OAuthRepository,
    reader,
    jwtService,
    usersService,
    tokensService,
    { getOrThrow: jest.fn() } as never,
  );

  const accessPayload = () => {
    const call = jwtService.signAsync.mock.calls.find(
      ([payload]) => typeof payload === 'object' && payload !== null && 'client_id' in payload,
    );
    if (!call) throw new Error('access token was not signed');
    return call[0] as { tenant?: string; roles?: string[] };
  };

  const issueCode = (redirectUri: string) =>
    manager.issueAuthorizationCode({
      clientId: client.clientId,
      userId: '11111111-1111-1111-1111-111111111111',
      redirectUri,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    });

  const exchange = async (redirectUri: string) => {
    repo.findUnconsumedCode.mockResolvedValue({
      code: 'authcode',
      clientId: client.clientId,
      userId: 'u-1',
      redirectUri,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      scope: 'openid profile',
      nonce: null,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
    });
    return manager.issueToken({
      grantType: 'authorization_code',
      clientId: client.clientId,
      clientSecret: undefined,
      code: 'authcode',
      codeVerifier: VERIFIER,
      redirectUri,
    });
  };

  const refresh = (row: { tenantId: string | null }) => {
    repo.findOAuthTokenByRefresh.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-1',
      clientId: client.clientId,
      refreshToken: 'rt',
      scope: 'openid profile',
      isRevoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      rotatedFrom: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...row,
    });
    return manager.issueToken({ grantType: 'refresh_token', clientId: client.clientId, refreshToken: 'rt' });
  };

  return {
    repo,
    tenants,
    accessPayload,
    issueCode,
    exchange,
    refresh,
    useClient: (overrides: Partial<OAuthClientRow>) => {
      client = makeClient({ clientType: 'public', ...overrides });
    },
  };
}

describe('토큰 테넌트 — 웹 직원 앱은 등록된 리디렉트 주소의 host 가 테넌트를 정한다', () => {
  beforeEach(() => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('테넌트 1 관리자 주소로 받은 토큰에는 tenant = 1 과 테넌트 1 부여의 역할만 실린다', async () => {
    const t = setup();
    t.useClient({ tenantId: null });

    await t.exchange(ADMIN_ONE);

    expect(t.accessPayload()).toEqual(expect.objectContaining({ tenant: '1', roles: ['admin', 'user'] }));
    expect(t.repo.insertOAuthToken).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '1' }), expect.anything());
  });

  it('같은 클라이언트라도 테넌트 2 주소로 받은 토큰에는 테넌트 2 부여만 실린다', async () => {
    const t = setup();
    t.useClient({ tenantId: null });

    await t.exchange(ADMIN_TWO);

    expect(t.accessPayload()).toEqual(expect.objectContaining({ tenant: '2', roles: ['catalog_manager'] }));
  });

  it('등록은 됐지만 테넌트 도메인이 아닌 리디렉트로는 code 를 내주지 않는다', async () => {
    const t = setup();
    t.useClient({ tenantId: null });

    await expect(t.issueCode(NOT_A_TENANT_DOMAIN)).rejects.toThrow(/tenant domain/);
    expect(t.repo.insertAuthorizationCode).not.toHaveBeenCalled();
  });

  it('등록되지 않은 리디렉트로는 테넌트 도메인 host 라도 code 를 내주지 않는다', async () => {
    const t = setup();
    t.useClient({ tenantId: null, redirectUris: [ADMIN_ONE] });

    await expect(t.issueCode('https://admin.two.test/evil')).rejects.toThrow(/not registered/);
  });

  it('loopback 클라이언트는 들어온 포트가 아니라 등록된 주소의 host 로 테넌트를 정한다', async () => {
    const t = setup();
    t.useClient({ tenantId: null, redirectUris: ['http://127.0.0.1/callback'] });
    t.repo.findTenantByHost.mockImplementation((host: string) =>
      Promise.resolve(host === '127.0.0.1' ? t.tenants['2'] : t.tenants['1']),
    );

    await t.exchange('http://127.0.0.1:53111/callback');

    expect(t.repo.findTenantByHost).toHaveBeenCalledWith('127.0.0.1', expect.anything());
    expect(t.accessPayload().tenant).toBe('2');
  });
});

describe('토큰 테넌트 — 고정 테넌트 앱은 클라이언트에 적힌 테넌트를 쓴다', () => {
  beforeEach(() => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('쇼핑몰(테넌트 1) 토큰에는 리디렉트 host 와 상관없이 테넌트 1 부여만 실린다', async () => {
    const t = setup();
    // 리디렉트 host 가 테넌트 2 도메인이어도 고정 테넌트가 이긴다.
    t.useClient({ clientId: 'medusa-storefront', tenantId: '1', redirectUris: [ADMIN_TWO] });

    await t.exchange(ADMIN_TWO);

    expect(t.accessPayload()).toEqual(expect.objectContaining({ tenant: '1', roles: ['admin', 'user'] }));
    expect(t.accessPayload().roles).not.toContain('catalog_manager');
  });

  it('테넌트 2 고정 앱 토큰에는 테넌트 1 부여가 실리지 않는다', async () => {
    const t = setup();
    t.useClient({ clientId: 'tenant-two-app', tenantId: '2', redirectUris: ['https://shop.two.test/cb'] });

    await t.exchange('https://shop.two.test/cb');

    expect(t.accessPayload()).toEqual(expect.objectContaining({ tenant: '2', roles: ['catalog_manager'] }));
  });
});

describe('토큰 테넌트 — 갱신은 같은 테넌트로만 한다', () => {
  beforeEach(() => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('세션에 적힌 테넌트로 갱신하고 새 세션에도 같은 테넌트를 적는다', async () => {
    const t = setup();
    t.useClient({ tenantId: null });

    await t.refresh({ tenantId: '2' });

    expect(t.accessPayload()).toEqual(expect.objectContaining({ tenant: '2', roles: ['catalog_manager'] }));
    expect(t.repo.insertOAuthToken).toHaveBeenCalledWith(expect.objectContaining({ tenantId: '2' }), expect.anything());
  });

  it('테넌트 칸 전에 나간 세션은 등록 주소들이 가리키는 테넌트가 하나일 때만 그 테넌트로 갱신한다', async () => {
    const t = setup();
    t.useClient({ tenantId: null, redirectUris: [ADMIN_ONE] });

    await t.refresh({ tenantId: null });

    expect(t.accessPayload().tenant).toBe('1');
  });

  it('테넌트 칸 전에 나간 세션인데 등록 주소가 두 테넌트를 가리키면 갱신하지 않고 세션을 끊는다', async () => {
    const t = setup();
    t.useClient({ tenantId: null, redirectUris: [ADMIN_ONE, ADMIN_TWO] });

    await expect(t.refresh({ tenantId: null })).rejects.toThrow(/tenant/);
    expect(t.repo.revokeChain).toHaveBeenCalledWith('rt-1', expect.anything());
    expect(t.repo.insertOAuthToken).not.toHaveBeenCalled();
  });
});

describe('토큰 테넌트 — 준비·정지 테넌트로는 발급·갱신하지 않는다', () => {
  beforeEach(() => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['preparing', 'suspended'] as const)('%s 테넌트 주소로는 code 를 내주지 않는다', async (status) => {
    const t = setup();
    t.useClient({ tenantId: null });
    t.tenants['2'].status = status;

    await expect(t.issueCode(ADMIN_TWO)).rejects.toThrow(/not active/);
    expect(t.repo.insertAuthorizationCode).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'suspended'] as const)('%s 테넌트로 code 를 교환하면 거절한다', async (status) => {
    const t = setup();
    t.useClient({ tenantId: null });
    t.tenants['2'].status = status;

    await expect(t.exchange(ADMIN_TWO)).rejects.toThrow(/not active/);
    expect(t.repo.insertOAuthToken).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'suspended'] as const)('%s 테넌트 세션은 갱신하지 않고 끊는다', async (status) => {
    const t = setup();
    t.useClient({ tenantId: null });
    t.tenants['2'].status = status;

    await expect(t.refresh({ tenantId: '2' })).rejects.toThrow(/not active/);
    expect(t.repo.revokeChain).toHaveBeenCalledWith('rt-1', expect.anything());
    expect(t.repo.insertOAuthToken).not.toHaveBeenCalled();
  });

  it('고정 테넌트 앱도 그 테넌트가 정지면 발급하지 않는다', async () => {
    const t = setup();
    t.useClient({ clientId: 'tenant-two-app', tenantId: '2', redirectUris: ['https://shop.two.test/cb'] });
    t.tenants['2'].status = 'suspended';

    await expect(t.exchange('https://shop.two.test/cb')).rejects.toThrow(/not active/);
  });
});
