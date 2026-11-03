import { JwtPayload, RequirePermission } from '@app/authorization';
import { CurrentUser } from '@app/shared/decorators/current-user.decorator';
import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrentIamActor, type IamActor } from '../../iam/iam-actor';
import { AuthService } from './auth.service';
import { CreateAccountDto } from './dto/create-account-dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ServedTenantData } from '../../../tenancy/served-tenant.guard';

@Controller('admin/auth')
@ApiBearerAuth('access-token')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @RequirePermission('iam.admin_user.write')
  @Post()
  async createAccount(@CurrentIamActor() actor: IamActor, @Body() createAccountDto: CreateAccountDto) {
    return this.authService.createAccount(createAccountDto, actor);
  }

  // 그 테넌트의 관리자가 자기 테넌트 계정의 비밀번호를 초기화한다(ADR-0056) — 토큰 테넌트의 계정만. 모든 테넌트의 일이라
  // `@ServedTenantData()` 를 달지 않는다(테넌트 도메인엔 찾기 화면이 없어 직원의 복구 길이 이것이다).
  @RequirePermission('iam.admin_user.write')
  @Post('staff/:userId/password')
  reissueStaffPassword(@CurrentIamActor() actor: IamActor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.authService.reissueStaffPassword(actor, userId);
  }

  // 고객 계정의 비밀번호까지 바꾼다 — 고객은 T 의 데이터다. 역할이 전역이라 권한 키만으로는 다른 테넌트 토큰을 못 막는다.
  @ServedTenantData()
  @RequirePermission('customer.profile.write')
  @Patch('change-password')
  changePassword(@Body() changePasswordDto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
    return this.authService.changePassword(changePasswordDto, user);
  }
}
