import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FastifyReply, FastifyRequest } from 'fastify';
import * as schema from '../../../database/drizzle/schema';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { Public } from '../../commons/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-pw.dto';
import { SignInDto } from './dto/sign-in.dto';
import { LocalSignUpDto, SignUpDto } from './dto/sign-up.dto';
import { SocialSignUpDto } from './dto/social-sign-up.dto';

@ApiTags('인증')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: '회원가입' })
  @ApiResponse({ status: 201, description: '회원가입 성공' })
  @Post('signup')
  @Public()
  async signUp(
    @Body(ValidationPipe) localSignUpDto: LocalSignUpDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.authService.signUp(localSignUpDto, res);
  }

  @ApiOperation({ summary: '로그인' })
  @ApiResponse({ status: 200, description: '로그인 성공' })
  @Post('signin')
  @Public()
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(ValidationPipe) signInDto: SignInDto,
    @Res({ passthrough: true }) res: FastifyReply,
    @Query('redirect_to') redirectTo?: string,
  ) {
    return this.authService.signIn(signInDto, res, redirectTo);
  }

  @ApiOperation({ summary: '로그아웃' })
  @ApiResponse({ status: 200, description: '로그아웃 성공' })
  @ApiBearerAuth()
  @Post('signout')
  @UseGuards(AuthGuard('jwt'))
  async signOut(
    @Req() request: FastifyRequest,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.signOut(request, user);
  }

  @ApiOperation({ summary: '토큰 재발급' })
  @ApiResponse({ status: 200, description: '토큰 재발급 성공' })
  @ApiBearerAuth()
  @Post('restore-token')
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  async restoreToken(
    @Res({ passthrough: true }) res: FastifyReply,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.restoreToken(user, res);
  }

  @ApiOperation({ summary: '비밀번호 변경' })
  @ApiResponse({ status: 200, description: '비밀번호 변경 성공' })
  @ApiBearerAuth()
  @Post('change-password')
  @UseGuards(AuthGuard('jwt'))
  async changePassword(
    @Body(ValidationPipe) { password }: ChangePasswordDto,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.changePassword(password, user);
  }

  @ApiOperation({ summary: '아이디 찾기' })
  @ApiResponse({ status: 200, description: '아이디 찾기 이메일 전송 성공' })
  @Post('forget-userid')
  @Public()
  async forgetUserId(@Body(ValidationPipe) { email }: { email: string }) {
    return this.authService.forgetUserId(email);
  }

  @ApiOperation({ summary: '비밀번호 찾기' })
  @ApiResponse({ status: 200, description: '비밀번호 재설정 이메일 전송 성공' })
  @Post('forget-password')
  @Public()
  async forgotPassword(@Body(ValidationPipe) { email }: { email: string }) {
    return this.authService.forgotPassword(email);
  }

  @ApiOperation({ summary: '비밀번호 재설정' })
  @ApiResponse({ status: 200, description: '비밀번호 재설정 성공' })
  @Post('reset-password')
  @Public()
  async resetPassword(
    @Body(ValidationPipe)
    { token, password }: { token: string; password: string },
  ): Promise<void> {
    return this.authService.resetPassword(token, password);
  }

  @ApiOperation({ summary: '이메일 인증' })
  @ApiResponse({ status: 200, description: '이메일 인증 성공' })
  @Post('callback/verify-email')
  @Public()
  async verifyEmail(
    @Body(ValidationPipe) { token }: { token: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return await this.authService.verifyEmail(token, res);
  }

  @ApiOperation({ summary: '인증 이메일 재전송' })
  @ApiResponse({ status: 200, description: '인증 이메일 재전송 성공' })
  @Post('resend-verification-email')
  @Public()
  async resendVerificationEmail(
    @Body(ValidationPipe) { email }: { email: string },
  ) {
    return this.authService.resendVerificationEmail(email);
  }

  @ApiOperation({ summary: '회원 탈퇴' })
  @ApiResponse({ status: 200, description: '회원 탈퇴 성공' })
  @ApiBearerAuth()
  @Delete('account')
  @UseGuards(AuthGuard('jwt'))
  async deleteAccount(@CurrentUser() user: schema.User) {
    return this.authService.deleteAccount(user);
  }

  @ApiOperation({ summary: '비밀번호 확인' })
  @ApiResponse({ status: 200, description: '비밀번호 확인 성공' })
  @ApiBearerAuth()
  @Post('check-password')
  @UseGuards(AuthGuard('jwt'))
  async checkPassword(
    @Body(ValidationPipe) { password }: { password: string },
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.checkPassword(password, user);
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
  async kakaoCallback(@Req() req: any, @Res() res: FastifyReply) {
    const kakaoUser = req.user as {
      name: string;
      email: string;
      providerId: string;
    };

    return await this.authService.signInWithKakao(kakaoUser, res);
  }

  @ApiOperation({ summary: '소셜 회원가입' })
  @ApiResponse({ status: 201, description: '소셜 회원가입 성공' })
  @Post('social-signup')
  @Public()
  async socialSignUp(
    @Body(ValidationPipe) socialSignUpDto: SocialSignUpDto,
    @Res() reply: FastifyReply,
  ) {
    return this.authService.socialSignUp(socialSignUpDto, reply);
  }
}
