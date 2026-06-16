import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipResponseEnvelope } from '@app/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../commons/decorator/public.decorator';
import { IssueCodeRequestDto, IssueCodeResponseDto } from './dto/issue-code.dto';
import { RevokeRequestDto } from './dto/revoke.dto';
import { TokenRequestDto, TokenResponseDto } from './dto/token.dto';
import { normalizeRevokeBody, normalizeTokenBody, parseBasicAuthCredentials } from './oauth-body';
import { OAuthService } from './oauth.service';

@ApiTags('OAuth')
@Controller('oauth')
@SkipResponseEnvelope()
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly oauthService: OAuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: '[internal] auth-web에서 호출, authorization code 발급' })
  @Post('internal/issue-code')
  @Public()
  @HttpCode(HttpStatus.OK)
  async issueCode(
    @Body() body: IssueCodeRequestDto,
    @Headers('x-internal-secret') internalSecret?: string,
  ): Promise<IssueCodeResponseDto> {
    return this.oauthService.issueCode(body, internalSecret);
  }

  @ApiOperation({
    summary: '[internal] redirect_uri 사전 검증',
    description:
      'auth-web 의 /oauth/authorize 가 OIDC error redirect 를 보내기 전 redirect_uri 가 등록 화이트리스트와 매칭되는지 확인한다. ' +
      '미등록 URI 로의 외부 302(open redirect) 를 차단하는 용도.',
  })
  @Post('internal/validate-redirect-uri')
  @Public()
  @HttpCode(HttpStatus.OK)
  async validateRedirectUri(
    @Body() body: { clientId?: string; client_id?: string; redirectUri?: string; redirect_uri?: string },
    @Headers('x-internal-secret') internalSecret?: string,
  ): Promise<{ valid: boolean }> {
    const clientId = body.clientId ?? body.client_id;
    const redirectUri = body.redirectUri ?? body.redirect_uri;
    if (!clientId || !redirectUri) {
      return { valid: false };
    }
    const valid = await this.oauthService.validateRedirectUri({ clientId, redirectUri }, internalSecret);
    return { valid };
  }

  @ApiOperation({ summary: 'token endpoint (authorization_code | refresh_token)' })
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiBody({ type: TokenRequestDto })
  @Post('token')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async token(
    @Body() raw: unknown,
    @Headers('authorization') authHeader?: string,
  ): Promise<TokenResponseDto> {
    const body = normalizeTokenBody(raw);
    // RFC 6749 §2.3.1: Basic auth header 가 있으면 그 자격 증명을 우선 신뢰. body 의 값은 fallback.
    const basic = parseBasicAuthCredentials(authHeader);
    const merged = {
      ...body,
      clientId: basic.clientId ?? body.clientId,
      clientSecret: basic.clientSecret ?? body.clientSecret,
    };
    return this.oauthService.exchangeToken(merged);
  }

  @ApiOperation({ summary: 'userinfo endpoint' })
  @Get('userinfo')
  @Public()
  async userinfo(@Headers('authorization') auth?: string) {
    const m = auth?.match(/^Bearer\s+(.+)$/i);
    if (!m?.[1]) throw new UnauthorizedException('Bearer token required');
    return this.oauthService.userInfo(m[1]);
  }

  @ApiOperation({ summary: 'token revocation (RFC 7009)' })
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiBody({ type: RevokeRequestDto })
  @Post('revoke')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async revoke(
    @Body() raw: unknown,
    @Headers('authorization') authHeader?: string,
  ): Promise<{ ok: true }> {
    const body = normalizeRevokeBody(raw);
    // RFC 7009 §2.1 → §2.3 client auth 는 RFC 6749 §2.3 을 따른다 (Basic auth 우선).
    const basic = parseBasicAuthCredentials(authHeader);
    await this.oauthService.revoke(
      basic.clientId ?? body.clientId,
      basic.clientSecret ?? body.clientSecret,
      body.token,
    );
    return { ok: true };
  }

  /**
   * RP-Initiated Logout. 브라우저는 GET으로 navigate, 서버 측은 POST로 호출 가능.
   * - access token: cookie(`accessToken`) 또는 Authorization Bearer.
   * - post_logout_redirect_uri는 client의 등록된 화이트리스트 매칭 시에만 사용.
   * - 매칭 실패/미제공 시 default redirect (auth-web /).
   */
  @ApiOperation({ summary: 'OIDC RP-Initiated Logout (end_session_endpoint)' })
  @Get('end_session')
  @Public()
  async endSessionGet(
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
    @Query('client_id') clientId?: string,
    @Query('post_logout_redirect_uri') postLogoutRedirectUri?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    const accessToken = this.extractAccessToken(req);
    this.logger.log(
      `[logout] end_session GET 도착 accessToken=${accessToken ? '있음' : '없음'} clientId=${clientId} postLogoutRedirectUri=${postLogoutRedirectUri}`,
    );
    const { redirectUrl } = await this.oauthService.endSession({
      accessToken,
      clientId,
      postLogoutRedirectUri,
      state,
    });
    // RP 들이 OIDC RP 로 전환된 후로는 user-service 가 parent-domain 쿠키를 set/clear 하지 않는다.
    // 각 RP 가 자기 도메인의 자기 세션을 직접 정리한다 (admin-web 의 /api/auth/signout 등).
    const target = redirectUrl ?? this.defaultPostLogoutTarget();
    reply.redirect(target, HttpStatus.FOUND);
  }

  @ApiOperation({ summary: 'OIDC RP-Initiated Logout (POST 변형, 서버 간 호출용)' })
  @Post('end_session')
  @Public()
  @HttpCode(HttpStatus.OK)
  async endSessionPost(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body()
    body: {
      client_id?: string;
      post_logout_redirect_uri?: string;
      state?: string;
    },
  ): Promise<{ redirectUrl: string | null }> {
    const accessToken = this.extractAccessToken(req);
    this.logger.log(
      `[logout] end_session POST 도착 accessToken=${accessToken ? '있음' : '없음'} clientId=${body?.client_id}`,
    );
    const result = await this.oauthService.endSession({
      accessToken,
      clientId: body?.client_id,
      postLogoutRedirectUri: body?.post_logout_redirect_uri,
      state: body?.state,
    });
    // parent-domain cookie clear 는 폐기 — 위 GET 핸들러 주석 참고.
    return result;
  }

  private extractAccessToken(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    const m = auth?.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1];
    const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.accessToken;
    return cookieToken ?? null;
  }

  private defaultPostLogoutTarget(): string {
    return this.configService.get<string>('AUTH_WEB_ORIGIN') ?? '/';
  }
}
