import { DbService, InjectDb } from '@app/db';
import { BadRequestError, UnauthorizedError } from '@app/shared';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokensService } from '../tokens/tokens.service';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DbTransaction } from '../../commons/types';
import { JWT_ACCESS_TOKEN_EXPIRATION, JWT_REFRESH_TOKEN_LONG_EXPIRATION } from '../../constants/auth.constant';
import { UsersService } from '../users/users.service';
import { IssueCodeRequestDto } from './dto/issue-code.dto';
import { TokenRequestDto, TokenResponseDto } from './dto/token.dto';
import { OAuthReader } from './oauth.reader';
import { OAuthRepository } from './oauth.repository';
import { isRedirectUriRegistered } from './redirect-uri';

const CODE_TTL_SECONDS = 300;

function parseExpiresInToMs(expiresIn: string): number {
  const m = expiresIn.match(/^(\d+)([smhdw])$/);
  if (!m) return 15 * 60 * 1000;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60 * 1000;
    case 'h':
      return n * 60 * 60 * 1000;
    case 'd':
      return n * 24 * 60 * 60 * 1000;
    case 'w':
      return n * 7 * 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

@Injectable()
export class OAuthManager {
  private readonly logger = new Logger(OAuthManager.name);

  constructor(
    @InjectDb() private readonly dbService: DbService<UserServiceSchema>,
    private readonly repo: OAuthRepository,
    private readonly reader: OAuthReader,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly tokensService: TokensService,
  ) {}

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  // ─────────────────────────────────────────
  // 1. authorization code 발급 (auth-web → user-service internal)
  // ─────────────────────────────────────────
  async issueAuthorizationCode(input: IssueCodeRequestDto): Promise<{ code: string; expiresIn: number }> {
    const client = await this.reader.getClientOrThrow(input.clientId);

    if (!isRedirectUriRegistered(client.redirectUris, input.redirectUri, client.clientType)) {
      throw new BadRequestError('invalid redirect_uri (not registered)');
    }
    if (input.codeChallengeMethod !== 'S256') {
      throw new BadRequestError('invalid code_challenge_method (only S256 allowed)');
    }
    const user = await this.usersService.findUserById(input.userId);
    if (!user) throw new BadRequestError('user not found');

    const code = crypto.randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);

    await this.repo.insertAuthorizationCode({
      code,
      clientId: input.clientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      scope: input.scope ?? null,
      expiresAt,
    });

    return { code, expiresIn: CODE_TTL_SECONDS };
  }

  // ─────────────────────────────────────────
  // 2. token 교환 (authorization_code | refresh_token)
  // ─────────────────────────────────────────
  async issueToken(input: TokenRequestDto): Promise<TokenResponseDto> {
    await this.assertClientCredentials(input.clientId, input.clientSecret);

    if (input.grantType === 'authorization_code') {
      return this.exchangeCodeForToken(input);
    }
    if (input.grantType === 'refresh_token') {
      return this.refreshTokens(input);
    }
    throw new BadRequestError('unsupported grant_type');
  }

  private async assertClientCredentials(clientId: string, clientSecret: string | undefined): Promise<void> {
    const client = await this.reader.getClientOrThrow(clientId);
    // public client: secret 검증 스킵. PKCE는 exchangeCodeForToken에서 강제됨.
    if (client.clientType === 'public') return;

    if (!clientSecret) throw new UnauthorizedError('client_secret required for confidential client');
    const okCurrent = await bcrypt.compare(clientSecret, client.clientSecretHash);
    if (okCurrent) return;
    if (client.previousSecretHash) {
      const okPrevious = await bcrypt.compare(clientSecret, client.previousSecretHash);
      if (okPrevious) return;
    }
    throw new UnauthorizedError('invalid client_secret');
  }

  private async exchangeCodeForToken(input: TokenRequestDto): Promise<TokenResponseDto> {
    if (!input.code || !input.codeVerifier || !input.redirectUri) {
      throw new BadRequestError('code, code_verifier, redirect_uri required for authorization_code grant');
    }

    return this.inTx(async (tx) => {
      const row = await this.repo.findUnconsumedCode(input.code!, tx);
      if (!row) throw new BadRequestError('invalid or already used code');
      if (row.expiresAt < new Date()) throw new BadRequestError('code expired');
      if (row.clientId !== input.clientId) throw new BadRequestError('client mismatch');
      if (row.redirectUri !== input.redirectUri) throw new BadRequestError('redirect_uri mismatch');

      // PKCE 검증 (S256: BASE64URL(SHA256(verifier)) === codeChallenge)
      const computed = crypto.createHash('sha256').update(input.codeVerifier!).digest('base64url');
      if (computed !== row.codeChallenge) throw new BadRequestError('PKCE verification failed');

      await this.repo.markCodeConsumed(row.code, tx);

      const tokens = await this.mintTokenPair(row.userId, row.clientId, row.scope, undefined, tx);
      return tokens;
    });
  }

  private async refreshTokens(input: TokenRequestDto): Promise<TokenResponseDto> {
    if (!input.refreshToken) throw new BadRequestError('refresh_token required');

    return this.inTx(async (tx) => {
      const row = await this.repo.findOAuthTokenByRefresh(input.refreshToken!, tx);
      if (!row) throw new UnauthorizedError('invalid refresh_token');
      if (row.clientId !== input.clientId) throw new UnauthorizedError('client mismatch');

      // reuse detection: 이미 revoke된 토큰 재사용 → chain 전체 revoke
      if (row.isRevoked) {
        this.logger.warn(`refresh token reuse detected for tokenId=${row.id}`);
        await this.repo.revokeChain(row.id, tx);
        throw new UnauthorizedError('refresh_token reuse detected; chain revoked');
      }
      if (row.expiresAt < new Date()) {
        await this.repo.revokeTokenById(row.id, tx);
        throw new UnauthorizedError('refresh_token expired');
      }

      // rotation: 이전 토큰 revoke + 새 토큰 발급 (rotatedFrom = 이전 id)
      await this.repo.revokeTokenById(row.id, tx);
      return this.mintTokenPair(row.userId, row.clientId, row.scope, row.id, tx);
    });
  }

  private async mintTokenPair(
    userId: string,
    clientId: string,
    scope: string | null,
    rotatedFrom: string | undefined,
    tx: DbTransaction,
  ): Promise<TokenResponseDto> {
    const accessExpiresInMs = parseExpiresInToMs(JWT_ACCESS_TOKEN_EXPIRATION);
    const refreshExpiresInMs = parseExpiresInToMs(JWT_REFRESH_TOKEN_LONG_EXPIRATION);

    // access token: RS256 JWT. iss/kid/alg은 모듈 기본 signOptions에서 부여, aud=client_id.
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, client_id: clientId, scope: scope ?? undefined },
      { audience: clientId, expiresIn: JWT_ACCESS_TOKEN_EXPIRATION },
    );

    // refresh token: opaque (랜덤 문자열). DB에서만 검증.
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + refreshExpiresInMs);

    await this.repo.insertOAuthToken(
      {
        userId,
        clientId,
        refreshToken,
        scope,
        expiresAt: refreshExpiresAt,
        rotatedFrom: rotatedFrom ?? null,
      },
      tx,
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: Math.floor(accessExpiresInMs / 1000),
      scope: scope ?? undefined,
    };
  }

  // ─────────────────────────────────────────
  // 3. revoke
  // ─────────────────────────────────────────
  async revokeRefreshToken(clientId: string, clientSecret: string | undefined, refreshToken: string): Promise<void> {
    await this.assertClientCredentials(clientId, clientSecret);
    const row = await this.repo.findOAuthTokenByRefresh(refreshToken);
    if (!row) return; // RFC 7009: 알 수 없는 토큰은 200으로 응답
    if (row.clientId !== clientId) throw new UnauthorizedError('client mismatch');
    await this.repo.revokeTokenById(row.id);
  }

  // ─────────────────────────────────────────
  // 4. userinfo
  // ─────────────────────────────────────────
  async getUserInfo(accessToken: string): Promise<{ sub: string; email: string; nickname: string; username: string }> {
    type OAuthAccessPayload = { sub?: string; aud?: string | string[] };
    let payload: OAuthAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<OAuthAccessPayload>(accessToken);
    } catch {
      throw new UnauthorizedError('invalid access_token');
    }
    if (!payload.sub) throw new UnauthorizedError('invalid access_token');

    // aud 엄격 검증: 등록된 active client_id여야 함
    const audClientId = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (!audClientId) throw new UnauthorizedError('invalid access_token');
    const client = await this.repo.findActiveClientById(audClientId);
    if (!client) throw new UnauthorizedError('invalid access_token');

    const user = await this.usersService.findUserById(payload.sub);
    if (!user) throw new UnauthorizedError('invalid access_token');

    return {
      sub: user.id,
      email: user.email,
      nickname: user.nickname,
      username: user.username,
    };
  }

  // ─────────────────────────────────────────
  // 5. end_session (Single Logout)
  // ─────────────────────────────────────────
  /**
   * RP-Initiated Logout. access token으로 사용자 식별 후 OAuth refresh token 전체 + 내부 토큰 일괄 revoke.
   * post_logout_redirect_uri를 등록된 client의 화이트리스트와 매칭하고, 매칭 시 그 URI로의 redirect URL 반환.
   * @param accessToken Bearer access token (cookie 또는 Authorization 헤더)
   * @param clientId post_logout_redirect_uri 검증용 client_id (선택)
   * @param postLogoutRedirectUri RP가 제공한 logout 후 redirect URL (선택)
   * @param state CSRF anchor (선택)
   * @returns 최종 redirect URL — 검증 실패/미제공 시 null
   */
  async endSession(input: {
    accessToken: string | null;
    clientId?: string;
    postLogoutRedirectUri?: string;
    state?: string;
  }): Promise<{ redirectUrl: string | null }> {
    let userId: string | null = null;
    if (input.accessToken) {
      try {
        const payload = await this.jwtService.verifyAsync<{ sub?: string }>(input.accessToken);
        if (payload.sub) userId = payload.sub;
      } catch {
        // 토큰이 만료/무효해도 logout 자체는 진행 (idempotent).
      }
    }

    if (userId) {
      await this.repo.revokeAllUserTokens(userId);
      await this.tokensService.deleteAllTokens(userId);
      this.logger.log(`SLO: revoked all tokens for userId=${userId}`);
    }

    let redirectUrl: string | null = null;
    if (input.postLogoutRedirectUri && input.clientId) {
      const client = await this.repo.findActiveClientById(input.clientId);
      const registered = client?.postLogoutRedirectUris ?? [];
      if (registered.includes(input.postLogoutRedirectUri)) {
        const url = new URL(input.postLogoutRedirectUri);
        if (input.state) url.searchParams.set('state', input.state);
        redirectUrl = url.toString();
      }
    }

    return { redirectUrl };
  }

  // ─────────────────────────────────────────
  // internal secret 검증 (auth-web → /oauth/internal/issue-code)
  // ─────────────────────────────────────────
  assertInternalSecret(provided: string | undefined): void {
    const expected = this.reader.getInternalSecret();
    if (!provided || provided !== expected) {
      throw new UnauthorizedError('invalid internal secret');
    }
  }
}
