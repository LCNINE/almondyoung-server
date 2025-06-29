import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { SignInDto } from './dto/sign-in.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import * as schema from '../../database/drizzle/schema';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signUp(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body(ValidationPipe) signUpDto: SignUpDto,
  ) {
    return this.authService.signUp(signUpDto, res);
  }

  @Post('signin')
  async signIn(@Body(ValidationPipe) signInDto: SignInDto) {
    return this.authService.signIn(signInDto);
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
  async refreshToken(@Req() request: FastifyRequest) {
    return this.authService.refreshToken(request);
  }
}
