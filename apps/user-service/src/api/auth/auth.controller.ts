import { RequireScopes, JwtPayload } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../commons/decorator/public.decorator';
import { ProviderType } from '../../commons/types';
import { AuthService } from './auth.service';
import { Cafe24SignupBootstrapRequestDto, Cafe24SignupBootstrapResponseDto } from './dto/cafe24-signup-bootstrap.dto';
import { ChangePasswordDto } from './dto/change-pw.dto';
import { FindUserIdDto } from './dto/find-userid.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignInDto } from './dto/sign-in.dto';
import { LocalSignUpDto } from './dto/sign-up.dto';

@ApiTags('Auth')
@ApiBearerAuth('access-token')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: '회원가입' })
  @ApiResponse({ status: 201, description: '회원가입 성공, 스토어프론트의 /callback/signup 경로로 리다이렉트' })
  @Post('signup')
  @Public()
  async signUp(
    @Body() body: LocalSignUpDto & { encrypted_id_token?: string },
    @Res({ passthrough: true }) res: FastifyReply,
    @Query('redirect_to') redirect_to?: string,
  ) {
    const localSignUpDto: LocalSignUpDto = {
      ...body,
      encryptedIdToken: body.encryptedIdToken ?? body.encrypted_id_token,
    };

    return this.authService.signUp(localSignUpDto, res, redirect_to);
  }

  @ApiOperation({
    summary: 'Cafe24 기반 회원가입 시작',
    description: '카페24 암호화 id 토큰으로 회원가입 prefill 정보를 조회합니다.',
  })
  @ApiBody({ type: Cafe24SignupBootstrapRequestDto })
  @ApiResponse({
    status: 201,
    description: '회원가입 시작 데이터 준비 성공',
    type: Cafe24SignupBootstrapResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @Post('signup/cafe24/bootstrap')
  @Public()
  async bootstrapCafe24Signup(
    @Body() body: Cafe24SignupBootstrapRequestDto & { encrypted_id_token?: string },
  ): Promise<Cafe24SignupBootstrapResponseDto> {
    const encryptedIdToken = body.encryptedIdToken ?? body.encrypted_id_token;

    if (!encryptedIdToken) {
      throw new BadRequestException('암호화 id 토큰이 필요합니다.');
    }

    const result = await this.authService.bootstrapCafe24Signup(encryptedIdToken);

    return {
      memberId: result.memberId,
      memberName: result.memberName,
      prefillAvailable: result.prefillAvailable,
      prefill: result.prefill,
    };
  }

  @ApiOperation({ summary: '로그인' })
  @ApiResponse({ status: 200, description: '로그인 성공' })
  @Post('signin')
  @Public()
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() signInDto: SignInDto,
    @Res({ passthrough: true }) res: FastifyReply,
    @Query('redirect_to') redirectTo?: string,
  ) {
    return await this.authService.signIn(signInDto, res);
  }

  @ApiOperation({ summary: '로그아웃' })
  @ApiResponse({ status: 200, description: '로그아웃 성공' })
  @Post('signout')
  @Public()
  async signOut(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.authService.signOut(request, reply);
  }

  /**
   * @deprecated OIDC RP 들은 표준 `/oauth/token` (refresh_token grant) 을 사용해야 한다.
   * 이 엔드포인트는 admin-web 이 OIDC RP 로 전환되기 전 parent-domain 쿠키 SSO 를 위해 존재했고,
   * 지금은 storefront 의 `/api/auth/restore-token` 프록시, df-admin, wallet-web, auth-web 의
   * 자체 IdP 세션 복구 등에서만 호출된다. 이들이 모두 OIDC 또는 user-service 자체 BFF 로 마이그레이션되면
   * 이 라우트를 제거할 예정. 호출 빈도/소비자 식별을 위해 deprecation warning 로그 발행.
   */
  @ApiOperation({
    summary: '[deprecated] 토큰 재발급 — 신규 클라이언트는 /oauth/token (refresh_token grant) 사용',
    deprecated: true,
  })
  @ApiResponse({ status: 200, description: '토큰 재발급 성공' })
  @Public()
  @Post('restore-token')
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  async restoreToken(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @CurrentUser() user: JwtPayload,
  ) {
    const ua = req.headers['user-agent'] ?? 'unknown';
    const referer = req.headers['referer'] ?? '-';
    this.logger.warn(
      `DEPRECATED /auth/restore-token called by userId=${user.id} ua="${ua}" referer="${referer}". ` +
        `Migrate caller to OIDC /oauth/token (refresh_token grant).`,
    );
    return await this.authService.restoreToken(user.id, res);
  }

  @ApiOperation({ summary: '비밀번호 변경' })
  @ApiResponse({ status: 200, description: '비밀번호 변경 성공' })
  @Post('change-password')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes('user:modify', 'master', 'admin:access')
  async changePassword(@Body(ValidationPipe) dto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
    return this.authService.changePassword(dto.currentPassword, dto.newPassword, user.id);
  }

  @ApiOperation({
    summary: '결제창(wallet-web) 핸드오프 토큰 발급',
    description:
      '인증된 고객이 결제로 진입할 때 호출. wallet-web 이 별도 서브도메인에서 세션을 재확보하지 못하는 ' +
      '인앱브라우저·ITP 환경을 우회하기 위해, storefront 가 이 단기 토큰을 받아 결제창 URL 로 넘긴다. ' +
      '토큰은 wallet-web 이 POST /oauth/token (grant_type=payment_handoff) 으로 한 번 교환한다.',
  })
  @ApiResponse({ status: 200, description: '핸드오프 토큰 발급 성공' })
  @Post('payment-handoff')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async paymentHandoff(@CurrentUser() user: JwtPayload): Promise<{ handoffToken: string }> {
    const handoffToken = await this.authService.issuePaymentHandoffToken(user.id);
    return { handoffToken };
  }

  @ApiOperation({ summary: '아이디 찾기' })
  @ApiResponse({ status: 200, description: '아이디 찾기 SMS 전송 성공' })
  @Post('forget-userid')
  @Public()
  async forgetUserId(@Body(ValidationPipe) { phoneNumber }: FindUserIdDto) {
    return this.authService.forgetUserId(phoneNumber);
  }

  @ApiOperation({ summary: '비밀번호 찾기' })
  @ApiResponse({
    status: 200,
    description: '비밀번호 재설정 SMS 전송 성공',
    schema: {
      type: 'object',
      properties: {
        verificationToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      },
    },
  })
  @Post('forget-password')
  @Public()
  async forgotPassword(
    @Body(ValidationPipe)
    { phoneNumber, loginId }: ForgotPasswordDto,
  ) {
    return this.authService.forgotPassword(phoneNumber, loginId);
  }

  @ApiOperation({ summary: '비밀번호 재설정' })
  @ApiResponse({ status: 200, description: '비밀번호 재설정 성공' })
  @Post('reset-password')
  @Public()
  async resetPassword(@Body(ValidationPipe) { token, password }: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(token, password);
  }

  @ApiOperation({ summary: '이메일 인증' })
  @ApiResponse({ status: 200, description: '이메일 인증 성공' })
  @Get('verify-email')
  @Public()
  async signupVerifyEmail(
    @Query('token') token: string,
    @Query('redirect_to') redirectTo: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return await this.authService.signupVerifyEmail(token, res, redirectTo);
  }

  @ApiOperation({
    summary: '회원가입 콜백(쿠키 설정)',
    description:
      'signupToken 은 verify-email 직후에만 발급되는 단발성 JWT. 이 토큰의 sub 만 userId 로 인정한다. ' +
      '예전 구현은 userId 를 body 로 직접 받았는데, 인증되지 않은 호출자가 임의 사용자로 로그인 가능했던 결함이 있었다.',
  })
  @ApiResponse({ status: 200, description: '회원가입 콜백(쿠키 설정) 성공' })
  @Post('callback/signup')
  @Public()
  async callbackSignup(
    @Body() body: { signupToken?: string; signup_token?: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const signupToken = body.signupToken ?? body.signup_token;
    if (!signupToken) {
      throw new BadRequestException('signupToken 이 필요합니다.');
    }
    return await this.authService.callbackSignup(signupToken, res);
  }

  @ApiOperation({ summary: '인증 이메일 재전송' })
  @ApiResponse({ status: 200, description: '인증 이메일 재전송 성공' })
  @Post('resend-verification-email')
  @Public()
  async resendVerificationEmail(
    @Body(ValidationPipe) { email }: { email: string },
    @Query('redirect_to') redirectTo?: string,
  ) {
    return this.authService.resendVerificationEmail(email, redirectTo);
  }

  @ApiOperation({ summary: '회원 소프트 탈퇴' })
  @ApiResponse({ status: 200, description: '회원 소프트 탈퇴 성공' })
  @Delete('')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes('user:delete')
  async softDeleteUser(@CurrentUser() user: JwtPayload) {
    return this.authService.softDeleteUser(user.id);
  }

  @ApiOperation({ summary: 'PIN 재설정을 위한 본인인증 토큰 발급' })
  @ApiResponse({
    status: 200,
    description: '본인인증 토큰 발급 성공',
    schema: {
      type: 'object',
      properties: {
        verificationToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      },
    },
  })
  @Post('verify-password-for-pin-reset')
  @UseGuards(AuthGuard('jwt'))
  @RequireScopes('user:modify', 'master', 'admin:access')
  async verifyPasswordForPinReset(
    @Body(ValidationPipe) { password }: { password: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.authService.verifyPasswordAndIssuePinResetToken(password, user.id);
  }

  @ApiOperation({ summary: '카카오 로그인' })
  @ApiResponse({ status: 200, description: '카카오 로그인 성공' })
  @Get('kakao/signin')
  @UseGuards(AuthGuard('kakao'))
  @Public()
  async kakaoAuth() {
    // 카카오 로그인 리다이렉트
  }

  @ApiOperation({ summary: '카카오 로그인 콜백' })
  @ApiResponse({ status: 200, description: '카카오 로그인 콜백 성공' })
  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  @Public()
  async kakaoCallback(@Req() req: any, @Res() res: FastifyReply): Promise<void | { redirectUrl: string }> {
    const kakaoUser = req.user as {
      name: string;
      email: string;
      providerId: string;
    };

    try {
      return await this.authService.signInWithSocial(kakaoUser, ProviderType.KAKAO, res);
    } catch (error) {
      const frontendUrl = this.configService.get('FRONTEND_URL') ?? 'http://localhost:8001';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return res.status(302).redirect(`${frontendUrl}/login?errorMessage=${encodeURIComponent(errorMessage)}`);
    }
  }

  @ApiOperation({ summary: '네이버 로그인' })
  @ApiResponse({ status: 200, description: '네이버 로그인 성공' })
  @Get('naver/signin')
  @UseGuards(AuthGuard('naver'))
  @Public()
  async naverAuth() {
    // 네이버 로그인 리다이렉트
  }

  @ApiOperation({ summary: '네이버 로그인 콜백' })
  @ApiResponse({ status: 200, description: '네이버 로그인 콜백 성공' })
  @Get('naver/callback')
  @UseGuards(AuthGuard('naver'))
  @Public()
  async naverCallback(@Req() req: any, @Res() res: FastifyReply): Promise<void | { redirectUrl: string }> {
    const naverUser = req.user as {
      name: string;
      email: string;
      providerId: string;
    };

    try {
      return await this.authService.signInWithSocial(naverUser, ProviderType.NAVER, res);
    } catch (error) {
      const frontendUrl = this.configService.get('FRONTEND_URL') ?? 'http://localhost:8001';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return res.status(302).redirect(`${frontendUrl}/login?errorMessage=${encodeURIComponent(errorMessage)}`);
    }
  }

  /**
   * @deprecated 인증 없는 userId 기반 세션 발급 결함. 신규 `/auth/callback/social` 로 대체.
   * storefront 가 새 흐름으로 이전한 뒤 후속 PR 에서 제거.
   */
  @ApiOperation({ summary: '[DEPRECATED] 소셜로그인 쿠키 설정 — /auth/callback/social 로 대체됨' })
  @ApiResponse({ status: 200, description: '소셜로그인 쿠키 설정 성공' })
  @Post('social/set-cookie')
  @Public()
  async setSocialCookie(@Body() { userId }: { userId: string }, @Res({ passthrough: true }) res: FastifyReply) {
    return await this.authService.setSocialCookie(userId, res);
  }

  @ApiOperation({
    summary: '소셜 로그인 콜백 (쿠키 설정)',
    description:
      'social_token 은 카카오/네이버 콜백 직후 발급되는 단발성 JWT. purpose=social_callback. ' +
      'storefront 의 `/{provider}/callback` 페이지가 토큰을 받아 본 엔드포인트로 제출하면 세션을 시작한다. ' +
      '예전 `/auth/social/set-cookie` 는 body 의 userId 를 무검증으로 신뢰해 임의 계정 탈취가 가능했고, 이 흐름이 그 결함을 닫는다.',
  })
  @ApiResponse({ status: 200, description: '소셜 콜백 성공, 세션 쿠키 설정' })
  @Post('callback/social')
  @Public()
  @HttpCode(HttpStatus.OK)
  async callbackSocial(
    @Body() body: { socialToken?: string; social_token?: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const socialToken = body.socialToken ?? body.social_token;
    if (!socialToken) {
      throw new BadRequestException('socialToken 이 필요합니다.');
    }
    return await this.authService.callbackSocial(socialToken, res);
  }
}
