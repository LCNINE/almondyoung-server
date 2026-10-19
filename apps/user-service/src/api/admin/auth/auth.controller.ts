import { JwtPayload, RequireScopes, RequirePermission } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../../iam/iam-actor';
import { AuthService } from './auth.service';
import { CreateAccountDto } from './dto/create-account-dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('admin/auth')
@ApiBearerAuth('access-token')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @RequirePermission('iam.admin_user.write')
  @Post()
  @RequireScopes('master')
  async createAccount(@CurrentIamActor() actor: IamActor, @Body() createAccountDto: CreateAccountDto) {
    return this.authService.createAccount(createAccountDto, actor);
  }

  @RequirePermission('customer.profile.write')
  @Patch('change-password')
  @RequireScopes('master', 'admin:users:modify')
  changePassword(@Body() changePasswordDto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
    return this.authService.changePassword(changePasswordDto, user);
  }
}
