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

  @ApiOperation({ summary: '토큰 재발급' })
  @ApiResponse({ status: 200, description: '토큰 재발급 성공' })
  @Public()
  @Post('restore-token')
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  async restoreToken(@Res({ passthrough: true }) res: FastifyReply, @CurrentUser() user: JwtPayload) {
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

  @ApiOperation({ summary: '회원가입 콜백(쿠키 설정)' })
  @ApiResponse({ status: 200, description: '회원가입 콜백(쿠키 설정) 성공' })
  @Post('callback/signup')
  @Public()
  async callbackSignup(@Body() { userId }: { userId: string }, @Res({ passthrough: true }) res: FastifyReply) {
    return await this.authService.callbackSignup(userId, res);
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

  @ApiOperation({ summary: '소셜로그인 쿠키 설정' })
  @ApiResponse({ status: 200, description: '소셜로그인 쿠키 설정 성공' })
  @Post('social/set-cookie')
  @Public()
  async setSocialCookie(@Body() { userId }: { userId: string }, @Res({ passthrough: true }) res: FastifyReply) {
    return await this.authService.setSocialCookie(userId, res);
  }
}
