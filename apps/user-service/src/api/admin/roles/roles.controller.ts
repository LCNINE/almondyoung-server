import { AuthorizationGuard, RequireScopes } from '@app/roles';
import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  Delete,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'apps/user-service/src/commons/guards/jwt-auth.guard';
import { SetUserRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

@ApiTags('Admin/Roles')
@ApiBearerAuth('access-token')
@Controller('/admin/roles')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: '사용자에게 역할 할당' })
  @ApiResponse({ status: 201, description: '역할 할당 성공' })
  @Post()
  @RequireScopes(['master'])
  async assignUserRole(@Body() setUserRoleDto: SetUserRoleDto): Promise<void> {
    return await this.rolesService.setUserRole(setUserRoleDto);
  }

  @ApiOperation({ summary: '사용자의 역할 할당 삭제' })
  @ApiResponse({ status: 201, description: '역할 할당 삭제 성공' })
  @Delete(':id')
  @RequireScopes(['master'])
  async deleteUserRole(@Param('id') id: string): Promise<void> {
    return await this.rolesService.deleteUserRoleByUserId(id);
  }
}
