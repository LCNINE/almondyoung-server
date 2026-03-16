import { ApplicationException } from '@app/shared/filters/application.exception';
import { RequireScopes } from '@app/authorization';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AddScopeToRoleDto, CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';

@ApiTags('Admin/Roles')
@ApiBearerAuth('access-token')
@Controller('/admin/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: '전체 역할 목록 조회' })
  @ApiResponse({ status: 200, description: '역할 목록 반환' })
  @Get()
  @RequireScopes('master')
  async listRoles(): Promise<RoleResponseDto[]> {
    try {
      return await this.rolesService.listRoles();
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '역할 생성' })
  @ApiResponse({ status: 201, description: '역할 생성 성공' })
  @Post()
  @RequireScopes('master')
  async createRole(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    try {
      return await this.rolesService.createRole(dto);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '역할 수정' })
  @ApiResponse({ status: 200, description: '역할 수정 성공' })
  @Patch(':roleId')
  @RequireScopes('master')
  async updateRole(
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    try {
      return await this.rolesService.updateRole(roleId, dto);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '역할 삭제' })
  @ApiResponse({ status: 200, description: '역할 삭제 성공' })
  @Delete(':roleId')
  @RequireScopes('master')
  async deleteRole(@Param('roleId') roleId: string): Promise<void> {
    try {
      return await this.rolesService.deleteRole(roleId);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '역할의 스코프 목록 조회' })
  @ApiResponse({ status: 200, description: '스코프 목록 반환' })
  @Get(':roleId/scopes')
  @RequireScopes('master')
  async getScopesForRole(@Param('roleId') roleId: string): Promise<string[]> {
    try {
      return await this.rolesService.getScopesForRole(roleId);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '역할에 스코프 추가' })
  @ApiResponse({ status: 201, description: '스코프 추가 성공' })
  @Post(':roleId/scopes')
  @RequireScopes('master')
  async addScopeToRole(
    @Param('roleId') roleId: string,
    @Body() dto: AddScopeToRoleDto,
  ): Promise<void> {
    try {
      return await this.rolesService.addScopeToRole(roleId, dto.scopeKey);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '역할에서 스코프 제거' })
  @ApiResponse({ status: 200, description: '스코프 제거 성공' })
  @Delete(':roleId/scopes/:scopeKey')
  @RequireScopes('master')
  async removeScopeFromRole(
    @Param('roleId') roleId: string,
    @Param('scopeKey') scopeKey: string,
  ): Promise<void> {
    try {
      return await this.rolesService.removeScopeFromRole(roleId, scopeKey);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }
}
