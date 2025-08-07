import { RequireScopes, RolesGuard, USER_SCOPES } from '@app/roles';
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AssignUserRoleDto, SetRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

@ApiTags('Admin/Roles')
@ApiBearerAuth('access-token')
@Controller('/admin/roles')
@UseGuards(RolesGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: '역할 설정' })
  @ApiResponse({ status: 201, description: '역할 설정 성공' })
  @Post('set-role')
  @RequireScopes(['master'])
  async setRole(@Body() body: SetRoleDto): Promise<void> {
    return await this.rolesService.setRole(
      body.userId,
      body.role,
      body.description,
    );
  }

  @ApiOperation({ summary: '사용자에게 역할 할당' })
  @ApiResponse({ status: 201, description: '역할 할당 성공' })
  @Post('assign')
  @RequireScopes(['master'])
  async assignUserRole(@Body() body: AssignUserRoleDto): Promise<void> {
    return await this.rolesService.assignUserRole(body.userId, body.roleId);
  }
}
