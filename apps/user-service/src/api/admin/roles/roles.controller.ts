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
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto/roles.dto';
import { ReplaceUserRolesDto, UserRolesResponseDto } from './dto/user-roles.dto';
import { RolesService } from './roles.service';

@ApiTags('Admin/Roles')
@ApiBearerAuth('access-token')
@Controller('/admin/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: '사용자의 현재 역할 ID 조회' })
  @ApiResponse({ status: 200, description: '역할 ID 목록 반환' })
  @Get('users/:userId')
  @RequireScopes('master')
  async getUserRoles(@Param('userId') userId: string): Promise<UserRolesResponseDto> {
    try {
      return await this.rolesService.getUserRoles(userId);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

  @ApiOperation({ summary: '사용자 역할 전체 교체 (체크박스 저장)' })
  @ApiResponse({ status: 200, description: '역할 교체 성공' })
  @Put('users/:userId')
  @RequireScopes('master')
  async replaceUserRoles(
    @Param('userId') userId: string,
    @Body() dto: ReplaceUserRolesDto,
  ): Promise<void> {
    try {
      return await this.rolesService.replaceUserRoles(userId, dto);
    } catch (e: any) {
      if (e instanceof ApplicationException) throw new HttpException(e.message, e.getHttpStatus());
      throw new InternalServerErrorException(e.message);
    }
  }

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
}
