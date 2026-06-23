import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuthManager } from './oauth.manager';
import { OAuthReader } from './oauth.reader';
import { OAuthRepository, OAuthClientRow } from './oauth.repository';
import type { TokensService } from '../tokens/tokens.service';
import type { UsersService } from '../users/users.service';

type RepoMock = jest.Mocked<
  Pick<
    OAuthRepository,
    | 'findActiveClientById'
    | 'insertAuthorizationCode'
    | 'findUnconsumedCode'
    | 'markCodeConsumed'
    | 'insertOAuthToken'
    | 'findOAuthTokenByRefresh'
    | 'findChildToken'
    | 'revokeTokenById'
    | 'revokeAllUserTokens'
    | 'revokeChain'
  >
>;

function makeClient(overrides: Partial<OAuthClientRow> = {}): OAuthClientRow {
  return {
    clientId: 'admin-web',
    clientType: 'public',
    clientSecretHash: 'hash',
    previousSecretHash: null,
    secretRotatedAt: null,
    redirectUris: ['https://admin.example.com/auth/callback'],
    postLogoutRedirectUris: ['https://admin.example.com/login'],
    allowedScopes: ['openid', 'profile'],
    isActive: true,
    deactivatedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('OAuthManager — nonce propagation', () => {
  let repo: RepoMock;
  let reader: OAuthReader;
  let jwtService: jest.Mocked<JwtService>;
  let usersService: jest.Mocked<UsersService>;
  let tokensService: jest.Mocked<TokensService>;
  let configService: { getOrThrow: jest.Mock };
  let dbService: { db: { transaction: jest.Mock } };
  let manager: OAuthManager;

  beforeEach(() => {
    repo = {
      findActiveClientById: jest.fn(),
      insertAuthorizationCode: jest.fn().mockResolvedValue(undefined),
      findUnconsumedCode: jest.fn(),
      markCodeConsumed: jest.fn().mockResolvedValue(undefined),
      insertOAuthToken: jest.fn().mockResolvedValue({}),
      findOAuthTokenByRefresh: jest.fn(),
      findChildToken: jest.fn().mockResolvedValue(null),
      revokeTokenById: jest.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
      revokeChain: jest.fn().mockResolvedValue(undefined),
    } as unknown as RepoMock;

    reader = {
      getClientOrThrow: jest.fn(),
    } as unknown as OAuthReader;

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt'),
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    usersService = {
      findUserById: jest.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', nickname: 'n', username: 'u' }),
      getUserRoleNames: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<UsersService>;

    tokensService = {
      deleteAllTokens: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TokensService>;

    configService = {
      getOrThrow: jest.fn().mockReturnValue('handoff-secret'),
    };

    // tx 호출은 inline 실행 (실제 트랜잭션 없이 fn 그대로 호출)
    dbService = {
      db: {
        transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
      },
    };

    manager = new OAuthManager(
      dbService as never,
      repo as unknown as OAuthRepository,
      reader,
      jwtService,
      usersService,
      tokensService,
      configService as never,
    );
  });

  describe('issueAuthorizationCode', () => {
    it('nonce 가 주어지면 repo.insertAuthorizationCode 에 그대로 전달된다', async () => {
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(makeClient());

      await manager.issueAuthorizationCode({
        clientId: 'admin-web',
        userId: '11111111-1111-1111-1111-111111111111',
        redirectUri: 'https://admin.example.com/auth/callback',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        scope: 'openid profile',
        nonce: 'rp-supplied-nonce-abc',
      });

      expect(repo.insertAuthorizationCode).toHaveBeenCalledTimes(1);
      const call = repo.insertAuthorizationCode.mock.calls[0][0];
      expect(call.nonce).toBe('rp-supplied-nonce-abc');
      expect(call.scope).toBe('openid profile');
    });

    it('nonce 가 없으면 null 로 저장된다', async () => {
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(makeClient());

      await manager.issueAuthorizationCode({
        clientId: 'admin-web',
        userId: '11111111-1111-1111-1111-111111111111',
        redirectUri: 'https://admin.example.com/auth/callback',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
      });

      const call = repo.insertAuthorizationCode.mock.calls[0][0];
      expect(call.nonce).toBeNull();
    });
  });

  describe('exchangeCodeForToken (id_token nonce echo)', () => {
    const VERIFIER = 'verifier-12345678901234567890123456789012345';
    // S256: base64url(sha256(verifier))
    const CHALLENGE = require('crypto').createHash('sha256').update(VERIFIER).digest('base64url');

    function setupCode(overrides: Partial<{ nonce: string | null; scope: string | null }> = {}) {
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(makeClient());
      repo.findUnconsumedCode.mockResolvedValue({
        code: 'authcode',
        clientId: 'admin-web',
        userId: 'u-1',
        redirectUri: 'https://admin.example.com/auth/callback',
        codeChallenge: CHALLENGE,
        codeChallengeMethod: 'S256',
        scope: overrides.scope === undefined ? 'openid profile' : overrides.scope,
        nonce: overrides.nonce === undefined ? 'rp-supplied-nonce-abc' : overrides.nonce,
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: null,
        createdAt: new Date(),
      } as never);
    }

    it('저장된 nonce 가 id_token payload 에 echo 된다', async () => {
      setupCode();

      await manager.issueToken({
        grantType: 'authorization_code',
        clientId: 'admin-web',
        code: 'authcode',
        codeVerifier: VERIFIER,
        redirectUri: 'https://admin.example.com/auth/callback',
      });

      // signAsync 호출 중 id_token 발급 호출 (sub + auth_time 키 가진 payload) 찾기
      const idTokenCall = jwtService.signAsync.mock.calls.find(
        ([payload]) => typeof payload === 'object' && payload !== null && 'auth_time' in payload,
      );
      expect(idTokenCall).toBeDefined();
      const idTokenPayload = idTokenCall![0] as { sub: string; auth_time: number; nonce?: string };
      expect(idTokenPayload.nonce).toBe('rp-supplied-nonce-abc');
      expect(idTokenPayload.sub).toBe('u-1');
    });

    it('nonce 가 저장 안 됐으면 id_token 에도 nonce claim 없음', async () => {
      setupCode({ nonce: null });

      await manager.issueToken({
        grantType: 'authorization_code',
        clientId: 'admin-web',
        code: 'authcode',
        codeVerifier: VERIFIER,
        redirectUri: 'https://admin.example.com/auth/callback',
      });

      const idTokenCall = jwtService.signAsync.mock.calls.find(
        ([payload]) => typeof payload === 'object' && payload !== null && 'auth_time' in payload,
      );
      expect(idTokenCall).toBeDefined();
      const idTokenPayload = idTokenCall![0] as { sub: string; auth_time: number; nonce?: string };
      expect(idTokenPayload.nonce).toBeUndefined();
    });

    it('openid scope 없으면 id_token 자체가 발급 안 됨 (nonce 무관)', async () => {
      setupCode({ scope: 'profile', nonce: 'whatever' });

      await manager.issueToken({
        grantType: 'authorization_code',
        clientId: 'admin-web',
        code: 'authcode',
        codeVerifier: VERIFIER,
        redirectUri: 'https://admin.example.com/auth/callback',
      });

      const idTokenCall = jwtService.signAsync.mock.calls.find(
        ([payload]) => typeof payload === 'object' && payload !== null && 'auth_time' in payload,
      );
      expect(idTokenCall).toBeUndefined();
    });
  });

  describe('refreshTokens — reuse grace window (iOS 동시 요청 대응)', () => {
    beforeEach(() => {
      // refresh_token 그랜트도 issueToken → assertClientCredentials 를 거친다. public client 로 통과.
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(makeClient());
    });

    function revokedRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'parent-1',
        userId: 'u-1',
        clientId: 'admin-web',
        refreshToken: 'rt-parent',
        scope: 'openid profile',
        isRevoked: true,
        expiresAt: new Date(Date.now() + 60_000),
        rotatedFrom: null,
        createdAt: new Date(Date.now() - 60_000),
        updatedAt: new Date(), // 방금 회전됨 → grace 내
        ...overrides,
      } as never;
    }

    function refresh() {
      return manager.issueToken({
        grantType: 'refresh_token',
        clientId: 'admin-web',
        refreshToken: 'rt-parent',
      });
    }

    it('grace 내 + 살아있는 자식이 있으면 chain 을 죽이지 않고 자식을 회전해 새 토큰을 발급한다', async () => {
      repo.findOAuthTokenByRefresh.mockResolvedValue(revokedRow());
      repo.findChildToken.mockResolvedValue({
        id: 'child-1',
        userId: 'u-1',
        clientId: 'admin-web',
        refreshToken: 'rt-child',
        scope: 'openid profile',
        isRevoked: false,
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      const result = await refresh();

      expect(result.access_token).toBeDefined();
      expect(repo.revokeChain).not.toHaveBeenCalled();
      // 자식이 한 번 더 회전됨
      expect(repo.revokeTokenById).toHaveBeenCalledWith('child-1', expect.anything());
      expect(repo.insertOAuthToken).toHaveBeenCalled();
    });

    it('grace 를 벗어난 재사용은 chain 전체를 revoke 하고 거부한다', async () => {
      repo.findOAuthTokenByRefresh.mockResolvedValue(
        revokedRow({ updatedAt: new Date(Date.now() - 5 * 60_000) }), // 5분 전 → grace 밖
      );

      await expect(refresh()).rejects.toThrow(/reuse detected/);
      expect(repo.revokeChain).toHaveBeenCalledWith('parent-1', expect.anything());
      expect(repo.findChildToken).not.toHaveBeenCalled();
    });

    it('grace 내라도 자식이 이미 revoke 됐으면 진짜 reuse 로 보고 chain 을 revoke 한다', async () => {
      repo.findOAuthTokenByRefresh.mockResolvedValue(revokedRow());
      repo.findChildToken.mockResolvedValue({
        id: 'child-1',
        userId: 'u-1',
        clientId: 'admin-web',
        refreshToken: 'rt-child',
        scope: 'openid profile',
        isRevoked: true,
        expiresAt: new Date(Date.now() + 60_000),
      } as never);

      await expect(refresh()).rejects.toThrow(/reuse detected/);
      expect(repo.revokeChain).toHaveBeenCalledWith('parent-1', expect.anything());
    });

    it('정상(미회전) 토큰은 회전되어 새 토큰을 발급한다', async () => {
      repo.findOAuthTokenByRefresh.mockResolvedValue(
        revokedRow({ isRevoked: false, updatedAt: new Date(Date.now() - 60_000) }),
      );

      const result = await refresh();

      expect(result.access_token).toBeDefined();
      expect(repo.revokeTokenById).toHaveBeenCalledWith('parent-1', expect.anything());
      expect(repo.revokeChain).not.toHaveBeenCalled();
    });
  });

  describe('payment_handoff grant', () => {
    function confidentialClient() {
      return makeClient({
        clientId: 'wallet-web',
        clientType: 'confidential',
        clientSecretHash: 'hash',
        allowedScopes: ['openid', 'profile', 'email'],
      });
    }

    it('confidential client + 유효한 핸드오프 토큰 → 세션 토큰셋 발급', async () => {
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(confidentialClient());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'u-1', purpose: 'payment_handoff' });

      const result = await manager.issueToken({
        grantType: 'payment_handoff',
        clientId: 'wallet-web',
        clientSecret: 'secret',
        code: 'handoff-jwt',
      } as never);

      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('handoff-jwt', { secret: 'handoff-secret' });
    });

    it('purpose 가 payment_handoff 가 아니면 거부', async () => {
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(confidentialClient());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'u-1', purpose: 'social_callback' });

      await expect(
        manager.issueToken({
          grantType: 'payment_handoff',
          clientId: 'wallet-web',
          clientSecret: 'secret',
          code: 'x',
        } as never),
      ).rejects.toThrow(/invalid handoff token/);
    });

    it('public client 는 핸드오프 교환 불가', async () => {
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(
        makeClient({ clientId: 'wallet-web', clientType: 'public' }),
      );
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'u-1', purpose: 'payment_handoff' });

      await expect(
        manager.issueToken({ grantType: 'payment_handoff', clientId: 'wallet-web', code: 'x' } as never),
      ).rejects.toThrow(/confidential client/);
    });

    it('code(핸드오프 토큰) 누락 시 거부', async () => {
      (reader.getClientOrThrow as jest.Mock).mockResolvedValue(confidentialClient());
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await expect(
        manager.issueToken({ grantType: 'payment_handoff', clientId: 'wallet-web', clientSecret: 'secret' } as never),
      ).rejects.toThrow(/code .*required/);
    });
  });
});
