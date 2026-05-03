import { JwtService } from '@nestjs/jwt';
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
      revokeTokenById: jest.fn().mockResolvedValue(undefined),
      revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
      revokeChain: jest.fn().mockResolvedValue(undefined),
    } as unknown as RepoMock;

    reader = {
      getClientOrThrow: jest.fn(),
    } as unknown as OAuthReader;

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-jwt'),
    } as unknown as jest.Mocked<JwtService>;

    usersService = {
      findUserById: jest.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.c', nickname: 'n', username: 'u' }),
    } as unknown as jest.Mocked<UsersService>;

    tokensService = {
      deleteAllTokens: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<TokensService>;

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
});
