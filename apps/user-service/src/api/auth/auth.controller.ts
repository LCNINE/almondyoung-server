import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
import { SignUpDto } from './dto/sign-up.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('signup')
  @Public()
  async signUp(
    @Body(ValidationPipe) signUpDto: SignUpDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.authService.signUp(signUpDto, res);
  }

  @Post('signin')
  @Public()
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(ValidationPipe) signInDto: SignInDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.authService.signIn(signInDto, res);
  }

  @Post('signout')
  @UseGuards(AuthGuard('jwt'))
  async signOut(
    @Req() request: FastifyRequest,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.signOut(request, user);
  }

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  async restoreAccessToken(
    @Res({ passthrough: true }) res: FastifyReply,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.refreshToken(user, res);
  }

  @Post('change-password')
  @UseGuards(AuthGuard('jwt'))
  async changePassword(
    @Body(ValidationPipe) { password }: ChangePasswordDto,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.changePassword(password, user);
  }

  @Post('forget-password')
  @Public()
  async forgotPassword(@Body(ValidationPipe) { email }: { email: string }) {
    return this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  @Public()
  async resetPassword(
    @Body() { token, password }: { token: string; password: string },
  ): Promise<void> {
    return this.authService.resetPassword(token, password);
  }

  @Post('callback/verify-email')
  @Public()
  async verifyEmail(
    @Body() { token }: { token: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return await this.authService.verifyEmail(token, res);
  }

  @Post('resend-verification-email')
  @Public()
  async resendVerificationEmail(@Body() { email }: { email: string }) {
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
    @Body() { password }: { password: string },
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

    console.log('kakaoUser', kakaoUser);

    return await this.authService.signInWithKakao(kakaoUser, res);
  }
}
