import { DbService, InjectDb } from '@app/db';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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

const CODE_TTL_SECONDS = 60;

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
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  private async inTx<T>(fn: (tx: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> {
    return tx ? fn(tx) : this.dbService.db.transaction(fn);
  }

  // ─────────────────────────────────────────
  // 1. authorization code 발급 (auth-web → user-service internal)
  // ─────────────────────────────────────────
  async issueAuthorizationCode(input: IssueCodeRequestDto): Promise<{ code: string; expiresIn: number }> {
    const client = this.reader.getClientOrThrow(input.clientId);

    if (!client.redirectUris.includes(input.redirectUri)) {
      throw new Error('invalid redirect_uri (not registered)');
    }
    if (input.codeChallengeMethod !== 'S256') {
      throw new Error('invalid code_challenge_method (only S256 allowed)');
    }
    const user = await this.usersService.findUserById(input.userId);
    if (!user) throw new Error('user not found');

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
    throw new Error('unsupported grant_type');
  }

  private async assertClientCredentials(clientId: string, clientSecret: string): Promise<void> {
    const client = this.reader.getClientOrThrow(clientId);
    const ok = await bcrypt.compare(clientSecret, client.clientSecretHash);
    if (!ok) throw new Error('invalid client_secret');
  }

  private async exchangeCodeForToken(input: TokenRequestDto): Promise<TokenResponseDto> {
    if (!input.code || !input.codeVerifier || !input.redirectUri) {
      throw new Error('code, code_verifier, redirect_uri required for authorization_code grant');
    }

    return this.inTx(async (tx) => {
      const row = await this.repo.findUnconsumedCode(input.code!, tx);
      if (!row) throw new Error('invalid or already used code');
      if (row.expiresAt < new Date()) throw new Error('code expired');
      if (row.clientId !== input.clientId) throw new Error('client mismatch');
      if (row.redirectUri !== input.redirectUri) throw new Error('redirect_uri mismatch');

      // PKCE 검증 (S256: BASE64URL(SHA256(verifier)) === codeChallenge)
      const computed = crypto.createHash('sha256').update(input.codeVerifier!).digest('base64url');
      if (computed !== row.codeChallenge) throw new Error('PKCE verification failed');

      await this.repo.markCodeConsumed(row.code, tx);

      const tokens = await this.mintTokenPair(row.userId, row.clientId, row.scope, undefined, tx);
      return tokens;
    });
  }

  private async refreshTokens(input: TokenRequestDto): Promise<TokenResponseDto> {
    if (!input.refreshToken) throw new Error('refresh_token required');

    return this.inTx(async (tx) => {
      const row = await this.repo.findOAuthTokenByRefresh(input.refreshToken!, tx);
      if (!row) throw new Error('invalid refresh_token');
      if (row.clientId !== input.clientId) throw new Error('client mismatch');

      // reuse detection: 이미 revoke된 토큰 재사용 → chain 전체 revoke
      if (row.isRevoked) {
        this.logger.warn(`refresh token reuse detected for tokenId=${row.id}`);
        await this.repo.revokeChain(row.id, tx);
        throw new Error('refresh_token reuse detected; chain revoked');
      }
      if (row.expiresAt < new Date()) {
        await this.repo.revokeTokenById(row.id, tx);
        throw new Error('refresh_token expired');
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

    // access token: JWT (현재 내부 access token과 동일한 시크릿/포맷 — 타겟 서비스가 검증 가능)
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, client_id: clientId, scope: scope ?? undefined },
      {
        secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
        expiresIn: JWT_ACCESS_TOKEN_EXPIRATION,
      },
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
  async revokeRefreshToken(clientId: string, clientSecret: string, refreshToken: string): Promise<void> {
    await this.assertClientCredentials(clientId, clientSecret);
    const row = await this.repo.findOAuthTokenByRefresh(refreshToken);
    if (!row) return; // RFC 7009: 알 수 없는 토큰은 200으로 응답
    if (row.clientId !== clientId) throw new Error('client mismatch');
    await this.repo.revokeTokenById(row.id);
  }

  // ─────────────────────────────────────────
  // 4. userinfo
  // ─────────────────────────────────────────
  async getUserInfo(accessToken: string): Promise<{ sub: string; email: string; nickname: string; username: string }> {
    let payload: { sub?: string };
    try {
      payload = await this.jwtService.verifyAsync(accessToken, {
        secret: this.configService.getOrThrow<string>('AUTH_SECRET'),
      });
    } catch {
      throw new Error('invalid access_token');
    }
    if (!payload.sub) throw new Error('invalid access_token payload');

    const user = await this.usersService.findUserById(payload.sub);
    if (!user) throw new Error('user not found');

    return {
      sub: user.id,
      email: user.email,
      nickname: user.nickname,
      username: user.username,
    };
  }

  // ─────────────────────────────────────────
  // internal secret 검증 (auth-web → /oauth/internal/issue-code)
  // ─────────────────────────────────────────
  assertInternalSecret(provided: string | undefined): void {
    const expected = this.reader.getInternalSecret();
    if (!provided || provided !== expected) {
      throw new Error('invalid internal secret');
    }
  }
}
