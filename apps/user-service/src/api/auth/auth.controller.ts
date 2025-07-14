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
import { FastifyReply, FastifyRequest } from 'fastify';
import * as schema from '../../../database/drizzle/schema';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { Public } from '../../commons/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-pw.dto';
import { SignInDto } from './dto/sign-in.dto';
import { LocalSignUpDto, SignUpDto } from './dto/sign-up.dto';
import { SocialSignUpDto } from './dto/social-sign-up.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('signup')
  @Public()
  async signUp(
    @Body(ValidationPipe) localSignUpDto: LocalSignUpDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.authService.signUp(localSignUpDto, res);
  }

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

  @Post('signout')
  @UseGuards(AuthGuard('jwt'))
  async signOut(
    @Req() request: FastifyRequest,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.signOut(request, user);
  }

  @Post('restore-token')
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  async restoreToken(
    @Res({ passthrough: true }) res: FastifyReply,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.restoreToken(user, res);
  }

  @Post('change-password')
  @UseGuards(AuthGuard('jwt'))
  async changePassword(
    @Body(ValidationPipe) { password }: ChangePasswordDto,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.changePassword(password, user);
  }

  @Post('forget-userid')
  @Public()
  async forgetUserId(@Body(ValidationPipe) { email }: { email: string }) {
    return this.authService.forgetUserId(email);
  }

  @Post('forget-password')
  @Public()
  async forgotPassword(@Body(ValidationPipe) { email }: { email: string }) {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  @Public()
  async resetPassword(
    @Body(ValidationPipe)
    { token, password }: { token: string; password: string },
  ): Promise<void> {
    return this.authService.resetPassword(token, password);
  }

  @Post('callback/verify-email')
  @Public()
  async verifyEmail(
    @Body(ValidationPipe) { token }: { token: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return await this.authService.verifyEmail(token, res);
  }

  @Post('resend-verification-email')
  @Public()
  async resendVerificationEmail(
    @Body(ValidationPipe) { email }: { email: string },
  ) {
    return this.authService.resendVerificationEmail(email);
  }

  @Delete('account')
  @UseGuards(AuthGuard('jwt'))
  async deleteAccount(@CurrentUser() user: schema.User) {
    return this.authService.deleteAccount(user);
  }

  @Post('check-password')
  @UseGuards(AuthGuard('jwt'))
  async checkPassword(
    @Body(ValidationPipe) { password }: { password: string },
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.checkPassword(password, user);
  }

  @Get('kakao/signin')
  @UseGuards(AuthGuard('kakao'))
  @Public()
  async kakaoAuth() {
    // 카카오 로그인 리다이렉트
  }

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

  @Post('social-signup')
  @Public()
  async socialSignUp(
    @Body(ValidationPipe) socialSignUpDto: SocialSignUpDto,
    @Res() reply: FastifyReply,
  ) {
    return this.authService.socialSignUp(socialSignUpDto, reply);
  }
}
