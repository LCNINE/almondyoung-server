import { DbService, InjectDb } from '@app/db';
import { BadRequestError, UnauthorizedError } from '@app/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TokensService } from '../tokens/tokens.service';
import { type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { DbTransaction } from '../../commons/types';
import {
  INTERNAL_TOKEN_AUDIENCE,
  JWT_ACCESS_TOKEN_EXPIRATION,
  JWT_REFRESH_TOKEN_LONG_EXPIRATION,
  PAYMENT_HANDOFF_TOKEN_PURPOSE,
} from '../../constants/auth.constant';
import { UsersService } from '../users/users.service';
import { IssueCodeRequestDto } from './dto/issue-code.dto';
import { TokenRequestDto, TokenResponseDto } from './dto/token.dto';
import { OAuthReader } from './oauth.reader';
import { OAuthRepository } from './oauth.repository';
import { isRedirectUriRegistered } from './redirect-uri';

const CODE_TTL_SECONDS = 300;

// 정상 회전 직후 같은 refresh token 이 다시 도착하는 것을 탈취(reuse)가 아닌 동시성 race 로
// 관용하는 시간 창. iOS WebKit 의 중복 요청은 보통 수 초 내에 몰리므로 30초면 충분하며,
// 이 창을 벗어난 재사용은 여전히 chain 전체 revoke 로 처리해 탈취 방어를 유지한다.
const REFRESH_REUSE_GRACE_MS = 30_000;

function hasOpenIdScope(scope: string | null): boolean {
  if (!scope) return false;
  return scope.split(/\s+/).includes('openid');
}

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
    private readonly configService: ConfigService,
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
      nonce: input.nonce ?? null,
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
    if (input.grantType === 'payment_handoff') {
      return this.exchangeHandoffForToken(input);
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

      const tokens = await this.mintTokenPair(row.userId, row.clientId, row.scope, undefined, tx, {
        authTime: row.createdAt,
        nonce: row.nonce ?? undefined,
      });
      return tokens;
    });
  }

  // payment_handoff grant: storefront 가 인증된 고객에게 발급한 단기 핸드오프 토큰을 wallet-web 이
  // confidential client 인증과 함께 교환해 자기 세션 토큰셋을 받는다. wallet-web 이 별도 서브도메인에서
  // OIDC silent-SSO/쿠키로 세션을 재확보하지 못하는 인앱브라우저·ITP 환경을 우회하기 위한 경로다.
  // PKCE 대신 client_secret 으로 신뢰를 보증하므로 confidential client 만 허용한다
  // (client 자격 검증은 issueToken 의 assertClientCredentials 에서 선행됨).
  private async exchangeHandoffForToken(input: TokenRequestDto): Promise<TokenResponseDto> {
    if (!input.code) throw new BadRequestError('code (handoff token) required for payment_handoff grant');

    const client = await this.reader.getClientOrThrow(input.clientId);
    if (client.clientType !== 'confidential') {
      throw new UnauthorizedError('payment_handoff grant requires a confidential client');
    }

    const handoffSecret = this.configService.getOrThrow<string>('JWT_VERIFICATION_TOKEN_SECRET');
    let payload: jwt.JwtPayload & { purpose?: string; client_id?: string };
    try {
      const verified = jwt.verify(input.code, handoffSecret, {
        algorithms: ['HS256'],
      });
      if (typeof verified === 'string') {
        throw new UnauthorizedError('invalid handoff token');
      }
      payload = verified;
    } catch {
      throw new UnauthorizedError('invalid or expired handoff token');
    }
    if (payload.purpose !== PAYMENT_HANDOFF_TOKEN_PURPOSE || !payload.sub) {
      throw new UnauthorizedError('invalid handoff token');
    }
    // 핸드오프 토큰이 특정 client 를 지목했다면(선택) 교환하는 client 와 일치해야 한다.
    if (payload.client_id && payload.client_id !== input.clientId) {
      throw new UnauthorizedError('handoff token client mismatch');
    }

    const userId = payload.sub;
    const scope = (client.allowedScopes ?? []).join(' ') || null;
    return this.inTx((tx) =>
      this.mintTokenPair(userId, input.clientId, scope, undefined, tx, { authTime: new Date() }),
    );
  }

  private async refreshTokens(input: TokenRequestDto): Promise<TokenResponseDto> {
    if (!input.refreshToken) throw new BadRequestError('refresh_token required');

    return this.inTx(async (tx) => {
      // FOR UPDATE: 동일 토큰에 대한 동시 회전 요청을 직렬화해 SELECT→UPDATE race 를 제거한다.
      const row = await this.repo.findOAuthTokenByRefresh(input.refreshToken!, tx, true);
      if (!row) throw new UnauthorizedError('invalid refresh_token');
      if (row.clientId !== input.clientId) throw new UnauthorizedError('client mismatch');

      // reuse detection: 이미 revoke된 토큰 재사용.
      if (row.isRevoked) {
        // grace window: 정상 회전 직후(30초 내) 같은 토큰이 다시 도착하는 것은 탈취가 아니라
        // iOS WebKit 등의 동시·중복 요청이다. 이 경우 chain 을 죽이지 않고, 직전 회전으로 발급된
        // 자식 토큰을 한 번 더 회전시켜 유효한 새 토큰 쌍을 내준다 → 세션 유지.
        const revokedAtMs = row.updatedAt?.getTime() ?? 0;
        const withinGrace = Date.now() - revokedAtMs < REFRESH_REUSE_GRACE_MS;
        const child = withinGrace ? await this.repo.findChildToken(row.id, tx) : null;
        if (child && !child.isRevoked && child.expiresAt > new Date()) {
          this.logger.warn(`refresh token concurrent-rotation tolerated (grace) parent=${row.id} child=${child.id}`);
          await this.repo.revokeTokenById(child.id, tx);
          return this.mintTokenPair(child.userId, child.clientId, child.scope, child.id, tx);
        }
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
    oidcContext?: { authTime: Date; nonce?: string },
  ): Promise<TokenResponseDto> {
    const accessExpiresInMs = parseExpiresInToMs(JWT_ACCESS_TOKEN_EXPIRATION);
    const refreshExpiresInMs = parseExpiresInToMs(JWT_REFRESH_TOKEN_LONG_EXPIRATION);

    // access token 에 user 정체성 claim (email, login_id, roles) 를 함께 박는다.
    // RP 마다 /users/me 를 따로 부르지 않아도 RBAC 게이팅을 할 수 있도록 — 레거시 internal token
    // (auth.service.ts mintTokens) 과 동일한 claim 셋을 유지해 admin-web 등 RP 가 토큰만으로
    // sub/email/login_id/roles 를 읽을 수 있게 한다.
    const user = await this.usersService.findUserById(userId);
    const roles = user ? await this.usersService.getUserRoleNames(userId, tx) : [];

    // access token: RS256 JWT. iss/kid/alg은 모듈 기본 signOptions에서 부여, aud=client_id.
    const accessToken = await this.jwtService.signAsync(
      {
        sub: userId,
        client_id: clientId,
        scope: scope ?? undefined,
        ...(user
          ? {
              email: user.email,
              login_id: user.loginId,
              roles,
            }
          : {}),
      },
      { audience: clientId, expiresIn: JWT_ACCESS_TOKEN_EXPIRATION },
    );

    // id_token: OIDC core. authorization_code 그랜트 + scope 에 `openid` 가 있을 때만 발급.
    // refresh_token 그랜트에서는 발급하지 않는다 (oidcContext 미전달).
    // nonce 는 authorize 단계에서 RP 가 보낸 값을 oauth_authorization_codes 에 저장해 두었다가
    // 여기서 그대로 echo. RP 는 id_token 의 nonce 를 자기가 보낸 값과 비교해 replay 를 차단한다.
    const wantsOpenId = !!oidcContext && hasOpenIdScope(scope);
    let idToken: string | undefined;
    if (wantsOpenId) {
      const idTokenPayload: { sub: string; auth_time: number; nonce?: string } = {
        sub: userId,
        auth_time: Math.floor(oidcContext!.authTime.getTime() / 1000),
      };
      if (oidcContext!.nonce) {
        idTokenPayload.nonce = oidcContext!.nonce;
      }
      idToken = await this.jwtService.signAsync(idTokenPayload, {
        audience: clientId,
        expiresIn: JWT_ACCESS_TOKEN_EXPIRATION,
      });
    }

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
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: Math.floor(accessExpiresInMs / 1000),
      scope: scope ?? undefined,
      id_token: idToken,
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
    this.logger.log(`[logout] endSession 시작 accessToken=${input.accessToken ? '있음' : '없음'}`);
    let userId: string | null = null;
    if (input.accessToken) {
      try {
        // SLO 는 internal session token (aud=user-service-internal) 과
        // OAuth access token (aud=등록된 client_id) 양쪽을 의도적으로 수용한다.
        // JwtModule 은 issuer/RS256 만 강제하므로 audience 화이트리스트는 여기서 명시 검증한다.
        const payload = await this.jwtService.verifyAsync<{ sub?: string; aud?: string }>(input.accessToken);
        const aud = payload.aud;
        const audAccepted =
          aud === INTERNAL_TOKEN_AUDIENCE ||
          (typeof aud === 'string' && aud.length > 0 && (await this.repo.findActiveClientById(aud)) !== null);
        this.logger.log(`[logout] endSession verify 성공 sub=${payload.sub} aud=${aud} audAccepted=${audAccepted}`);
        if (audAccepted && payload.sub) {
          userId = payload.sub;
        }
      } catch (e) {
        // 토큰이 만료/무효해도 logout 자체는 진행 (idempotent).
        this.logger.warn(`[logout] endSession verify 실패: ${(e as Error).message}`);
      }
    }

    if (userId) {
      await this.repo.revokeAllUserTokens(userId);
      await this.tokensService.deleteAllTokens(userId);
      this.logger.log(`[logout] SLO: revoked all tokens for userId=${userId}`);
    } else {
      this.logger.warn('[logout] endSession userId 식별 실패 → revoke 스킵');
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
  // 6. redirect_uri 사전 검증 (auth-web 의 /oauth/authorize 단계에서 호출)
  // ─────────────────────────────────────────
  /**
   * client 활성 여부 + redirect_uri 등록 매칭을 한 번에 확인한다.
   * auth-web 이 OIDC error redirect (`error=login_required` 등) 를 보내기 전에 pre-flight 로 호출해
   * 등록되지 않은 임의 URL 로 302 가 나가는 open redirect 를 막는다.
   * client 가 없거나 비활성이거나 redirect_uri 가 등록 화이트리스트와 매칭되지 않으면 false.
   */
  async validateRedirectUri(input: { clientId: string; redirectUri: string }): Promise<boolean> {
    const client = await this.repo.findActiveClientById(input.clientId);
    if (!client) return false;
    return isRedirectUriRegistered(client.redirectUris, input.redirectUri, client.clientType);
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
