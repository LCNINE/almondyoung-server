import { AuthorizationGuard } from '@app/roles';
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../commons/guards/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CreateAccountDto } from './dto/create-account-dto';

@Controller('admin/auth')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  async createAccount(@Body() createAccountDto: CreateAccountDto) {
    try {
      return this.authService.createAccount(createAccountDto);
    } catch (error) {
      if (error.message.includes('already exists')) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Failed to create account',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
