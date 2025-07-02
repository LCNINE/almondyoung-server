import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FastifyReply, FastifyRequest } from 'fastify';
import * as schema from '../../../database/drizzle/schema';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { Public } from '../../commons/decorators/public.decorator';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
