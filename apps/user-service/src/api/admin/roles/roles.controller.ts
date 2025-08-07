import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RequireScopes, RolesGuard } from '@app/roles';
import { RolesService } from './roles.service';

@ApiTags('역할')
@ApiBearerAuth()
@Controller('/admin/roles')
@UseGuards(RolesGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: '역할 설정' })
  @ApiResponse({ status: 201, description: '역할 설정 성공' })
  @Post('set-role')
  @RequireScopes(['master'])
  async setRole(@Body() body: { userId: string; role: string }) {
    return await this.rolesService.setRole(body.userId, body.role);
  }

  @ApiOperation({ summary: '사용자에게 역할 할당' })
  @ApiResponse({ status: 201, description: '역할 할당 성공' })
  @Post('assign')
  @RequireScopes(['master'])
  async assignUserRole(@Body() body: { userId: string; roleId: string }) {
    return await this.rolesService.assignUserRole(body.userId, body.roleId);
  }
}
