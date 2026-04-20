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
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  constructor(private readonly oauthService: OAuthService) {}

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
}
