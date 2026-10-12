import { JwtPayload, RequireScopes } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CreateAccountDto } from './dto/create-account-dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('admin/auth')
@ApiBearerAuth('access-token')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  @RequireScopes('master')
  async createAccount(@Body() createAccountDto: CreateAccountDto) {
    return this.authService.createAccount(createAccountDto);
  }

  @Patch('change-password')
  @RequireScopes('master', 'admin:users:modify')
  changePassword(@Body() changePasswordDto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
    return this.authService.changePassword(changePasswordDto, user);
  }
}
