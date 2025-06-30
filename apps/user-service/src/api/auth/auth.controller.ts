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
import { FastifyReply, FastifyRequest } from 'fastify';
import * as schema from '../../../database/drizzle/schema';
import { AuthService } from './auth.service';
import { CurrentUser } from '../../commons/decorators/current-user.decorator';
import { Public } from '../../commons/decorators/public.decorator';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { AuthGuard } from '@nestjs/passport';

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
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(ValidationPipe) signInDto: SignInDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    return this.authService.signIn(signInDto, res);
  }

  @Post('signout')
  async signOut(
    @Req() request: FastifyRequest,
    @CurrentUser() user: schema.UserSchema,
  ) {
    console.log('user:', user);
    // return this.authService.signOut(request, user);
  }

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Res({ passthrough: true }) res: FastifyReply,
    @CurrentUser() user: schema.User,
  ) {
    return this.authService.refreshToken(user, res);
  }
}
