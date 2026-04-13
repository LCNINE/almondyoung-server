import { JwtPayload, RequireScopes } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../commons/decorator/public.decorator';
import { ProviderType } from '../../commons/types';
import { AccountLinkingService } from './account-linking.service';
import { LinkedIdentitiesResponseDto, LinkIdentityResultDto } from './dto/identity-list.dto';
import { StartLinkingDto } from './dto/link-identity.dto';

@ApiTags('Auth - Account Linking')
@ApiBearerAuth('access-token')
@Controller('auth')
export class AccountLinkingController {
  constructor(
    private readonly accountLinkingService: AccountLinkingService,
    private readonly configService: ConfigService,
  ) {}

  private get frontendUrl(): string {
    const isProd = this.configService.get('NODE_ENV') === 'production';
    return isProd ? this.configService.getOrThrow('FRONTEND_URL') : 'http://localhost:8000';
  }

  private getLinkResultRedirectUrl(
    success: boolean,
    provider: string,
    redirectTo?: string,
    error?: string,
  ): string {
    const path = redirectTo || '/mypage/account/profile';
    const url = new URL(path, this.frontendUrl);
    url.searchParams.set('link_result', success ? 'success' : 'error');
    url.searchParams.set('provider', provider);
    if (error) {
      url.searchParams.set('error', error);
    }
    return url.toString();
  }

  // ==================== 카카오 연결 ====================

  @ApiOperation({ summary: '카카오 계정 연결 시작' })
  @ApiResponse({ status: 302, description: '카카오 OAuth 페이지로 리다이렉트' })
  @Get('link/kakao')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes('user:modify')
  async startKakaoLink(
    @CurrentUser() user: JwtPayload,
    @Query() query: StartLinkingDto,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const state = await this.accountLinkingService.generateLinkingState(user.id, query.redirectTo);

    const kakaoAuthUrl = new URL('https://kauth.kakao.com/oauth/authorize');
    kakaoAuthUrl.searchParams.set('client_id', this.configService.getOrThrow('KAKAO_CLIENT_ID'));
    kakaoAuthUrl.searchParams.set('redirect_uri', this.configService.getOrThrow('KAKAO_LINK_CALLBACK_URL'));
    kakaoAuthUrl.searchParams.set('response_type', 'code');
    kakaoAuthUrl.searchParams.set('state', state);

    res.status(302).redirect(kakaoAuthUrl.toString());
  }

  @ApiOperation({ summary: '카카오 계정 연결 콜백' })
  @ApiResponse({ status: 302, description: '프론트엔드로 리다이렉트 (성공/실패)' })
  @Get('link/kakao/callback')
  @UseGuards(AuthGuard('kakao-link'))
  @Public()
  async kakaoLinkCallback(
    @Req() req: FastifyRequest & { user: { name: string; email: string; providerId: string; state: string } },
    @Res() res: FastifyReply,
  ): Promise<void> {
    const provider = ProviderType.KAKAO;
    let redirectTo: string | undefined;

    try {
      const { state, ...socialProfile } = req.user;

      if (!state) {
        throw new UnauthorizedException('Missing state parameter');
      }

      const result = await this.accountLinkingService.verifyLinkingState(state);
      redirectTo = result.redirectTo;

      await this.accountLinkingService.linkSocialAccount(result.userId, provider, socialProfile);

      res.status(302).redirect(this.getLinkResultRedirectUrl(true, provider, redirectTo));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(302).redirect(this.getLinkResultRedirectUrl(false, provider, redirectTo, errorMessage));
    }
  }

  // ==================== 네이버 연결 ====================

