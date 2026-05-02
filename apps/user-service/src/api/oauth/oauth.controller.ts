import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../commons/decorator/public.decorator';
import { IssueCodeRequestDto, IssueCodeResponseDto } from './dto/issue-code.dto';
import { RevokeRequestDto } from './dto/revoke.dto';
import { TokenRequestDto, TokenResponseDto } from './dto/token.dto';
import { OAuthService } from './oauth.service';

function mapError(e: unknown): never {
  const msg = (e instanceof Error ? e.message : String(e)) ?? '';
  const lower = msg.toLowerCase();
  if (lower.includes('not found') || lower.includes('unknown client')) {
    throw new NotFoundException(msg);
  }
  if (lower.includes('invalid') || lower.includes('mismatch') || lower.includes('expired') || lower.includes('reuse') || lower.includes('failed') || lower.includes('required') || lower.includes('unsupported')) {
    if (lower.includes('client_secret') || lower.includes('internal secret') || lower.includes('access_token')) {
      throw new UnauthorizedException(msg);
    }
    throw new BadRequestException(msg);
  }
  throw new InternalServerErrorException(msg);
}

@ApiTags('OAuth')
@Controller('oauth')
export class OAuthController {
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
    try {
      return await this.oauthService.issueCode(body, internalSecret);
    } catch (e) {
      mapError(e);
    }
  }

  @ApiOperation({ summary: 'token endpoint (authorization_code | refresh_token)' })
  @Post('token')
  @Public()
  @HttpCode(HttpStatus.OK)
  async token(@Body() body: TokenRequestDto): Promise<TokenResponseDto> {
    try {
      return await this.oauthService.exchangeToken(body);
    } catch (e) {
      mapError(e);
    }
  }

  @ApiOperation({ summary: 'userinfo endpoint' })
  @Get('userinfo')
  @Public()
  async userinfo(@Headers('authorization') auth?: string) {
    const m = auth?.match(/^Bearer\s+(.+)$/i);
    if (!m?.[1]) throw new UnauthorizedException('Bearer token required');
    try {
      return await this.oauthService.userInfo(m[1]);
    } catch (e) {
      mapError(e);
    }
  }

  @ApiOperation({ summary: 'token revocation (RFC 7009)' })
  @Post('revoke')
  @Public()
  @HttpCode(HttpStatus.OK)
  async revoke(@Body() body: RevokeRequestDto): Promise<{ ok: true }> {
    try {
      await this.oauthService.revoke(body.clientId, body.clientSecret, body.token);
      return { ok: true };
    } catch (e) {
      mapError(e);
    }
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
    const { redirectUrl } = await this.oauthService.endSession({
      accessToken,
      clientId,
      postLogoutRedirectUri,
      state,
    });
    this.clearParentCookies(reply);
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
    const result = await this.oauthService.endSession({
      accessToken,
      clientId: body?.client_id,
      postLogoutRedirectUri: body?.post_logout_redirect_uri,
      state: body?.state,
    });
    this.clearParentCookies(reply);
    return result;
  }

  private extractAccessToken(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    const m = auth?.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]) return m[1];
    const cookieToken = (req as unknown as { cookies?: Record<string, string> }).cookies?.accessToken;
    return cookieToken ?? null;
  }

  private clearParentCookies(reply: FastifyReply): void {
    const cookieDomain = this.configService.get<string>('COOKIE_DOMAIN');
    const opts = {
      path: '/',
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    };
    reply.clearCookie('accessToken', opts);
    reply.clearCookie('refreshToken', opts);
  }

  private defaultPostLogoutTarget(): string {
    return this.configService.get<string>('AUTH_WEB_ORIGIN') ?? '/';
  }
}