  @ApiOperation({ summary: '네이버 계정 연결 시작' })
  @ApiResponse({ status: 302, description: '네이버 OAuth 페이지로 리다이렉트' })
  @Get('link/naver')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes('user:modify')
  async startNaverLink(
    @CurrentUser() user: JwtPayload,
    @Query() query: StartLinkingDto,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const state = await this.accountLinkingService.generateLinkingState(user.id, query.redirectTo);

    const naverAuthUrl = new URL('https://nid.naver.com/oauth2.0/authorize');
    naverAuthUrl.searchParams.set('client_id', this.configService.getOrThrow('NAVER_CLIENT_ID'));
    naverAuthUrl.searchParams.set('redirect_uri', this.configService.getOrThrow('NAVER_LINK_CALLBACK_URL'));
    naverAuthUrl.searchParams.set('response_type', 'code');
    naverAuthUrl.searchParams.set('state', state);

    res.status(302).redirect(naverAuthUrl.toString());
  }

  @ApiOperation({ summary: '네이버 계정 연결 콜백' })
  @ApiResponse({ status: 302, description: '프론트엔드로 리다이렉트 (성공/실패)' })
  @Get('link/naver/callback')
  @UseGuards(AuthGuard('naver-link'))
  @Public()
  async naverLinkCallback(
    @Req() req: FastifyRequest & { user: { name: string; email: string; providerId: string; state: string } },
    @Res() res: FastifyReply,
  ): Promise<void> {
    const provider = ProviderType.NAVER;
    let redirectTo: string | undefined;

    try {
      const { state, ...socialProfile } = req.user;

      if (!state) {
        throw new UnauthorizedException('Missing state parameter');
      }

      const result = await this.accountLinkingService.verifyLinkingState(state);
      redirectTo = result.redirectTo;

      await this.accountLinkingService.linkSocialAccount(result.userId, provider, socialProfile);

      res.status(302).redirect(this.getLinkResultRedirectUrl(true, provider, redirectTo));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(302).redirect(this.getLinkResultRedirectUrl(false, provider, redirectTo, errorMessage));
    }
  }

  // ==================== Identity 관리 ====================

  @ApiOperation({ summary: '연결된 소셜 계정 목록 조회' })
  @ApiResponse({
    status: 200,
    description: '연결된 소셜 계정 목록',
    type: LinkedIdentitiesResponseDto,
  })
  @Get('identities')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes('user:read')
  async getLinkedIdentities(@CurrentUser() user: JwtPayload): Promise<LinkedIdentitiesResponseDto> {
    try {
      return await this.accountLinkingService.getLinkedIdentities(user.id);
    } catch (e: unknown) {
      const msg = ((e as Error)?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException((e as Error).message);
      throw new InternalServerErrorException((e as Error).message);
    }
  }

  @ApiOperation({ summary: '소셜 계정 연결 해제' })
  @ApiParam({
    name: 'provider',
    description: '해제할 소셜 프로바이더',
    enum: ['kakao', 'naver'],
  })
  @ApiResponse({
    status: 200,
    description: '연결 해제 성공',
    type: LinkIdentityResultDto,
  })
  @Delete('identities/:provider')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes('user:modify')
  async unlinkIdentity(
    @CurrentUser() user: JwtPayload,
    @Param('provider') provider: string,
  ): Promise<LinkIdentityResultDto> {
    if (provider !== 'kakao' && provider !== 'naver') {
      throw new BadRequestException('provider는 kakao 또는 naver여야 합니다');
    }

    try {
      await this.accountLinkingService.unlinkSocialAccount(user.id, provider as ProviderType);

      const providerName = provider === 'kakao' ? '카카오' : '네이버';
      return {
        success: true,
        message: `${providerName} 계정 연결이 해제되었습니다.`,
        provider: provider as 'kakao' | 'naver',
      };
    } catch (e) {
      const msg = ((e as Error)?.message ?? '').toLowerCase();
      if (msg.includes('not found')) throw new NotFoundException((e as Error).message);
      if (msg.match(/cannot|already|last/)) throw new BadRequestException((e as Error).message);
      throw new InternalServerErrorException((e as Error).message);
    }
  }
}
